import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { D1_MAX_BIND_PARAMS, UNKNOWN_IP_HASH } from '../../../src/core/config/limits'
import type { ChangeSnapshot, EventFields } from '../../../src/core/types'
import { createD1PageRepository } from '../../../src/adapters/d1/d1PageRepository'
import { createD1ReportRepository } from '../../../src/adapters/d1/d1ReportRepository'
import {
  createMemoryPageRepository,
  createMemoryPageStore,
} from '../../../src/adapters/memory/memoryPageRepository'
import { createMemoryReportRepository } from '../../../src/adapters/memory/memoryReportRepository'
import { InvariantViolation } from '../../../src/ports/pageRepository'
import type { NewPageInput, PageRepository } from '../../../src/ports/pageRepository'
import type { ReportRepository } from '../../../src/ports/reportRepository'
import { insertPageRow } from '../helpers/insertPageRow'

const NOW = new Date('2026-09-16T01:00:00.000Z')

function eventFields(overrides: Partial<EventFields> = {}): EventFields {
  return {
    title: '飲み会',
    location: '渋谷',
    memo: null,
    start: new Date('2026-09-20T10:00:00.000Z'),
    end: new Date('2026-09-20T11:00:00.000Z'),
    isAllDay: false,
    ...overrides,
  }
}

function buildInput(overrides: Partial<NewPageInput> = {}): NewPageInput {
  const id = overrides.id ?? 'page-1'
  return {
    id,
    editTokenHash: 'token-hash',
    rawText: '9/20 19時 渋谷で飲み会',
    event: { id: `${id}-event`, ...eventFields() },
    expiresAt: new Date('2026-09-27T00:00:00.000Z'),
    source: 'direct',
    creatorIpHash: 'ip-hash-1',
    creatorDeviceId: 'device-1',
    now: NOW,
    ...overrides,
  }
}

