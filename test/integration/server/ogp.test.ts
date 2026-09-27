import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { requireDefined } from '../../../src/core/assert'
import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createD1PageRepository } from '../../../src/adapters/d1/d1PageRepository'
import { createMemoryObjectStorage } from '../../../src/adapters/memory/memoryObjectStorage'
import {
  OGP_CACHE_MAX_AGE_SECONDS,
  OGP_FAILURE_CACHE_SECONDS,
} from '../../../src/core/config/limits'
import { createApp } from '../../../src/server/app'
import type { Deps } from '../../../src/server/deps'
import type { Logger } from '../../../src/ports/logger'
import type { OgpInput, OgpRenderer } from '../../../src/ports/ogpRenderer'
import type { NewPageInput, PageRepository } from '../../../src/ports/pageRepository'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { TEST_ORIGIN } from '../helpers/jsonRequest'

const NOW = new Date('2026-09-16T01:00:00.000Z')
const CROCKFORD_CHARS = '0123456789abcdefghjkmnpqrstvwxyz'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** PAGE_ID_PATTERN（Crockford Base32 小文字 12 文字）を満たすテスト用 ID を重複無く発行する */
function pageId(n: number): string {
  return requireDefined(CROCKFORD_CHARS[n], 'CROCKFORD_CHARS: index out of range').repeat(12)
}

