import { COPY_MESSAGE_DURATION_MS } from '../../core/config/limits'
import { isValidPageId } from '../../core/id/crockford'
import { buildGoogleCalendarUrl } from '../../core/google/buildGoogleCalendarUrl'
import { toJstParts } from '../../core/time/jst'
import { fromEventFieldsJson } from '../../core/types'
import { copyToClipboard } from '../lib/clipboard'
import { requireElement } from '../lib/dom'
import { readHistory } from '../lib/history'
import type { HistoryEntry } from '../lib/history'
import { applyCalendarUaHandling } from '../lib/lineUa'
import { canShare, shareUrl } from '../lib/share'

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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * localStorage の履歴から id に一致する項目を探す。§6.4 が言う「localStorage の内容も信頼しない」に
 * 従い、fields や日時が壊れていれば見つからなかった扱いにする（この画面が例外で止まらないように）
 */
function findValidHistoryEntry(id: string): HistoryEntry | null {
  const entry = readHistory().find((e) => e.id === id)
  if (entry === undefined) return null

  if (
    !isHttpUrl(entry.url) ||
    Number.isNaN(Date.parse(entry.expiresAt)) ||
    Number.isNaN(Date.parse(entry.createdAt)) ||
    Number.isNaN(Date.parse(entry.updatedAt))
  ) {
    return null
  }

  try {
    fromEventFieldsJson(entry.fields)
  } catch {
    return null
  }

  return entry
}

function main(): void {
  const id = new URLSearchParams(location.search).get('id') ?? ''
  if (!isValidPageId(id)) {
    redirectTo('/')
    return
  }

  const entry = findValidHistoryEntry(id)
  if (entry === null) {
    // 直リンクや別端末で開いた場合、または履歴項目が壊れている場合はこの端末には無い扱いにする（§6.2）
    redirectTo(`/${id}`)
    return
  }

  const urlDisplay = requireElement('url-display', HTMLAnchorElement)
  const copyButton = requireElement('copy-button', HTMLButtonElement)
  const copyMessage = requireElement<HTMLElement>('copy-message')
  const copyError = requireElement<HTMLElement>('copy-error')
  const lineShareLink = requireElement('line-share-link', HTMLAnchorElement)
  const shareButton = requireElement('share-button', HTMLButtonElement)
  const calendarSection = requireElement<HTMLElement>('calendar-section')
  const googleLink = requireElement('google-calendar-link', HTMLAnchorElement)
  const icsLink = requireElement('ics-link', HTMLAnchorElement)
  const draftNotice = requireElement<HTMLElement>('draft-notice')
  const expiresNotice = requireElement<HTMLElement>('expires-notice')
  const editLink = requireElement('edit-link', HTMLAnchorElement)
  const resendNotice = requireElement<HTMLElement>('resend-notice')

  urlDisplay.href = entry.url
  urlDisplay.textContent = entry.url
  editLink.href = `/${id}/edit`
  expiresNotice.textContent = `${formatExpiresLabel(new Date(entry.expiresAt))} まで表示されます`
  // 編集完了後の再掲時だけ出す（§6.2）。E2E_FIXED_NOW の下では updatedAt が createdAt と
  // 同じままになるため version で判定する（§8）
  resendNotice.hidden = !(entry.version > 1)

  lineShareLink.href = `https://line.me/R/share?text=${encodeURIComponent(entry.url)}`

  let copyMessageTimer: ReturnType<typeof setTimeout> | undefined
  copyButton.addEventListener('click', () => {
    void copyToClipboard(entry.url).then((succeeded) => {
      if (copyMessageTimer !== undefined) clearTimeout(copyMessageTimer)
      copyMessage.hidden = !succeeded
      copyError.hidden = succeeded
      if (succeeded) {
        copyMessageTimer = setTimeout(() => {
          copyMessage.hidden = true
        }, COPY_MESSAGE_DURATION_MS)
      }
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
    icsLink.href = `/${id}.ics`

    applyCalendarUaHandling(calendarSection, navigator.userAgent)
  } else {
    draftNotice.hidden = false
  }
}

main()
