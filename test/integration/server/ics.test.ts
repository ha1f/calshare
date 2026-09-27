import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { requireDefined } from '../../../src/core/assert'
import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createD1PageRepository } from '../../../src/adapters/d1/d1PageRepository'
import { X_ROBOTS_TAG } from '../../../src/server/lib/headers'
import { buildIcsForPage } from '../../../src/server/lib/ics'
import type { CreatePageResponse } from '../../../src/core/api/types'
import type { EventFields, EventFieldsJson } from '../../../src/core/types'
import type { NewPageInput, PageRepository } from '../../../src/ports/pageRepository'
import type { Logger } from '../../../src/ports/logger'
import type { ObjectStorage } from '../../../src/ports/objectStorage'
import type { Deps } from '../../../src/server/deps'
import { createApp } from '../../../src/server/app'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'

const NOW = new Date('2026-09-16T01:00:00.000Z')
const CROCKFORD_CHARS = '0123456789abcdefghjkmnpqrstvwxyz'

/** PAGE_ID_PATTERN（Crockford Base32 小文字 12 文字）を満たすテスト用 ID を重複無く発行する */
function pageId(n: number): string {
  return requireDefined(CROCKFORD_CHARS[n], 'CROCKFORD_CHARS: index out of range').repeat(12)
}

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

function eventFieldsJson(overrides: Partial<EventFieldsJson> = {}): EventFieldsJson {
  return {
    title: '飲み会',
    location: '渋谷',
    memo: null,
    start: '2026-09-20T10:00:00.000Z',
    end: '2026-09-20T11:00:00.000Z',
    isAllDay: false,
    ...overrides,
  }
}

async function createPage(
  repo: PageRepository,
  id: string,
  options: { event?: Partial<EventFields>; expiresAt?: Date } = {},
): Promise<void> {
  const input: NewPageInput = {
    id,
    editTokenHash: 'token-hash',
    rawText: '9/20 19時 渋谷で飲み会',
    event: { id: `${id}-event`, ...eventFields(options.event) },
    expiresAt: options.expiresAt ?? new Date('2026-09-27T00:00:00.000Z'),
    source: 'direct',
    creatorIpHash: 'ip-hash',
    creatorDeviceId: 'device-1',
    now: NOW,
  }
  const result = await repo.create(input)
  if (result !== 'ok') throw new Error(`failed to create page: ${result}`)
}

async function hidePage(id: string): Promise<void> {
  await env.DB.prepare(`UPDATE pages SET status = 'hidden' WHERE id = ?`).bind(id).run()
}

async function expirePage(id: string, expiresAt: Date): Promise<void> {
  await env.DB.prepare('UPDATE pages SET expires_at = ? WHERE id = ?')
    .bind(expiresAt.toISOString(), id)
    .run()
}

function withFindByIdCounter(inner: PageRepository): {
  pages: PageRepository
  calls: () => number
} {
  let calls = 0
  const pages: PageRepository = {
    ...inner,
    async findById(id) {
      calls++
      return inner.findById(id)
    },
  }
  return { pages, calls: () => calls }
}

function withPutIcsCounter(inner: ObjectStorage): {
  storage: ObjectStorage
  calls: () => number
} {
  let calls = 0
  const storage: ObjectStorage = {
    ...inner,
    async putIcs(pageId, body) {
      calls++
      return inner.putIcs(pageId, body)
    },
  }
  return { storage, calls: () => calls }
}

function buildIcsDeps(overrides: Partial<Deps> = {}): { deps: Deps; repo: PageRepository } {
  const repo = createD1PageRepository(env.DB)
  const deps = buildFakeDeps({ pages: repo, clock: fakeClock(NOW), ...overrides })
  return { deps, repo }
}