/** D1PageRepository と memoryPageRepository の両方に流す契約テスト */
function runPageRepositoryTests(
  createRepos: () => { pages: PageRepository; reports: ReportRepository },
) {
  const createRepo = (): PageRepository => createRepos().pages
  it('create: source・creatorIpHash・creatorDeviceId が入り、findById で読める', async () => {
    const repo = createRepo()
    const input = buildInput({
      id: 'page-create',
      source: 'prefill',
      creatorIpHash: 'iphash-create',
      creatorDeviceId: 'device-create',
    })

    expect(await repo.create(input)).toBe('ok')

    const page = await repo.findById('page-create')
    expect(page?.source).toBe('prefill')
    expect(page?.creatorIpHash).toBe('iphash-create')
    expect(page?.creatorDeviceId).toBe('device-create')
    expect(page?.status).toBe('active')
    expect(page?.reportCount).toBe(0)
    expect(page?.version).toBe(1)
    expect(page?.previousSnapshot).toBeNull()
    expect(page?.event.title).toBe(input.event.title)
    expect(page?.event.start).toEqual(input.event.start)
  })

  it('create: 日時未確定の下書きも作成できる', async () => {
    const repo = createRepo()
    const input = buildInput({
      id: 'page-draft',
      event: { id: 'page-draft-event', ...eventFields({ start: null, end: null }) },
    })

    expect(await repo.create(input)).toBe('ok')

    const page = await repo.findById('page-draft')
    expect(page?.event.start).toBeNull()
    expect(page?.event.end).toBeNull()
  })

  it('同じ id で create すると id_conflict を返し、既存のページは変わらない', async () => {
    const repo = createRepo()
    const original = buildInput({ id: 'page-dup' })
    await repo.create(original)

    const result = await repo.create(
      buildInput({
        id: 'page-dup',
        event: { id: 'page-dup-event-2', ...eventFields() },
        rawText: '別の本文',
        editTokenHash: 'token-hash-2',
      }),
    )

    expect(result).toBe('id_conflict')
    const page = await repo.findById('page-dup')
    expect(page?.event.id).toBe('page-dup-event')
    expect(page?.rawText).toBe(original.rawText)
    expect(page?.editTokenHash).toBe(original.editTokenHash)
  })

  it('同じ id への並行 create は ok が 1 件だけ', async () => {
    const repo = createRepo()
    const concurrency = 5

    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        repo.create(
          buildInput({
            id: 'page-concurrent-create',
            event: { id: `page-concurrent-create-event-${i}`, ...eventFields() },
          }),
        ),
      ),
    )

    expect(results.filter((r) => r === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r === 'id_conflict')).toHaveLength(concurrency - 1)
  })

  it('events の INSERT が失敗すると pages も残らない（event id の使い回し）', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-a', event: { id: 'evt-shared', ...eventFields() } }))

    await expect(
      repo.create(buildInput({ id: 'page-b', event: { id: 'evt-shared', ...eventFields() } })),
    ).rejects.toThrow()

    expect(await repo.findById('page-b')).toBeNull()
  })

  it('findById: 存在しない id は null', async () => {
    const repo = createRepo()
    expect(await repo.findById('no-such-page')).toBeNull()
  })

  it('update: not_found（存在しない id）', async () => {
    const repo = createRepo()
    const result = await repo.update('no-such-page', {
      rawText: 'x',
      event: eventFields(),
      expiresAt: NOW,
      previousSnapshot: null,
      now: NOW,
    })
    expect(result).toBe('not_found')
  })

  it('update: 削除済みの id は not_found', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-update-deleted' }))
    await repo.deleteByIds(['page-update-deleted'])

    const result = await repo.update('page-update-deleted', {
      rawText: 'x',
      event: eventFields(),
      expiresAt: NOW,
      previousSnapshot: null,
      now: NOW,
    })
    expect(result).toBe('not_found')
  })

  it('update: version が +1 され、status・report_count は変わらない', async () => {
    const { pages: repo, reports } = createRepos()
    await repo.create(buildInput({ id: 'page-update' }))
    await reports.insertIfNotDuplicate(
      {
        id: 'report-page-update',
        pageId: 'page-update',
        reason: 'spam',
        comment: null,
        ipHash: 'ip-x',
        now: NOW,
      },
      new Date('2026-09-15T00:00:00.000Z'),
    )

    const result = await repo.update('page-update', {
      rawText: '9/21 20時 新宿で飲み会',
      event: eventFields({ title: '飲み会（変更後）', location: '新宿' }),
      expiresAt: new Date('2026-09-28T00:00:00.000Z'),
      previousSnapshot: null,
      now: new Date('2026-09-17T00:00:00.000Z'),
    })
    expect(result).toBe('ok')

    const page = await repo.findById('page-update')
    expect(page?.version).toBe(2)
    expect(page?.status).toBe('active')
    expect(page?.reportCount).toBe(1)
    expect(page?.expiresAt).toEqual(new Date('2026-09-28T00:00:00.000Z'))
    expect(page?.rawText).toBe('9/21 20時 新宿で飲み会')
    expect(page?.event.title).toBe('飲み会（変更後）')
    expect(page?.event.location).toBe('新宿')
    expect(page?.event.id).toBe('page-update-event')
    expect(page?.createdAt).toEqual(NOW)
    expect(page?.updatedAt).toEqual(new Date('2026-09-17T00:00:00.000Z'))
    expect(page?.event.createdAt).toEqual(NOW)
    expect(page?.event.updatedAt).toEqual(new Date('2026-09-17T00:00:00.000Z'))
  })

  it('update: メモ・終日・日時未確定への変更が往復する', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-update-null-dates' }))

    const result = await repo.update('page-update-null-dates', {
      rawText: '9/21 未定',
      event: eventFields({ memo: 'あとで決める', isAllDay: true, start: null, end: null }),
      expiresAt: new Date('2026-09-28T00:00:00.000Z'),
      previousSnapshot: null,
      now: new Date('2026-09-17T00:00:00.000Z'),
    })
    expect(result).toBe('ok')

    const page = await repo.findById('page-update-null-dates')
    expect(page?.event.memo).toBe('あとで決める')
    expect(page?.event.isAllDay).toBe(true)
    expect(page?.event.start).toBeNull()
    expect(page?.event.end).toBeNull()
  })

  it('update: 並行呼び出しでも version が呼んだ回数だけ増える', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-concurrent-version' }))

    const concurrency = 5
    await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        repo.update('page-concurrent-version', {
          rawText: `update-${i}`,
          event: eventFields(),
          expiresAt: NOW,
          previousSnapshot: null,
          now: NOW,
        }),
      ),
    )

    const page = await repo.findById('page-concurrent-version')
    expect(page?.version).toBe(1 + concurrency)
  })

  it('update: previousSnapshot 指定と null を並行実行しても、指定した値が失われない', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-concurrent-snapshot' }))
    const snapshot: ChangeSnapshot = {
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
      titleChanged: false,
      locationChanged: false,
    }

    await Promise.all([
      repo.update('page-concurrent-snapshot', {
        rawText: 'with-snapshot',
        event: eventFields(),
        expiresAt: NOW,
        previousSnapshot: snapshot,
        now: NOW,
      }),
      repo.update('page-concurrent-snapshot', {
        rawText: 'without-snapshot',
        event: eventFields(),
        expiresAt: NOW,
        previousSnapshot: null,
        now: NOW,
      }),
    ])

    const page = await repo.findById('page-concurrent-snapshot')
    expect(page?.previousSnapshot).toEqual(snapshot)
  })

  it('update: previousSnapshot が null の更新は既存の previousSnapshot・changedAt を維持する', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-snapshot' }))
    const snapshot: ChangeSnapshot = {
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
      titleChanged: false,
      locationChanged: false,
    }
    const changedAt = new Date('2026-09-17T00:00:00.000Z')
    await repo.update('page-snapshot', {
      rawText: '9/22 19時 渋谷で飲み会',
      event: eventFields({
        start: new Date('2026-09-22T10:00:00.000Z'),
        end: new Date('2026-09-22T11:00:00.000Z'),
      }),
      expiresAt: new Date('2026-09-29T00:00:00.000Z'),
      previousSnapshot: snapshot,
      now: changedAt,
    })

    const afterFirstUpdate = await repo.findById('page-snapshot')
    expect(afterFirstUpdate?.previousSnapshot).toEqual(snapshot)
    expect(afterFirstUpdate?.changedAt).toEqual(changedAt)

    // メモだけの変更など、変更バナー対象でない更新は previousSnapshot を上書きしない
    await repo.update('page-snapshot', {
      rawText: '9/22 19時 渋谷で飲み会\nメモを追記',
      event: eventFields({
        start: new Date('2026-09-22T10:00:00.000Z'),
        end: new Date('2026-09-22T11:00:00.000Z'),
        memo: 'メモを追記',
      }),
      expiresAt: new Date('2026-09-29T00:00:00.000Z'),
      previousSnapshot: null,
      now: new Date('2026-09-18T00:00:00.000Z'),
    })

    const afterSecondUpdate = await repo.findById('page-snapshot')
    expect(afterSecondUpdate?.previousSnapshot).toEqual(snapshot)
    expect(afterSecondUpdate?.changedAt).toEqual(changedAt)
    expect(afterSecondUpdate?.version).toBe(3)
  })

  it('countActiveByCreator: 同じ ip_hash または device_id を持つ active なページ数', async () => {
    const repo = createRepo()
    await repo.create(
      buildInput({ id: 'page-c1', creatorIpHash: 'ip-shared', creatorDeviceId: 'device-c1' }),
    )
    await repo.create(
      buildInput({ id: 'page-c2', creatorIpHash: 'ip-other', creatorDeviceId: 'device-shared' }),
    )
    await repo.create(
      buildInput({ id: 'page-c3', creatorIpHash: 'ip-shared', creatorDeviceId: 'device-shared' }),
    )
    await repo.create(
      buildInput({
        id: 'page-c4',
        creatorIpHash: 'ip-unrelated',
        creatorDeviceId: 'device-unrelated',
      }),
    )

    const count = await repo.countActiveByCreator('ip-shared', 'device-shared')
    expect(count).toBe(3)
  })

  it('countActiveByCreator: ip_hash が UNKNOWN_IP_HASH なら IP では一致させず device_id だけで数える', async () => {
    const repo = createRepo()
    await repo.create(
      buildInput({
        id: 'page-u1',
        creatorIpHash: UNKNOWN_IP_HASH,
        creatorDeviceId: 'device-reported',
      }),
    )
    await repo.create(
      buildInput({ id: 'page-u2', creatorIpHash: 'ip-other', creatorDeviceId: 'device-reported' }),
    )
    await repo.create(
      buildInput({
        id: 'page-u3',
        creatorIpHash: UNKNOWN_IP_HASH,
        creatorDeviceId: 'device-unrelated',
      }),
    )

    const count = await repo.countActiveByCreator(UNKNOWN_IP_HASH, 'device-reported')
    expect(count).toBe(2)
  })

  it('listExpired: expires_at が before より前のものだけを、古い順に limit 件まで返す', async () => {
    const repo = createRepo()
    await repo.create(
      buildInput({ id: 'page-exp-1', expiresAt: new Date('2026-09-10T00:00:00.000Z') }),
    )
    await repo.create(
      buildInput({ id: 'page-exp-2', expiresAt: new Date('2026-09-11T00:00:00.000Z') }),
    )
    await repo.create(
      buildInput({ id: 'page-exp-3', expiresAt: new Date('2026-09-30T00:00:00.000Z') }),
    )

    const expired = await repo.listExpired(new Date('2026-09-15T00:00:00.000Z'), 10)
    expect(expired).toEqual(['page-exp-1', 'page-exp-2'])

    const limited = await repo.listExpired(new Date('2026-09-15T00:00:00.000Z'), 1)
    expect(limited).toEqual(['page-exp-1'])
  })

  it('listExpired: expires_at が before と同じものは含まない', async () => {
    const repo = createRepo()
    const before = new Date('2026-09-15T00:00:00.000Z')
    await repo.create(buildInput({ id: 'page-exp-boundary', expiresAt: before }))

    expect(await repo.listExpired(before, 10)).toEqual([])
  })

  it('listExpired: expires_at が同値のときは id 順で安定する', async () => {
    const repo = createRepo()
    const expiresAt = new Date('2026-09-10T00:00:00.000Z')
    await repo.create(buildInput({ id: 'page-exp-tie-b', expiresAt }))
    await repo.create(buildInput({ id: 'page-exp-tie-a', expiresAt }))

    const expired = await repo.listExpired(new Date('2026-09-15T00:00:00.000Z'), 10)
    expect(expired).toEqual(['page-exp-tie-a', 'page-exp-tie-b'])
  })

  it('deleteByIds: 指定した id だけが消え、他は残る', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-del-1' }))
    await repo.create(buildInput({ id: 'page-del-2' }))

    await repo.deleteByIds(['page-del-1'])

    expect(await repo.findById('page-del-1')).toBeNull()
    expect(await repo.findById('page-del-2')).not.toBeNull()
  })

  it('deleteByIds: ページ削除で events も CASCADE で消え、同じ event id を再利用できる', async () => {
    const repo = createRepo()
    await repo.create(
      buildInput({ id: 'page-cascade', event: { id: 'evt-cascade', ...eventFields() } }),
    )

    await repo.deleteByIds(['page-cascade'])

    const result = await repo.create(
      buildInput({ id: 'page-cascade-2', event: { id: 'evt-cascade', ...eventFields() } }),
    )
    expect(result).toBe('ok')
  })

  it(`deleteByIds: D1_MAX_BIND_PARAMS（${D1_MAX_BIND_PARAMS}）を超える件数でも全件消せる`, async () => {
    const repo = createRepo()
    const count = D1_MAX_BIND_PARAMS + 1
    const ids = Array.from({ length: count }, (_, i) => `page-bulk-${i}`)
    for (const id of ids) {
      await repo.create(buildInput({ id, event: { id: `${id}-event`, ...eventFields() } }))
    }

    await repo.deleteByIds(ids)

    expect(await repo.listExpired(new Date('2099-01-01T00:00:00.000Z'), count + 1)).toEqual([])
  })

  it('clearExpiredSnapshots: changedAt が before より古い行だけ previousSnapshot・changedAt を NULL にする', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-old-snapshot' }))
    await repo.create(buildInput({ id: 'page-new-snapshot' }))
    const snapshot: ChangeSnapshot = {
      start: NOW,
      end: NOW,
      isAllDay: false,
      titleChanged: false,
      locationChanged: false,
    }
    await repo.update('page-old-snapshot', {
      rawText: 'x',
      event: eventFields(),
      expiresAt: NOW,
      previousSnapshot: snapshot,
      now: new Date('2026-09-10T00:00:00.000Z'),
    })
    await repo.update('page-new-snapshot', {
      rawText: 'x',
      event: eventFields(),
      expiresAt: NOW,
      previousSnapshot: snapshot,
      now: new Date('2026-09-19T00:00:00.000Z'),
    })

    const clearedCount = await repo.clearExpiredSnapshots(new Date('2026-09-18T00:00:00.000Z'))
    expect(clearedCount).toBe(1)

    const old = await repo.findById('page-old-snapshot')
    expect(old?.previousSnapshot).toBeNull()
    expect(old?.changedAt).toBeNull()

    const recent = await repo.findById('page-new-snapshot')
    expect(recent?.previousSnapshot).toEqual(snapshot)
  })

  it('clearExpiredSnapshots: changedAt が before と同じ行は消さない', async () => {
    const repo = createRepo()
    await repo.create(buildInput({ id: 'page-snapshot-boundary' }))
    const snapshot: ChangeSnapshot = {
      start: NOW,
      end: NOW,
      isAllDay: false,
      titleChanged: false,
      locationChanged: false,
    }
    const before = new Date('2026-09-15T00:00:00.000Z')
    await repo.update('page-snapshot-boundary', {
      rawText: 'x',
      event: eventFields(),
      expiresAt: NOW,
      previousSnapshot: snapshot,
      now: before,
    })

    const clearedCount = await repo.clearExpiredSnapshots(before)
    expect(clearedCount).toBe(0)

    const page = await repo.findById('page-snapshot-boundary')
    expect(page?.previousSnapshot).toEqual(snapshot)
  })
}

