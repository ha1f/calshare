// LINE 内蔵ブラウザ・Android 向けの分岐（§6.6、§7.3）。

const LINE_UA_PATTERN = /Line\//
const ANDROID_UA_PATTERN = /Android/

/** UA に `Line/` を含むかどうか。LINE 内蔵ブラウザ向けの href 書き換え・案内バナーの要否に使う */
export function isLineUserAgent(userAgent: string): boolean {
  return LINE_UA_PATTERN.test(userAgent)
}

/** UA が Android かどうか。ics ダウンロードの注記の要否に使う（§7.3） */
export function isAndroidUserAgent(userAgent: string): boolean {
  return ANDROID_UA_PATTERN.test(userAgent)
}

/**
 * カレンダーボタンの href に `openExternalBrowser=1` を付ける（§6.6）。Google カレンダーの URL は
 * 既に `?action=TEMPLATE&...` を持つため、`?` の文字列連結ではなく `URLSearchParams.set` を使う。
 * `href` は絶対 URL（`<a>` の `.href` プロパティが返す形）を渡す前提
 */
export function addOpenExternalBrowserParam(href: string): string {
  const url = new URL(href)
  url.searchParams.set('openExternalBrowser', '1')
  return url.toString()
}
