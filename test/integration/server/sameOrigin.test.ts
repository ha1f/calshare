import { describe, expect, it } from 'vitest'
import { createApp } from '../../../src/server/app'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'
import type { CreatePageRequest } from '../../../src/core/api/types'

/** ApiError の code だけを取り出す。Response#json() の戻り値が unknown 型のため */
async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code
}

// §9.8 の同一オリジン検証・JSON 必須を POST /api/pages 経由で検証する。項目検証には踏み込まないよう、
// このファイルでは常に有効な body を使う
function validBody(): CreatePageRequest {
  return {
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
  }
}

describe('POST /api/pages の同一オリジン検証・JSON 必須（§9.8）', () => {
  it('Content-Type が application/json 以外は 415', async () => {
    const app = createApp(buildFakeDeps())
    const res = await app.fetch(
      jsonRequest('/api/pages', {
        method: 'POST',
        body: validBody(),
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    expect(res.status).toBe(415)
    expect(await errorCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('Origin が別ドメインなら 403', async () => {
    const app = createApp(buildFakeDeps())
    const res = await app.fetch(
      jsonRequest('/api/pages', {
        method: 'POST',
        body: validBody(),
        headers: { Origin: 'https://evil.example' },
      }),
    )

    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN_ORIGIN')
  })

  it('Sec-Fetch-Site が same-origin 以外なら Origin が一致していても 403', async () => {
    const app = createApp(buildFakeDeps())
    const res = await app.fetch(
      jsonRequest('/api/pages', {
        method: 'POST',
        body: validBody(),
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      }),
    )

    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN_ORIGIN')
  })

  it('Sec-Fetch-Site: same-origin なら Origin ヘッダが無くても通る', async () => {
    const app = createApp(buildFakeDeps())
    const request = jsonRequest('/api/pages', {
      method: 'POST',
      body: validBody(),
      headers: { 'Sec-Fetch-Site': 'same-origin' },
    })
    request.headers.delete('Origin')

    const res = await app.fetch(request)

    expect(res.status).toBe(200)
  })

  it('Origin と Sec-Fetch-Site の両方が無ければ通す（古いクライアント）', async () => {
    const app = createApp(buildFakeDeps())
    const request = jsonRequest('/api/pages', { method: 'POST', body: validBody() })
    request.headers.delete('Origin')

    const res = await app.fetch(request)

    expect(res.status).toBe(200)
  })

  it('Content-Type と Origin が正しければ 200', async () => {
    const app = createApp(buildFakeDeps())
    const res = await app.fetch(jsonRequest('/api/pages', { method: 'POST', body: validBody() }))

    expect(res.status).toBe(200)
    expect(((await res.json()) as { url: string }).url).toContain(TEST_ORIGIN)
  })
})
