import { createMiddleware } from 'hono/factory'
import {
  CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
  X_CONTENT_TYPE_OPTIONS,
  X_ROBOTS_TAG,
} from '../lib/headers'

/**
 * レスポンスに §9.1 のセキュリティヘッダと X-Robots-Tag を付ける。
 * 静的ページは `_headers` ファイルが担当するのでここでは扱わない
 */
export function applySecurityHeaders(res: Response): Response {
  res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  res.headers.set('X-Content-Type-Options', X_CONTENT_TYPE_OPTIONS)
  res.headers.set('Referrer-Policy', REFERRER_POLICY)
  res.headers.set('X-Robots-Tag', X_ROBOTS_TAG)
  return res
}

/**
 * 全ルートに `applySecurityHeaders` を適用する Hono ミドルウェア（§9.1）。
 * Cache API から返るレスポンスはヘッダが不変なため、`new Response` で包み直してから付け直す
 */
export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next()
    c.res = applySecurityHeaders(new Response(c.res.body, c.res))
  })
}
