/**
 * SSR のレスポンスに付けるセキュリティヘッダの値（§9.1）。静的ページは手書きの `src/web/_headers`
 * が同じ値を持ち、test/unit/server/lib/headers.test.ts で両者の一致を検査する。
 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
export const X_CONTENT_TYPE_OPTIONS = 'nosniff'
export const REFERRER_POLICY = 'no-referrer'

/** noindex 対象の動的ルート（詳細ページ・ics・OGP 画像・編集・通報）に付ける（§9.5） */
export const X_ROBOTS_TAG = 'noindex, nofollow'
