import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { systemClock } from '../../../src/adapters/clock/systemClock'
import { createD1PageRepository } from '../../../src/adapters/d1/d1PageRepository'
import { createD1RateLimiter } from '../../../src/adapters/d1/d1RateLimiter'
import { createR2ObjectStorage, icsKey } from '../../../src/adapters/r2/r2ObjectStorage'
import {
  CHANGE_BANNER_HOURS,
  GC_BATCH_SIZE,
  RATE_LIMIT_COUNTER_RETENTION_DAYS,
} from '../../../src/core/config/limits'
import type { ChangeSnapshot, EventFields } from '../../../src/core/types'
import worker from '../../../src/server/index'
import { runGc } from '../../../src/server/scheduled/gc'
import type { Deps } from '../../../src/server/deps'
import type { NewPageInput } from '../../../src/ports/pageRepository'
import type { RateLimitRule } from '../../../src/ports/rateLimiter'
import { buildFakeDeps } from '../helpers/fakeDeps'

const NOW = new Date('2026-09-16T01:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** R2 はテストファイル内で状態が残るので、ページ・レート制限のキーはテストごとにユニークにする */
function uniqueId(name: string): string {
  return `${name}-${crypto.randomUUID()}`
}

function eventFields(): EventFields {
  return {
    title: '飲み会',
    location: '渋谷',
    memo: null,
    start: new Date('2026-09-20T10:00:00.000Z'),
    end: new Date('2026-09-20T11:00:00.000Z'),
    isAllDay: false,
  }
}

function buildInput(id: string, expiresAt: Date, now: Date = NOW): NewPageInput {
  return {
    id,
    editTokenHash: 'token-hash',
    rawText: '9/20 19時 渋谷で飲み会',
    event: { id: `${id}-event`, ...eventFields() },
    expiresAt,
    source: 'direct',
    creatorIpHash: `iphash-${id}`,
    creatorDeviceId: `device-${id}`,
    now,
  }
}

function changeSnapshot(): ChangeSnapshot {
  return {
    start: new Date('2026-09-19T10:00:00.000Z'),
    end: new Date('2026-09-19T11:00:00.000Z'),
    isAllDay: false,
    titleChanged: false,
    locationChanged: false,
  }
}

/**
 * Fake Deps（memory 実装）と本物の D1 / R2 の両方に流す GC の契約テスト（§11.6 の「同じテストスイートを両方に流す」）。
 * buildDeps は毎回新しい Deps を返す。overrides で logger 等を差し替えられる
 */
function runGcContractTests(buildDeps: (overrides?: Partial<Deps>) => Deps) {
  it('期限切れページの pages・ics・ogp が消え、有効なページは残る', async () => {
    const deps = buildDeps()
    const expiredId = uniqueId('expired')
    const activeId = uniqueId('active')
    await deps.pages.create(buildInput(expiredId, new Date(NOW.getTime() - 1)))
    await deps.pages.create(buildInput(activeId, new Date(NOW.getTime() + DAY_MS)))
    await deps.storage.putIcs(expiredId, 'expired-ics')
    await deps.storage.putIcs(activeId, 'active-ics')
    await deps.storage.putOgpImage(expiredId, 1, new Uint8Array([1, 2, 3]))
    await deps.storage.putOgpFailureMarker(expiredId, 1, 300)

    await runGc(deps)

    expect(await deps.pages.findById(expiredId)).toBeNull()
    expect(await deps.pages.findById(activeId)).not.toBeNull()
    expect(await deps.storage.getIcs(expiredId)).toBeNull()
    expect(await deps.storage.getOgpImage(expiredId, 1)).toBeNull()
    expect(await deps.storage.getOgpFailureMarker(expiredId, 1)).toBe(false)
    expect(await deps.storage.getIcs(activeId)).toBe('active-ics')
  })

  it('expires_at がちょうど now のページは消さない', async () => {
    const deps = buildDeps()
    const boundaryId = uniqueId('boundary')
    await deps.pages.create(buildInput(boundaryId, new Date(NOW)))

    await runGc(deps)

    expect(await deps.pages.findById(boundaryId)).not.toBeNull()
  })

  it(`${GC_BATCH_SIZE + 1} 件の期限切れをバッチに分けて全件削除する`, async () => {
    const deps = buildDeps()
    const count = GC_BATCH_SIZE + 1
    const ids = Array.from({ length: count }, () => uniqueId('expired-batch'))
    for (const id of ids) {
      await deps.pages.create(buildInput(id, new Date(NOW.getTime() - 1)))
    }
    const listExpiredSpy = vi.spyOn(deps.pages, 'listExpired')

    await runGc(deps)

    // GC_BATCH_SIZE 件ずつ 2 回に分かれて全件消える
    expect(listExpiredSpy).toHaveBeenCalledTimes(2)
    for (const id of ids) {
      expect(await deps.pages.findById(id)).toBeNull()
    }
  })

  it('rate_limit_counters は古い窓だけ消し、新しい窓は残す', async () => {
    const deps = buildDeps()
    const oldNow = new Date(NOW.getTime() - RATE_LIMIT_COUNTER_RETENTION_DAYS * DAY_MS - 1)
    const oldRule: RateLimitRule = {
      scope: 'create',
      bucketKey: uniqueId('ip'),
      window: 'hour',
      limit: 1,
    }
    const recentRule: RateLimitRule = {
      scope: 'create',
      bucketKey: uniqueId('ip'),
      window: 'hour',
      limit: 1,
    }
    await deps.rateLimiter.consume([oldRule], oldNow)
    await deps.rateLimiter.consume([recentRule], NOW)

    await runGc(deps)

    // 古い窓は掃除されて 0 から積み直せる。新しい窓はそのまま残り上限に達している
    expect(await deps.rateLimiter.consume([oldRule], oldNow)).toEqual({
      allowed: true,
      exceeded: [],
    })
    expect(await deps.rateLimiter.consume([recentRule], NOW)).toEqual({
      allowed: false,
      exceeded: [recentRule],
    })
  })

  it('changedAt が CHANGE_BANNER_HOURS より古い previousSnapshot だけを NULL 化する', async () => {
    const deps = buildDeps()
    const cutoff = new Date(NOW.getTime() - CHANGE_BANNER_HOURS * HOUR_MS)
    const futureExpiry = new Date(NOW.getTime() + DAY_MS)
    const oldId = uniqueId('old-banner')
    const boundaryId = uniqueId('boundary-banner')

    await deps.pages.create(buildInput(oldId, futureExpiry))
    await deps.pages.update(oldId, {
      rawText: '9/20 19時 渋谷で飲み会',
      event: eventFields(),
      expiresAt: futureExpiry,
      previousSnapshot: changeSnapshot(),
      now: new Date(cutoff.getTime() - 1),
    })
    await deps.pages.create(buildInput(boundaryId, futureExpiry))
    await deps.pages.update(boundaryId, {
      rawText: '9/20 19時 渋谷で飲み会',
      event: eventFields(),
      expiresAt: futureExpiry,
      previousSnapshot: changeSnapshot(),
      now: cutoff,
    })

    await runGc(deps)

    expect((await deps.pages.findById(oldId))?.previousSnapshot).toBeNull()
    expect((await deps.pages.findById(oldId))?.changedAt).toBeNull()
    expect((await deps.pages.findById(boundaryId))?.previousSnapshot).not.toBeNull()
  })

  it('件数と所要時間を構造化ログに出す', async () => {
    const infoSpy = vi.fn()
    const deps = buildDeps({ logger: { info: infoSpy, warn: vi.fn(), error: vi.fn() } })
    const expiredId = uniqueId('expired')
    const activeId = uniqueId('active')
    await deps.pages.create(buildInput(expiredId, new Date(NOW.getTime() - 1)))
    await deps.pages.create(buildInput(activeId, new Date(NOW.getTime() + DAY_MS)))

    await runGc(deps)

    expect(infoSpy).toHaveBeenCalledWith(
      'gc_completed',
      expect.objectContaining({
        deletedPageCount: 1,
        batchCount: 1,
        clearedSnapshotCount: 0,
        durationMs: expect.any(Number),
      }),
    )
  })
}

describe('runGc（Fake Deps）', () => {
  runGcContractTests((overrides) => buildFakeDeps({ clock: fakeClock(NOW), ...overrides }))
})

describe('runGc（本物の D1 / R2）', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM pages').run()
    await env.DB.prepare('DELETE FROM rate_limit_counters').run()
  })

  runGcContractTests((overrides) => {
    const clock = fakeClock(NOW)
    return buildFakeDeps({
      clock,
      pages: createD1PageRepository(env.DB),
      storage: createR2ObjectStorage(env.BUCKET, clock),
      rateLimiter: createD1RateLimiter(env.DB),
      ...overrides,
    })
  })
})

describe('scheduled（src/server/index.ts の配線）', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM pages').run()
  })

  it('Cron Trigger から呼ばれる scheduled ハンドラが GC を実行する', async () => {
    // buildDeps の本物の consoleLogger が gc_completed を出す。テスト出力を汚さないよう抑止しつつ内容を検証する
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pages = createD1PageRepository(env.DB)
    const storage = createR2ObjectStorage(env.BUCKET, systemClock)
    const now = systemClock.now()
    const expiredId = uniqueId('scheduled-expired')
    await pages.create(buildInput(expiredId, new Date(now.getTime() - 1000), now))
    await storage.putIcs(expiredId, 'ics')

    const controller = createScheduledController()
    const ctx = createExecutionContext()
    await worker.scheduled(controller, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(
      await env.DB.prepare('SELECT id FROM pages WHERE id = ?').bind(expiredId).first(),
    ).toBeNull()
    expect(await env.BUCKET.get(icsKey(expiredId))).toBeNull()
    const logged = logSpy.mock.calls.map(([line]) => JSON.parse(line as string))
    expect(logged).toContainEqual(expect.objectContaining({ level: 'info', event: 'gc_completed' }))
  })
})
