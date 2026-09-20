import { describe, expect, it } from 'vitest'
import { jsonRequest, TEST_ORIGIN } from './jsonRequest'

describe('jsonRequest', () => {
  it('URL を TEST_ORIGIN 基準で組み立てる', () => {
    const req = jsonRequest('/api/pages', { method: 'POST', body: {} })
    expect(req.url).toBe(`${TEST_ORIGIN}/api/pages`)
  })

  it('既定で Origin と Content-Type を付ける', () => {
    const req = jsonRequest('/api/pages', { method: 'POST', body: {} })
    expect(req.headers.get('Origin')).toBe(TEST_ORIGIN)
    expect(req.headers.get('Content-Type')).toBe('application/json')
  })

  it('body を JSON.stringify して本文にする', async () => {
    const req = jsonRequest('/api/pages', { method: 'POST', body: { rawText: '飲み会' } })
    expect(await req.json()).toEqual({ rawText: '飲み会' })
  })

  it('method がそのままリクエストに反映される', () => {
    const req = jsonRequest('/api/pages/abc', { method: 'PATCH', body: {} })
    expect(req.method).toBe('PATCH')
  })

  it('headers で Origin を上書きできる（Origin 不一致のテスト用）', () => {
    const req = jsonRequest('/api/pages', {
      method: 'POST',
      body: {},
      headers: { Origin: 'https://evil.example.com' },
    })
    expect(req.headers.get('Origin')).toBe('https://evil.example.com')
  })

  it('headers で Content-Type を上書きできる（415 のテスト用）', () => {
    const req = jsonRequest('/api/pages', {
      method: 'POST',
      body: {},
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(req.headers.get('Content-Type')).toBe('text/plain')
  })
})
