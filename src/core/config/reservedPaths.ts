/**
 * ページ ID（12 文字固定、§4.2）と衝突しないことを ID 生成器の単体テストで保証するための予約パス一覧。
 * 静的アセットと `/api/*` の 1 セグメント目がここに含まれる（§2.2 のルーティング評価順序）。
 */
export const RESERVED_PATHS = [
  'new',
  'done',
  'history',
  'edit',
  'api',
  'assets',
  'robots.txt',
  'favicon.ico',
] as const
