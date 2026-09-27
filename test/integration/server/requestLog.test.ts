import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { HTTPException } from 'hono/http-exception'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { requireDefined } from '../../../src/core/assert'
import { consoleLogger } from '../../../src/adapters/logger/consoleLogger'
import { PAGE_ID_PATTERN } from '../../../src/core/id/crockford'
import { createApp } from '../../../src/server/app'
import { apiRequestError } from '../../../src/server/lib/errors'
import type { RateLimitRule } from '../../../src/ports/rateLimiter'
import type { Deps } from '../../../src/server/deps'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'

type LogLine = Record<string, unknown>

// detail.tsx が `app.get(`/:id{${PAGE_ID_PATTERN}}`, ...)` で登録する実際のルート名（Hono の routePath() の戻り値）
const DETAIL_ROUTE = `/:id{${PAGE_ID_PATTERN}}`

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

  it('作成ログ（page_created）に pageId と source が出る。rawText・title・location・memo 等の入力はどのログにも出ない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    const secretRawText = '__do_not_leak_rawtext__9/20 19時 渋谷で飲み会'
    const secretTitle = '__do_not_leak_title__'
    const secretLocation = '__do_not_leak_location__'
    const secretMemo = '__do_not_leak_memo__'

    const res = await fetchApp(
      deps,
      jsonRequest('/api/pages?ref=detail_cta&secret=xyz', {
        method: 'POST',
        body: {
          rawText: secretRawText,
          fields: {
            title: secretTitle,
            location: secretLocation,
            memo: secretMemo,
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
    const json = await res.json<{ id: string }>()

    const created = loggedLines().find((line) => line.event === 'page_created')
    expect(created).toMatchObject({ level: 'info', pageId: json.id, source: 'detail_cta' })

    const allLines = logSpy.mock.calls.map((call) => call[0] as string)
    const forbidden = [
      secretRawText,
      secretTitle,
      secretLocation,
      secretMemo,
      'super-secret-token',
      '203.0.113.7',
      '11111111-1111-4111-8111-111111111111',
      'secret=xyz',
    ]
    for (const line of allLines) {
      for (const value of forbidden) {
        expect(line).not.toContain(value)
      }
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
        exceeded: [
          rules.find((rule) => rule.bucketKey.startsWith('device:')) ??
            requireDefined(rules[0], 'rules is always non-empty in this test'),
        ],
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

  it('想定外の例外（catch していないルート）は unhandled_error として構造化ログに残り、name・message 以外は出ない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    // §9.6 が想定する「例外 message に入力由来の文字列が混ざる」ケース。message 自体は
    // consoleLogger（既存実装）の正規化（{ name, message }、200 文字切り詰め）で残るのが仕様
    const inputMarkerInMessage = 'user-controlled-input-marker'
    deps.pages.findById = () => {
      throw new Error(`boom while looking up ${inputMarkerInMessage}`)
    }

    const res = await fetchApp(deps, new Request(new URL('/aaaaaaaaaaaa', TEST_ORIGIN)))

    expect(res.status).toBe(500)

    const failed = loggedLines().find((line) => line.event === 'unhandled_error')
    expect(failed).toMatchObject({ level: 'error', route: DETAIL_ROUTE, pageId: 'aaaaaaaaaaaa' })
    const error = failed?.error as { name: string; message: string }
    expect(Object.keys(error).sort()).toEqual(['message', 'name'])
    expect(error.name).toBe('Error')
    expect(error.message).toContain(inputMarkerInMessage)

    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({ route: DETAIL_ROUTE, status: 500 })

    // Hono の既定 errorHandler（console.error(err) で生のスタックトレースを出す）を
    // app.onError が置き換えていることをここで確認する
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('POST /api/pages/:id/reports の :id が PAGE_ID_PATTERN に合わないと、どのルートにも一致せず URL の任意文字列が pageId としてログに出ない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    const bogusId = 'x'.repeat(5000)

    const res = await fetchApp(
      deps,
      jsonRequest(`/api/pages/${bogusId}/reports`, {
        method: 'POST',
        body: { reason: 'spam', comment: null },
      }),
    )

    expect(res.status).toBe(404)
    const completed = loggedLines().find((line) => line.event === 'request_completed')
    // どのルートにも一致しなかったリクエストなので、requestLog 自身の登録パス（'/*'）になる
    expect(completed).toMatchObject({ route: '/*', status: 404 })
    expect(completed).not.toHaveProperty('pageId')
    for (const line of logSpy.mock.calls.map((call) => call[0] as string)) {
      expect(line).not.toContain(bogusId)
    }
  })

  it('制御文字やエンコードされたマーカーを含む :id もログに残らない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })

    const res = await fetchApp(
      deps,
      jsonRequest('/api/pages/%0A%FF%3Cscript%3EEDIT_TOKEN_LEAK/reports', {
        method: 'POST',
        body: { reason: 'spam', comment: null },
      }),
    )

    expect(res.status).toBe(404)
    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({ status: 404 })
    expect(completed).not.toHaveProperty('pageId')
    for (const line of logSpy.mock.calls.map((call) => call[0] as string)) {
      expect(line).not.toContain('EDIT_TOKEN_LEAK')
    }
  })

  it('HTML ルートで ApiRequestError（4xx）が投げられても 500 はログに残る', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    deps.pages.findById = () => {
      throw apiRequestError(404, 'NOT_FOUND', 'page not found')
    }

    const res = await fetchApp(deps, new Request(new URL('/zzzzzzzzzzzz/report', TEST_ORIGIN)))

    expect(res.status).toBe(500)
    const failed = loggedLines().find((line) => line.event === 'unhandled_error')
    expect(failed).toMatchObject({ level: 'error' })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('HTTPException は Hono 既定の応答（getResponse）で返り、unhandled_error にならない', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })
    deps.pages.findById = () => {
      throw new HTTPException(403, { message: 'forbidden' })
    }

    const res = await fetchApp(deps, new Request(new URL('/aaaaaaaaaaaa', TEST_ORIGIN)))

    expect(res.status).toBe(403)
    expect(loggedLines().find((line) => line.event === 'unhandled_error')).toBeUndefined()
    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({ route: DETAIL_ROUTE, status: 403 })
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('GET /:id.ics の pageId は拡張子を除いた ID になり、detail などの他ルートと同じ値になる', async () => {
    const deps = buildFakeDeps({ logger: consoleLogger })

    const res = await fetchApp(deps, new Request(new URL('/aaaaaaaaaaaa.ics', TEST_ORIGIN)))

    expect(res.status).toBe(404)
    const completed = loggedLines().find((line) => line.event === 'request_completed')
    expect(completed).toMatchObject({ pageId: 'aaaaaaaaaaaa' })
  })
})
