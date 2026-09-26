import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../../src/server/app'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { TEST_ORIGIN } from '../helpers/jsonRequest'

// env.ASSETS が dist/ の編集画面 HTML（edit.html）を配信できる必要があるため、
// このテストの前に `npm run build` が要る（§10.2、CI は build の後に test:integration を実行する）
describe('GET /:id/edit', () => {
  it('200 で編集画面の HTML 本文を返す（3xx でない）', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(new Request(new URL('/page00000001/edit', TEST_ORIGIN)), env)

    expect(res.status).toBe(200)
    expect(res.status).toBeLessThan(300)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    // _headers ファイルの CSP は ASSETS バインディング経由でも付くことを確認する（§9.5）
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    const body = await res.text()
    expect(body).toContain('/assets/js/edit.js')
    expect(body).toContain('noindex, nofollow')
  })

  it('X-Robots-Tag ヘッダが付く', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(new Request(new URL('/page00000001/edit', TEST_ORIGIN)), env)

    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('D1 には触れない（存在しないページの ID でも 200 を返す）', async () => {
    const deps = buildFakeDeps()
    const findByIdSpy = vi.spyOn(deps.pages, 'findById')
    const app = createApp(deps)

    const res = await app.fetch(new Request(new URL('/zzzzzzzzzzzz/edit', TEST_ORIGIN)), env)

    expect(res.status).toBe(200)
    expect(findByIdSpy).not.toHaveBeenCalled()
  })

  it('不正な ID 形式（短い・記号を含む）は 404', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(new Request(new URL('/short/edit', TEST_ORIGIN)), env)

    expect(res.status).toBe(404)
  })
})
