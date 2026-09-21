import { MAX_CALENDAR_DETAILS_LENGTH } from '../config/limits'
import { formatBasicDateJst, formatBasicUtc } from '../time/jst'

export interface CalendarEventInput {
  title: string
  location: string | null
  memo: string | null
  start: Date // 非 null（下書きはボタン自体を出さない）
  end: Date
  isAllDay: boolean
  detailUrl: string // 詳細ページの絶対 URL
}

/** メモを上限文字数で切り詰め、末尾に詳細ページ URL の行を連結する。URL 自体は切り詰めの対象にしない（§7.1） */
function buildCalendarDetails(memo: string | null, detailUrl: string): string {
  const detailLine = `詳細: ${detailUrl}`
  if (memo === null) return detailLine
  const truncated =
    memo.length > MAX_CALENDAR_DETAILS_LENGTH
      ? `${memo.slice(0, MAX_CALENDAR_DETAILS_LENGTH)}…`
      : memo
  return `${truncated}\n${detailLine}`
}

export function buildGoogleCalendarUrl(event: CalendarEventInput): string {
  const dates = event.isAllDay
    ? `${formatBasicDateJst(event.start)}/${formatBasicDateJst(event.end)}` // YYYYMMDD/YYYYMMDD（終了は排他的翌日）
    : `${formatBasicUtc(event.start)}/${formatBasicUtc(event.end)}` // YYYYMMDDTHHMMSSZ/...
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    ctz: 'Asia/Tokyo',
  })
  if (event.location) params.set('location', event.location)
  params.set('details', buildCalendarDetails(event.memo, event.detailUrl))
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
