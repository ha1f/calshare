import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestFailedError, getPage, updatePage } from '../../../../src/web/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    })
    expect(response).toEqual({ id: 'abc', rawText: '飲み会' })
  })

  it('2xx 以外なら ApiRequestFailedError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'UNAUTHORIZED', message: '' })),
    )

    await expect(getPage('abc', 'wrong-token')).rejects.toBeInstanceOf(ApiRequestFailedError)
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
    })
  })
})