async function get(deps: Deps, path: string): Promise<Response> {
  const app = createApp(deps)
  const ctx = createExecutionContext()
  const res = await app.fetch(new Request(new URL(path, TEST_ORIGIN)), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('GET /:id.ics（ics 配信、§7.2）', () => {
  it('text/calendar で配信され、本文が buildIcsForPage の出力と一致する', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(0)
    await createPage(repo, id)

    const res = await get(deps, `/${id}.ics`)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    // iOS の取り込みプレビューを優先するため付けない（§7.2）
    expect(res.headers.get('Content-Disposition')).toBeNull()
    const page = await repo.findById(id)
    if (page === null) throw new Error('expected page to exist')
    expect(text).toBe(buildIcsForPage(page, deps.config, NOW))
    expect(text).toContain('SUMMARY:飲み会')
  })

  it('本文は最新の内容を反映する（PATCH 後に旧タイトルが消え SEQUENCE が上がる）', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const createRes = await app.fetch(
      jsonRequest('/api/pages', {
        method: 'POST',
        body: { rawText: '9/20 19時 渋谷で飲み会', fields: eventFieldsJson(), source: 'direct' },
      }),
    )
    const created = (await createRes.json()) as CreatePageResponse

    const updateRes = await app.fetch(
      jsonRequest(`/api/pages/${created.id}`, {
        method: 'PATCH',
        body: {
          rawText: '9/20 19時 渋谷で二次会',
          fields: eventFieldsJson({ title: '二次会' }),
        },
        headers: { Authorization: `Bearer ${created.editToken}` },
      }),
    )
    expect(updateRes.status).toBe(200)

    const res = await get(deps, `/${created.id}.ics`)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('SUMMARY:二次会')
    expect(text).toContain('SEQUENCE:1')
    expect(text).not.toContain('SUMMARY:飲み会')
  })

  it('X-Robots-Tag が付く（§9.5）', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(1)
    await createPage(repo, id)

    const res = await get(deps, `/${id}.ics`)

    expect(res.headers.get('X-Robots-Tag')).toBe(X_ROBOTS_TAG)
  })

  it('正規表現ルートで .ics が必須（拡張子無し・別の拡張子は ics ルートに一致しない）', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(2)
    await createPage(repo, id)

    // 拡張子無しは詳細ページ（html）に落ちる（§2.2 の評価順序）
    const detail = await get(deps, `/${id}`)
    expect(detail.status).toBe(200)
    expect(detail.headers.get('Content-Type')).toContain('text/html')

    // 12 文字ちょうどの ID + 別の文字列は、ics ルートにも詳細ページにも一致せず 404
    const wrongSuffix = await get(deps, `/${id}xics`)
    expect(wrongSuffix.status).toBe(404)
    const extraSuffix = await get(deps, `/${id}.icsx`)
    expect(extraSuffix.status).toBe(404)
  })

  it('不正な ID 形式は 404 で、D1 には問い合わせない', async () => {
    const inner = createD1PageRepository(env.DB)
    const { pages, calls } = withFindByIdCounter(inner)
    const { deps } = buildIcsDeps({ pages })

    const res = await get(deps, '/not-a-valid-id.ics')

    expect(res.status).toBe(404)
    expect(calls()).toBe(0)
  })

  it('hidden のページは、R2 に ics が既にあっても 404（§4.1）', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(3)
    await createPage(repo, id)
    const page = await repo.findById(id)
    if (page === null) throw new Error('expected page to exist')
    const ics = buildIcsForPage(page, deps.config, NOW)
    if (ics === null) throw new Error('expected ics to be built')
    await deps.storage.putIcs(id, ics)
    await hidePage(id)

    const res = await get(deps, `/${id}.ics`)

    expect(res.status).toBe(404)
  })

  it('期限切れのページは 404', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(4)
    await createPage(repo, id)
    await expirePage(id, NOW) // isServable は expiresAt > now を要求するのでちょうど now は期限切れ扱い

    const res = await get(deps, `/${id}.ics`)

    expect(res.status).toBe(404)
  })

  it('下書き（日時なし）は 404', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(5)
    await createPage(repo, id, { event: { start: null, end: null } })

    const res = await get(deps, `/${id}.ics`)

    expect(res.status).toBe(404)
  })

  it('Cache API がヒットする（クエリが違っても D1 の findById は 1 回だけ）', async () => {
    const inner = createD1PageRepository(env.DB)
    const { pages, calls } = withFindByIdCounter(inner)
    const { deps } = buildIcsDeps({ pages })
    const id = pageId(6)
    await createPage(pages, id)

    const first = await get(deps, `/${id}.ics?x=1`)
    const second = await get(deps, `/${id}.ics?x=2`)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(calls()).toBe(1)
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it('自己修復: R2 に ics が無い isServable なページは buildIcsForPage の出力を 200 で返し、R2 に PUT する', async () => {
    const { deps: baseDeps, repo } = buildIcsDeps()
    const { storage, calls } = withPutIcsCounter(baseDeps.storage)
    const deps = { ...baseDeps, storage }
    const id = pageId(7)
    await createPage(repo, id)
    expect(await deps.storage.getIcs(id)).toBeNull() // 作成 API を経由していないので R2 には無い状態

    const res = await get(deps, `/${id}.ics`)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('SUMMARY:飲み会')
    expect(await deps.storage.getIcs(id)).toBe(text)
    expect(calls()).toBe(1)
  })

  it('R2 に ics が既にあれば buildIcsForPage で再生成しない', async () => {
    const { deps: baseDeps, repo } = buildIcsDeps()
    const id = pageId(8)
    await createPage(repo, id)
    // buildIcsForPage が生成しうる文字列と区別できるよう、実物とは異なる印を置く。
    // 中身を検証せずそのまま返していることを確認するため
    const seededIcs = 'BEGIN:VCALENDAR\r\nX-TEST-SEED:untouched\r\nEND:VCALENDAR\r\n'
    // カウンタで包む前に R2 相当の状態を用意する。包んだ後に予め置くと、その呼び出し自体を数えてしまう
    await baseDeps.storage.putIcs(id, seededIcs)
    const { storage, calls } = withPutIcsCounter(baseDeps.storage)
    const deps = { ...baseDeps, storage }

    const res = await get(deps, `/${id}.ics`)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toBe(seededIcs)
    expect(calls()).toBe(0) // R2 に既にあるので putIcs は呼ばれない
  })

  it('日時ありから下書き（日時なし）に更新すると、R2 に古い ics が残っていても 404', async () => {
    const { deps, repo } = buildIcsDeps()
    const id = pageId(11)
    await createPage(repo, id)
    const page = await repo.findById(id)
    if (page === null) throw new Error('expected page to exist')
    const staleIcs = buildIcsForPage(page, deps.config, NOW)
    if (staleIcs === null) throw new Error('expected ics to be built')
    // R2 に古い ics を置いた状態を作る。作成 API 経由の同期 PUT が既に終わった後を模す
    await deps.storage.putIcs(id, staleIcs)

    const result = await repo.update(id, {
      rawText: page.rawText,
      event: eventFields({ start: null, end: null }),
      expiresAt: page.expiresAt,
      previousSnapshot: null,
      now: NOW,
    })
    if (result !== 'ok') throw new Error(`failed to update page: ${result}`)

    const res = await get(deps, `/${id}.ics`)

    expect(res.status).toBe(404)
  })

  it('自己修復の putIcs が失敗しても、生成済みの ics を 200 で返し logger.error を呼ぶ', async () => {
    const { deps: baseDeps, repo } = buildIcsDeps()
    const putError = new Error('r2 down')
    const storage: ObjectStorage = {
      ...baseDeps.storage,
      async putIcs() {
        throw putError
      },
    }
    const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const deps = { ...baseDeps, storage, logger }
    const id = pageId(9)
    await createPage(repo, id)

    const res = await get(deps, `/${id}.ics`)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('SUMMARY:飲み会')
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('ics_self_heal_put_failed', {
      error: putError,
      pageId: id,
    })
  })

  it('パーセントエンコードした ID でもキャッシュキーが同じになる（D1 への直叩き対策、§2.4）', async () => {
    const inner = createD1PageRepository(env.DB)
    const { pages, calls } = withFindByIdCounter(inner)
    const { deps } = buildIcsDeps({ pages })
    const id = pageId(10)
    await createPage(pages, id)
    const percentEncoded = id
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16)}`)
      .join('')

    const plain = await get(deps, `/${id}.ics`)
    const encoded = await get(deps, `/${percentEncoded}.ics`)
    const mixed = await get(deps, `/${id[0]}${percentEncoded.slice(3)}.ics`)
    const withQuery = await get(deps, `/${id}.ics?x=1`)

    expect([plain.status, encoded.status, mixed.status, withQuery.status]).toEqual([
      200, 200, 200, 200,
    ])
    expect(calls()).toBe(1)
  })
})
