import { describe, expect, it } from 'vitest'
import { createApp } from '../../../src/server/app'
import { CONTENT_SECURITY_POLICY, X_ROBOTS_TAG } from '../../../src/server/lib/headers'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { errorCode, TEST_ORIGIN } from '../helpers/jsonRequest'

async function get(path: string): Promise<Response> {
  const deps = buildFakeDeps()
  const app = createApp(deps)
  return app.fetch(new Request(new URL(path, TEST_ORIGIN)))
}

// app.notFound（§5.4）がどのルートにも一致しないリクエストをパスの形で 3 通りに分けることを固定する
describe('app.notFound', () => {
  it('/api/* に一致しないパスは JSON の 404 になる', async () => {
    const res = await get('/api/no-such-endpoint')

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('.ics で終わるが :id の形式に合わないパスはプレーンテキストの 404 になる', async () => {
    const res = await get('/not-a-valid-id.ics')

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    expect(await res.text()).toBe('404 Not Found')
  })

  it('それ以外のパスは NotFound ビューの HTML になり、noindex とセキュリティヘッダが付く', async () => {
    const res = await get('/not-a-valid-page-id')

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(res.headers.get('X-Robots-Tag')).toBe(X_ROBOTS_TAG)
    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(await res.text()).toContain('このページは表示できません')
  })
})
