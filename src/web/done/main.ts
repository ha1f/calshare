import { isValidPageId } from '../../core/id/crockford'
import { buildGoogleCalendarUrl } from '../../core/google/buildGoogleCalendarUrl'
import { toJstParts } from '../../core/time/jst'
import { fromEventFieldsJson } from '../../core/types'
import { copyToClipboard } from '../lib/clipboard'
import { findHistoryEntry } from '../lib/history'
import { addOpenExternalBrowserParam, isLineUserAgent } from '../lib/lineUa'
import { canShare, shareUrl } from '../lib/share'

const COPY_MESSAGE_DURATION_MS = 2000

/**
 * expiresAt は JST 0 時ちょうどのことがあり、そのまま暦日に変換すると実際には見えなくなる日を
 * 指してしまう。詳細ページの footer（§6.3 の 11）と同じく 1ms 前の暦日を表示する
 */
function formatExpiresLabel(expiresAt: Date): string {
  const p = toJstParts(new Date(expiresAt.getTime() - 1))
  return `${p.m}/${p.d}`
}

/** `path` は `/` または `/{id}` のようにこの画面が組む相対パスに限る。念のため同一オリジンを確認する */
function redirectTo(path: string): void {
  const url = new URL(path, location.origin)
  location.replace(url.origin === location.origin ? url.toString() : '/')
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`done screen: #${id} is missing`)
  return el as T
}

function main(): void {
  const id = new URLSearchParams(location.search).get('id') ?? ''
  if (!isValidPageId(id)) {
    redirectTo('/')
    return
  }

  const entry = findHistoryEntry(id)
  if (entry === null) {
    // 直リンクや別端末で開いた場合、この端末の履歴には無い（§6.2）
    redirectTo(`/${id}`)
    return
  }

  const urlDisplay = requireElement<HTMLAnchorElement>('url-display')
  const copyButton = requireElement<HTMLButtonElement>('copy-button')
  const copyMessage = requireElement<HTMLElement>('copy-message')
  const lineShareLink = requireElement<HTMLAnchorElement>('line-share-link')
  const shareButton = requireElement<HTMLButtonElement>('share-button')
  const calendarSection = requireElement<HTMLElement>('calendar-section')
  const googleLink = requireElement<HTMLAnchorElement>('google-calendar-link')
  const icsLink = requireElement<HTMLAnchorElement>('ics-link')
  const draftNotice = requireElement<HTMLElement>('draft-notice')
  const expiresNotice = requireElement<HTMLElement>('expires-notice')
  const editLink = requireElement<HTMLAnchorElement>('edit-link')
  const resendNotice = requireElement<HTMLElement>('resend-notice')

  urlDisplay.href = entry.url
  urlDisplay.textContent = entry.url
  editLink.href = `/${entry.id}/edit`
  expiresNotice.textContent = `${formatExpiresLabel(new Date(entry.expiresAt))} まで表示されます`
  // 編集完了後の再掲時だけ出す。初回作成時には出さない（§6.2）
  resendNotice.hidden = entry.updatedAt === entry.createdAt

  lineShareLink.href = `https://line.me/R/share?text=${encodeURIComponent(entry.url)}`

  copyButton.addEventListener('click', () => {
    void copyToClipboard(entry.url).then((succeeded) => {
      if (!succeeded) return
      copyMessage.hidden = false
      setTimeout(() => {
        copyMessage.hidden = true
      }, COPY_MESSAGE_DURATION_MS)
    })
  })

  if (canShare()) {
    shareButton.hidden = false
    shareButton.addEventListener('click', () => {
      void shareUrl({ title: entry.fields.title, url: entry.url })
    })
  }

  const fields = fromEventFieldsJson(entry.fields)
  if (fields.start !== null && fields.end !== null) {
    calendarSection.hidden = false
    googleLink.href = buildGoogleCalendarUrl({
      title: fields.title,
      location: fields.location,
      memo: fields.memo,
      start: fields.start,
      end: fields.end,
      isAllDay: fields.isAllDay,
      detailUrl: entry.url,
    })
    icsLink.href = `/${entry.id}.ics`

    if (isLineUserAgent(navigator.userAgent)) {
      googleLink.href = addOpenExternalBrowserParam(googleLink.href)
      icsLink.href = addOpenExternalBrowserParam(icsLink.href)
    }
  } else {
    draftNotice.hidden = false
  }
}

main()
