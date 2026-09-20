import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TEST_ORIGIN } from '../helpers/jsonRequest'

describe('GET /api/health', () => {
  it('200 で { ok: true } を返し、キャッシュされない', async () => {
    const res = await SELF.fetch(`${TEST_ORIGIN}/api/health`)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
  })
})
