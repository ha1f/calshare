import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../../src/server/app'
import { CONTENT_SECURITY_POLICY, X_ROBOTS_TAG } from '../../../src/server/lib/headers'
import type { Deps } from '../../../src/server/deps'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { errorCode, TEST_ORIGIN } from '../helpers/jsonRequest'

/** app.fetch を ExecutionContext 付きで呼ぶ。ics ルートは c.executionCtx を使うため必須 */
async function get(path: string, deps: Deps = buildFakeDeps()): Promise<Response> {
  const app = createApp(deps)
  const ctx = createExecutionContext()
  const res = await app.fetch(new Request(new URL(path, TEST_ORIGIN)), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

// app.notFound（docs/guidelines.md §5.4）がどのルートにも一致しないリクエストをパスの形で 3 通りに分けることを固定する
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

  it('形式は正しいが存在しない ID の /:id/report は c.notFound() 経由で NotFound ビューになる', async () => {
    const res = await get('/zzzzzzzzzzzz/report')

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(await res.text()).toContain('このページは表示できません')
  })

  it('形式は正しいが存在しない ID の /:id.ics は c.notFound() 経由でプレーンテキストの 404 になる', async () => {
    const res = await get('/zzzzzzzzzzzz.ics')

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('text/plain')
    expect(await res.text()).toBe('404 Not Found')
  })
})
