import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TEST_ORIGIN } from '../helpers/jsonRequest'

// SELF.fetch は Worker の手前にある Static Assets のルーティング層（§2.2）を経由しないので、
// env.ASSETS.fetch で直接検証する。アセット層 + Worker のフルスタックでのルーティングは e2e が担う。
describe('Static Assets（env.ASSETS.fetch 経由）', () => {
  it('/ が静的 HTML を返す', async () => {
    const res = await env.ASSETS.fetch(`${TEST_ORIGIN}/`)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(await res.text()).toContain('<textarea id="input">')
  })

  it('/done のレスポンスに _headers のセキュリティヘッダが付く', async () => {
    const res = await env.ASSETS.fetch(`${TEST_ORIGIN}/done`)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})
