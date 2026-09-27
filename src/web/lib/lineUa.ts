// LINE 内蔵ブラウザ・Android 向けの分岐（§6.6、§7.3）。

import { createElement } from './dom'

const LINE_UA_PATTERN = /Line\//
const ANDROID_UA_PATTERN = /Android/
const LINE_BANNER_TEXT = 'うまく開けないときは右上メニューの「他のアプリで開く」を使ってください'
const ANDROID_ICS_NOTICE_TEXT = 'ダウンロード後、通知をタップして開いてください'

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

/**
 * カレンダーボタン（`a[data-calendar]`）を含むコンテナに、LINE 内蔵ブラウザ向けの href 書き換え・
 * 案内バナーと Android 向けの ics 注記を適用する（§6.6、§7.3）。LINE と Android は独立に判定するため、
 * Android 版 LINE では両方が適用される。ボタンが無いコンテナ（日時未定の下書き等）には何もしない
 */
export function applyCalendarUaHandling(container: Element, userAgent: string): void {
  const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[data-calendar]'))
  if (links.length === 0) return

  if (isLineUserAgent(userAgent)) {
    for (const link of links) link.href = addOpenExternalBrowserParam(link.href)
    container.before(
      createElement('p', {
        className: 'line-banner',
        text: LINE_BANNER_TEXT,
        attrs: { 'data-testid': 'line-banner' },
      }),
    )
  }

  if (isAndroidUserAgent(userAgent)) {
    const icsLink = container.querySelector<HTMLAnchorElement>('a[data-calendar="ics"]')
    icsLink?.after(
      createElement('p', {
        className: 'android-ics-notice',
        text: ANDROID_ICS_NOTICE_TEXT,
        attrs: { 'data-testid': 'android-ics-notice' },
      }),
    )
  }
}