/**
 * update() が存在確認のために発行する events の SELECT が返ってきた直後に、
 * 別経路（GC の deleteByIds 等）で同じページが消えたケースを再現する D1Database ラッパー。
 * d1PageRepository.ts 自体には手を入れず、渡す db を差し替えるだけで割り込ませる
 */
function withPageDeletedAfterEventsCheck(db: D1Database, pageId: string): D1Database {
  return {
    prepare(sql: string) {
      if (!sql.startsWith('SELECT * FROM events WHERE page_id')) return db.prepare(sql)
      return {
        bind: (..._args: unknown[]) => ({
          all: async <T = unknown>() => {
            const result = await db.prepare(sql).bind(pageId).all<T>()
            await createD1PageRepository(db).deleteByIds([pageId])
            return result
          },
        }),
      } as unknown as D1PreparedStatement
    },
    batch: db.batch.bind(db),
  } as unknown as D1Database
}

describe('D1PageRepository', () => {
  runPageRepositoryTests(() => ({
    pages: createD1PageRepository(env.DB),
    reports: createD1ReportRepository(env.DB),
  }))

  it('update: 存在確認と UPDATE の間にページが削除されても not_found を返す', async () => {
    await createD1PageRepository(env.DB).create(buildInput({ id: 'page-race' }))

    const repo = createD1PageRepository(withPageDeletedAfterEventsCheck(env.DB, 'page-race'))
    const result = await repo.update('page-race', {
      rawText: 'x',
      event: eventFields(),
      expiresAt: NOW,
      previousSnapshot: null,
      now: NOW,
    })

    expect(result).toBe('not_found')
    expect(await createD1PageRepository(env.DB).findById('page-race')).toBeNull()
  })

  it('events が 2 行あるページを読むと InvariantViolation を投げる', async () => {
    const repo = createD1PageRepository(env.DB)
    await repo.create(
      buildInput({ id: 'page-invariant', event: { id: 'evt-invariant-1', ...eventFields() } }),
    )
    await env.DB.prepare(
      `INSERT INTO events (id, page_id, title, is_all_day, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    )
      .bind(
        'evt-invariant-2',
        'page-invariant',
        '重複イベント',
        NOW.toISOString(),
        NOW.toISOString(),
      )
      .run()

    await expect(repo.findById('page-invariant')).rejects.toThrow(InvariantViolation)
  })

  it('events が 2 行あるページを update すると InvariantViolation を投げる', async () => {
    const repo = createD1PageRepository(env.DB)
    await repo.create(
      buildInput({
        id: 'page-invariant-update',
        event: { id: 'evt-invariant-update-1', ...eventFields() },
      }),
    )
    await env.DB.prepare(
      `INSERT INTO events (id, page_id, title, is_all_day, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
    )
      .bind(
        'evt-invariant-update-2',
        'page-invariant-update',
        '重複イベント',
        NOW.toISOString(),
        NOW.toISOString(),
      )
      .run()

    await expect(
      repo.update('page-invariant-update', {
        rawText: 'x',
        event: eventFields(),
        expiresAt: NOW,
        previousSnapshot: null,
        now: NOW,
      }),
    ).rejects.toThrow(InvariantViolation)
  })

  it('events が 0 行のページを読むと InvariantViolation を投げる', async () => {
    const repo = createD1PageRepository(env.DB)
    await insertPageRow(env.DB, 'page-invariant-empty', NOW)

    await expect(repo.findById('page-invariant-empty')).rejects.toThrow(InvariantViolation)
  })

  it('events が 0 行のページを update すると InvariantViolation を投げる', async () => {
    const repo = createD1PageRepository(env.DB)
    await insertPageRow(env.DB, 'page-invariant-empty-update', NOW)

    await expect(
      repo.update('page-invariant-empty-update', {
        rawText: 'x',
        event: eventFields(),
        expiresAt: NOW,
        previousSnapshot: null,
        now: NOW,
      }),
    ).rejects.toThrow(InvariantViolation)
  })

  it('countActiveByCreator: hidden なページは数えない', async () => {
    const repo = createD1PageRepository(env.DB)
    await repo.create(
      buildInput({
        id: 'page-hidden',
        creatorIpHash: 'ip-hidden',
        creatorDeviceId: 'device-hidden',
      }),
    )
    await env.DB.prepare(`UPDATE pages SET status = 'hidden' WHERE id = ?`)
      .bind('page-hidden')
      .run()

    const count = await repo.countActiveByCreator('ip-hidden', 'device-hidden')
    expect(count).toBe(0)
  })
})

describe('memoryPageRepository', () => {
  runPageRepositoryTests(() => {
    const store = createMemoryPageStore()
    return {
      pages: createMemoryPageRepository(store),
      reports: createMemoryReportRepository(store),
    }
  })
})
