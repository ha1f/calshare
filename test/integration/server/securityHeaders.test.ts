import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { CONTENT_SECURITY_POLICY } from '../../../src/server/lib/headers'
import { TEST_ORIGIN } from '../helpers/jsonRequest'

// §9.1 のヘッダは全ルートにミドルウェアで付く。detail.test.ts は /:id 側からこれを固定しているので、
// ここでは他の経路（/api/* と未定義パスの 404）が漏れていないことだけを確認する
describe('セキュリティヘッダがルートを問わず全体に付く（§9.1）', () => {
  it('/api/health にも付く', async () => {
    const res = await exports.default.fetch(`${TEST_ORIGIN}/api/health`)

    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })

  it('どのルートにも一致しない 404 にも付く', async () => {
    const res = await exports.default.fetch(`${TEST_ORIGIN}/not-a-valid-id`)

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })
})
