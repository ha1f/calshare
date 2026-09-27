import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestFailedError, createPage, getPage, updatePage } from '../../../../src/web/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 実行環境の `AbortSignal.timeout` を一時的に外す。Safari / WKWebView の旧版を模す */
function withoutAbortSignalTimeout(run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
  Reflect.deleteProperty(AbortSignal, 'timeout')
  return run().finally(() => {
    if (original !== undefined) Object.defineProperty(AbortSignal, 'timeout', original)
  })
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('getPage', () => {
  it('id を URL に、editToken を Authorization: Bearer で送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'abc', rawText: '飲み会' }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await getPage('abc', 'token-123')

    expect(fetchMock).toHaveBeenCalledWith('/api/pages/abc', {
      headers: { Authorization: 'Bearer token-123' },
      signal: expect.any(AbortSignal) as AbortSignal,
    })
    expect(response).toEqual({ id: 'abc', rawText: '飲み会' })
  })

  it.each(['TimeoutError', 'AbortError'])(
    '%s は ApiRequestFailedError（code: INTERNAL）に変換する',
    async (name) => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', name)))

      const error = await getPage('abc', 'token-123').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApiRequestFailedError)
      expect(error).toMatchObject({ code: 'INTERNAL', status: 0 })
    },
  )

  it('AbortSignal.timeout 未対応環境でも signal なしで fetch する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'abc', rawText: '飲み会' }))
    vi.stubGlobal('fetch', fetchMock)

    await withoutAbortSignalTimeout(async () => {
      const response = await getPage('abc', 'token-123')
      expect(response).toEqual({ id: 'abc', rawText: '飲み会' })
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/pages/abc', {
      headers: { Authorization: 'Bearer token-123' },
      signal: null,
    })
  })

  it('タイムアウト・中断以外の fetch の失敗はそのまま投げる', async () => {
    const networkError = new TypeError('network error')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError))

    await expect(getPage('abc', 'token-123')).rejects.toBe(networkError)
  })

  it('2xx 以外なら ApiRequestFailedError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'UNAUTHORIZED', message: '' })),
    )

    await expect(getPage('abc', 'wrong-token')).rejects.toBeInstanceOf(ApiRequestFailedError)
  })

  it('エラーメッセージに呼び出し元の操作名が入る（作成専用の文言に固定されない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'UNAUTHORIZED', message: '' })),
    )

    await expect(getPage('abc', 'wrong-token')).rejects.toMatchObject({
      message: expect.stringContaining('get page') as string,
    })
  })
})

describe('createPage', () => {
  it('エラーメッセージに operation として create page が入る', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(400, { code: 'EMPTY_INPUT', message: '' })),
    )

    await expect(
      createPage({
        rawText: '飲み会',
        fields: {
          title: '飲み会',
          location: null,
          memo: null,
          start: null,
          end: null,
          isAllDay: false,
        },
        source: 'direct',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('create page') as string })
  })
})

describe('updatePage', () => {
  it('PATCH で id・Authorization・body を送る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'abc' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      rawText: '飲み会',
      fields: {
        title: '飲み会',
        location: null,
        memo: null,
        start: null,
        end: null,
        isAllDay: false,
      },
    }
    await updatePage('abc', 'token-123', request)

    expect(fetchMock).toHaveBeenCalledWith('/api/pages/abc', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-123',
      },
      body: JSON.stringify(request),
      signal: expect.any(AbortSignal) as AbortSignal,
    })
  })
})
