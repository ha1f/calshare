import {
  CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
  X_CONTENT_TYPE_OPTIONS,
  X_ROBOTS_TAG,
} from '../lib/headers'

/**
 * SSR のレスポンスに §9.1 のセキュリティヘッダと §9.5 の X-Robots-Tag を付ける。
 * 静的ページは `_headers` ファイルが担当するのでここでは扱わない
 */
export function applySecurityHeaders(res: Response): Response {
  res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  res.headers.set('X-Content-Type-Options', X_CONTENT_TYPE_OPTIONS)
  res.headers.set('Referrer-Policy', REFERRER_POLICY)
  res.headers.set('X-Robots-Tag', X_ROBOTS_TAG)
  return res
}