async function createPage(repo: PageRepository, id: string): Promise<void> {
  const input: NewPageInput = {
    id,
    editTokenHash: 'token-hash',
    rawText: '9/20 19時 渋谷で飲み会',
    event: {
      id: `${id}-event`,
      title: '飲み会',
      location: '渋谷',
      memo: null,
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
    },
    expiresAt: new Date('2026-09-27T00:00:00.000Z'),
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

function countingRenderer(): OgpRenderer & { calls: OgpInput[] } {
  const calls: OgpInput[] = []
  return {
    calls,
    render: async (input) => {
      calls.push(input)
      return new Uint8Array(PNG_SIGNATURE)
    },
  }
}

function throwingRenderer(): OgpRenderer & { calls: number } {
  const renderer = {
    calls: 0,
    render: async (): Promise<Uint8Array> => {
      renderer.calls++
      throw new Error('render failed')
    },
  }
  return renderer
}

function buildOgpDeps(overrides: Partial<Deps> = {}): { deps: Deps; repo: PageRepository } {
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

async function expectPngBody(res: Response): Promise<void> {
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('image/png')
  const bytes = new Uint8Array(await res.arrayBuffer())
  expect(Array.from(bytes.slice(0, PNG_SIGNATURE.length))).toEqual(PNG_SIGNATURE)
}

describe('GET /:id/ogp.png（OGP 画像、§2.5）', () => {
  it('初回だけレンダラを呼び、waitUntil の完了後は R2 に生成結果がある', async () => {
    const renderer = countingRenderer()
    const { deps, repo } = buildOgpDeps({ ogpRenderer: renderer })
    const id = pageId(0)
    await createPage(repo, id)

    const first = await get(deps, `/${id}/ogp.png`)
    await expectPngBody(first)
    expect(renderer.calls).toHaveLength(1)

    const stored = await deps.storage.getOgpImage(id, 1)
    expect(stored).not.toBeNull()

    // Cache API のヒットで検証をすり抜けないよう `?v=` を変えて 2 回目を投げる（§2.4 の keepQuery）
    const second = await get(deps, `/${id}/ogp.png?v=1`)
    await expectPngBody(second)
    expect(renderer.calls).toHaveLength(1) // R2 から返るのでレンダラは再度呼ばれない
  })

  it('レンダラが throw したらフォールバック PNG を返し、失敗マーカーを R2 に置く', async () => {
    const renderer = throwingRenderer()
    const { deps, repo } = buildOgpDeps({ ogpRenderer: renderer })
    const id = pageId(1)
    await createPage(repo, id)

    const res = await get(deps, `/${id}/ogp.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${OGP_CACHE_MAX_AGE_SECONDS}`)
    expect(renderer.calls).toBe(1)

    const failed = await deps.storage.getOgpFailureMarker(id, 1)
    expect(failed).toBe(true)
    const stored = await deps.storage.getOgpImage(id, 1)
    expect(stored).toBeNull()
  })

  it('失敗マーカーがあればレンダラを呼ばずフォールバックを返す', async () => {
    const renderer = countingRenderer()
    const { deps, repo } = buildOgpDeps({ ogpRenderer: renderer })
    const id = pageId(2)
    await createPage(repo, id)
    await deps.storage.putOgpFailureMarker(id, 1, 300)

    const res = await get(deps, `/${id}/ogp.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${OGP_CACHE_MAX_AGE_SECONDS}`)
    expect(renderer.calls).toHaveLength(0)
  })

  it('hidden なページはフォールバックを返す', async () => {
    const renderer = countingRenderer()
    const { deps, repo } = buildOgpDeps({ ogpRenderer: renderer })
    const id = pageId(3)
    await createPage(repo, id)
    await hidePage(id)

    const res = await get(deps, `/${id}/ogp.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${OGP_CACHE_MAX_AGE_SECONDS}`)
    expect(renderer.calls).toHaveLength(0)
  })

  it('存在しないページはフォールバックを返す', async () => {
    const renderer = countingRenderer()
    const { deps } = buildOgpDeps({ ogpRenderer: renderer })

    const res = await get(deps, `/${pageId(4)}/ogp.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${OGP_CACHE_MAX_AGE_SECONDS}`)
    expect(renderer.calls).toHaveLength(0)
  })

  it('動的ルートなので X-Robots-Tag が付く', async () => {
    const { deps, repo } = buildOgpDeps({ ogpRenderer: countingRenderer() })
    const id = pageId(5)
    await createPage(repo, id)

    const res = await get(deps, `/${id}/ogp.png`)
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('期限切れのページはレンダラを呼ばずフォールバックを返す', async () => {
    const renderer = countingRenderer()
    const { deps, repo } = buildOgpDeps({ ogpRenderer: renderer })
    const id = pageId(6)
    await createPage(repo, id)
    await expirePage(id, NOW) // isServable は expiresAt > now を要求するのでちょうど now は期限切れ扱い

    const res = await get(deps, `/${id}/ogp.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${OGP_CACHE_MAX_AGE_SECONDS}`)
    expect(renderer.calls).toHaveLength(0)
  })

  it('失敗マーカーの TTL 経過後は再びレンダラを呼ぶ', async () => {
    // buildFakeDeps はデフォルトの storage を自前の clock で作るため、TTL を進めるには
    // clock と storage を同じインスタンスで揃えて override する必要がある
    const clock = fakeClock(NOW)
    const storage = createMemoryObjectStorage(clock)
    const renderer = countingRenderer()
    const repo = createD1PageRepository(env.DB)
    const deps = buildFakeDeps({ pages: repo, clock, storage, ogpRenderer: renderer })
    const id = pageId(7)
    await createPage(repo, id)
    await storage.putOgpFailureMarker(id, 1, OGP_FAILURE_CACHE_SECONDS)

    const first = await get(deps, `/${id}/ogp.png`)
    expect(first.status).toBe(200)
    expect(renderer.calls).toHaveLength(0)

    clock.set(new Date(NOW.getTime() + (OGP_FAILURE_CACHE_SECONDS + 1) * 1000))
    // Cache API のヒットをすり抜けるよう `?v=` を変える（§2.4 の keepQuery）
    const second = await get(deps, `/${id}/ogp.png?v=2`)
    await expectPngBody(second)
    expect(renderer.calls).toHaveLength(1)
  })

  it('クエリの組み合わせや ID のパーセントエンコードが違っても findById は 1 回だけ（キャッシュキーの正規化、§2.4）', async () => {
    const inner = createD1PageRepository(env.DB)
    const { pages, calls } = withFindByIdCounter(inner)
    const deps = buildFakeDeps({ pages, clock: fakeClock(NOW), ogpRenderer: countingRenderer() })
    const id = pageId(8)
    await createPage(inner, id)
    const percentEncoded = id
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16)}`)
      .join('')

    const a = await get(deps, `/${id}/ogp.png?v=1&foo=1`)
    const b = await get(deps, `/${id}/ogp.png?v=1&foo=2`)
    const c = await get(deps, `/${id}/ogp.png?foo=3&v=1`)
    const d = await get(deps, `/${percentEncoded}/ogp.png?v=1`)

    expect([a.status, b.status, c.status, d.status]).toEqual([200, 200, 200, 200])
    expect(calls()).toBe(1)
  })

  it('フォールバック PNG の本文は env.ASSETS.fetch の内容と一致する（ASSETS を包み直しているだけ）', async () => {
    const { deps } = buildOgpDeps({ ogpRenderer: countingRenderer() })

    const res = await get(deps, `/${pageId(9)}/ogp.png`)
    const assetRes = await env.ASSETS.fetch(new URL('/assets/img/ogp-fallback.png', TEST_ORIGIN))

    expect(await res.arrayBuffer()).toEqual(await assetRes.arrayBuffer())
  })

  it('R2 の読み取りが失敗してもレンダラを呼ばずフォールバックを返す（失敗マーカーは立てない）', async () => {
    const clock = fakeClock(NOW)
    const storage: Deps['storage'] = {
      ...createMemoryObjectStorage(clock),
      getOgpImage: async () => {
        throw new Error('r2 read failed')
      },
    }
    const renderer = countingRenderer()
    const repo = createD1PageRepository(env.DB)
    const deps = buildFakeDeps({ pages: repo, clock, storage, ogpRenderer: renderer })
    const id = pageId(10)
    await createPage(repo, id)

    const res = await get(deps, `/${id}/ogp.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(renderer.calls).toHaveLength(0)
  })

  it('R2 への書き込み（putOgpImage）が失敗しても waitUntil は例外にならずログに残る', async () => {
    const clock = fakeClock(NOW)
    const warnings: Array<{ event: string; data?: Record<string, unknown> | undefined }> = []
    const logger: Logger = {
      info() {},
      warn: (event, data) => warnings.push({ event, data }),
      error() {},
    }
    const storage: Deps['storage'] = {
      ...createMemoryObjectStorage(clock),
      putOgpImage: async () => {
        throw new Error('r2 write failed')
      },
    }
    const renderer = countingRenderer()
    const repo = createD1PageRepository(env.DB)
    const deps = buildFakeDeps({ pages: repo, clock, storage, ogpRenderer: renderer, logger })
    const id = pageId(11)
    await createPage(repo, id)

    // waitOnExecutionContext は get() の中で待つ。putOgpImage の reject を catch していなければここで投げる
    const res = await get(deps, `/${id}/ogp.png`)
    await expectPngBody(res)
    expect(warnings).toEqual([
      { event: 'ogp_store_failed', data: expect.objectContaining({ pageId: id }) },
    ])
  })
})
