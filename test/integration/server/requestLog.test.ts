import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { consoleLogger } from '../../../src/adapters/logger/consoleLogger'
import { createApp } from '../../../src/server/app'
import type { RateLimitRule } from '../../../src/ports/rateLimiter'
import type { Deps } from '../../../src/server/deps'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'

type LogLine = Record<string, unknown>

/** app.fetch を ExecutionContext 付きで呼ぶ。ctx.waitUntil を使うルート（Cache API・通報通知）向け */
async function fetchApp(deps: Deps, request: Request): Promise<Response> {
  const app = createApp(deps)
  const ctx = createExecutionContext()
  const res = await app.fetch(request, env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('requestLog ミドルウェア（§9.6）', () => {
  let logSpy: MockInstance<typeof console.log>
  let errorSpy: MockInstance<typeof console.error>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function loggedLines(): LogLine[] {
    return logSpy.mock.calls.map((call) => JSON.parse(call[0] as string) as LogLine)
  }

  it('ルート名・メソッド・ステータス・所要時間がログに出る', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })

    const res = await fetchApp(deps, new Request(new URL('/api/health', TEST_ORIGIN)))

    expect(res.status).toBe(200)
    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({
      level: 'info',
      route: '/api/health',
      method: 'GET',
      status: 200,
    })
    expect(typeof completed?.durationMs).toBe('number')
    expect(completed?.durationMs as number).toBeGreaterThanOrEqual(0)
  })

  it('作成ログ（page_created）に pageId と source が出る。rawText 等の入力はどのログにも出ない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    const secretRawText = 'ひみつのテキスト__do_not_leak__9/20 19時 渋谷で飲み会'

    const res = await fetchApp(
      deps,
      jsonRequest('/api/pages?ref=detail_cta&secret=xyz', {
        method: 'POST',
        body: {
          rawText: secretRawText,
          fields: {
            title: '飲み会',
            location: '渋谷',
            memo: null,
            start: '2026-09-20T10:00:00.000Z',
            end: '2026-09-20T11:00:00.000Z',
            isAllDay: false,
          },
          source: 'detail_cta',
        },
        headers: {
          'CF-Connecting-IP': '203.0.113.7',
          Authorization: 'Bearer super-secret-token',
          Cookie: 'cs_device=11111111-1111-4111-8111-111111111111',
        },
      }),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string }

    const created = loggedLines().find((line) => line.event === 'page_created')
    expect(created).toMatchObject({ level: 'info', pageId: json.id, source: 'detail_cta' })

    const allLines = logSpy.mock.calls.map((call) => call[0] as string)
    for (const line of allLines) {
      expect(line).not.toContain(secretRawText)
      expect(line).not.toContain('super-secret-token')
      expect(line).not.toContain('203.0.113.7')
      expect(line).not.toContain('11111111-1111-4111-8111-111111111111')
      expect(line).not.toContain('secret=xyz')
    }
    // ルートはクエリ文字列を含まないパスパターンだけを記録する（§9.6）
    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed?.route).toBe('/api/pages')
  })

  it('429（レート制限超過）のログに exceeded のバケット種別が出て、リクエストログにも 429 が出る', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    vi.spyOn(deps.rateLimiter, 'consume').mockImplementation(
      async (rules: RateLimitRule[]): Promise<{ allowed: boolean; exceeded: RateLimitRule[] }> => ({
        allowed: false,
        exceeded: [rules.find((rule) => rule.bucketKey.startsWith('device:')) ?? rules[0]],
      }),
    )

    const res = await fetchApp(
      deps,
      jsonRequest('/api/pages', {
        method: 'POST',
        body: {
          rawText: '9/20 19時 渋谷で飲み会',
          fields: {
            title: '飲み会',
            location: '渋谷',
            memo: null,
            start: '2026-09-20T10:00:00.000Z',
            end: '2026-09-20T11:00:00.000Z',
            isAllDay: false,
          },
          source: 'direct',
        },
      }),
    )

    expect(res.status).toBe(429)
    const rateLimited = loggedLines().find((line) => line.event === 'rate_limited')
    expect(rateLimited).toMatchObject({ level: 'warn', scope: 'create' })
    expect(rateLimited?.exceeded).toEqual([expect.objectContaining({ bucket: 'device' })])

    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({ route: '/api/pages', method: 'POST', status: 429 })
  })

  it('想定外の例外（catch していないルート）は unhandled_error として構造化ログに残り、生のスタックトレースは console.error に出ない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    const secretInInput = 'user-controlled-input-marker'
    deps.pages.findById = () => {
      throw new Error(`boom while looking up ${secretInInput}`)
    }

    const res = await fetchApp(deps, new Request(new URL('/aaaaaaaaaaaa', TEST_ORIGIN)))

    expect(res.status).toBe(500)
    expect(errorSpy).not.toHaveBeenCalled()

    const failed = loggedLines().find((line) => line.event === 'unhandled_error')
    expect(failed).toMatchObject({ level: 'error', pageId: 'aaaaaaaaaaaa' })
    expect(failed?.route).toContain('/:id')
    const error = failed?.error as { name: string; message: string }
    expect(error.name).toBe('Error')
    expect(error).not.toHaveProperty('stack')

    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({ status: 500 })
    expect(completed?.route).toContain('/:id')
  })
})
