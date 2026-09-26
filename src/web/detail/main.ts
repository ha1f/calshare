import { createElement } from '../lib/dom'
import { addOpenExternalBrowserParam, isAndroidUserAgent, isLineUserAgent } from '../lib/lineUa'

const LINE_BANNER_TEXT = 'うまく開けないときは右上メニューの「他のアプリで開く」を使ってください'
const ANDROID_ICS_NOTICE_TEXT = 'ダウンロード後、通知をタップして開いてください'

function calendarLinks(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-calendar]'))
}

/** LINE 内蔵ブラウザ向けに、カレンダーボタンの href を書き換えて案内バナーを出す（§6.6） */
function applyLineHandling(): void {
  const links = calendarLinks()
  if (links.length === 0) return
  for (const link of links) {
    link.href = addOpenExternalBrowserParam(link.href)
  }
  const calendarSection = document.querySelector('[data-section="calendar"]')
  calendarSection?.before(createElement('p', { className: 'line-banner', text: LINE_BANNER_TEXT }))
}

/** Android の ics ボタン直下に、ダウンロード後に手動で開く必要があることの注記を足す（§7.3） */
function applyAndroidNotice(): void {
  const icsLink = document.querySelector<HTMLAnchorElement>('a[data-calendar="ics"]')
  icsLink?.after(
    createElement('p', { className: 'android-ics-notice', text: ANDROID_ICS_NOTICE_TEXT }),
  )
}

function main(): void {
  const userAgent = navigator.userAgent
  if (isLineUserAgent(userAgent)) {
    applyLineHandling()
  } else if (isAndroidUserAgent(userAgent)) {
    applyAndroidNotice()
  }
}

main()
