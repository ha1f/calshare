import type { EventFields } from '../types'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** JST の壁時計（年月日時分）を UTC の Date に変換する。DST は存在しない前提 */
export function jstDate(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, mi) - JST_OFFSET_MS)
}

export interface JstParts {
  y: number
  m: number
  d: number
  h: number
  mi: number
  /** 0 = 日曜 〜 6 = 土曜 */
  weekday: number
}

export function toJstParts(date: Date): JstParts {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
    h: jst.getUTCHours(),
    mi: jst.getUTCMinutes(),
    weekday: jst.getUTCDay(),
  }
}

function formatMonthDay(p: JstParts): string {
  return `${p.m}月${p.d}日(${WEEKDAY_LABELS[p.weekday]})`
}

function formatHourMinute(p: JstParts): string {
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`
}

function isSameJstDate(a: JstParts, b: JstParts): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d
}

/**
 * 「9月20日(日) 19:00〜21:00」等。詳細・OGP・タイトル代替で共用（§11.5）。
 * start のみ（保存前の途中状態。§5.7 では INVALID_RANGE）のときは開始だけを返す
 */
export function formatDateLabel(fields: EventFields): string {
  if (fields.start === null) return '日時未定'
  const startParts = toJstParts(fields.start)
  const startLabel = formatMonthDay(startParts)

  if (fields.isAllDay) {
    if (fields.end === null) return startLabel
    // end は排他的な翌日 00:00 JST（§3.1）なので、表示する最終日は 1 日前にずらす
    const lastDayParts = toJstParts(addDays(fields.end, -1))
    return isSameJstDate(startParts, lastDayParts)
      ? startLabel
      : `${startLabel}〜${formatMonthDay(lastDayParts)}`
  }

  if (fields.end === null) return `${startLabel} ${formatHourMinute(startParts)}`
  const endParts = toJstParts(fields.end)
  return isSameJstDate(startParts, endParts)
    ? `${startLabel} ${formatHourMinute(startParts)}〜${formatHourMinute(endParts)}`
    : `${startLabel} ${formatHourMinute(startParts)}〜${formatMonthDay(endParts)} ${formatHourMinute(endParts)}`
}

/** 20260920T100000Z（UTC basic format。ics / Google カレンダーの dates で使う） */
export function formatBasicUtc(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  const s = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}${m}${d}T${h}${mi}${s}Z`
}

/** 20260920（JST の暦日。終日イベントの ics DATE 値で使う） */
export function formatBasicDateJst(date: Date): string {
  const p = toJstParts(date)
  return `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function daysInMonth(y: number, m: number): number {
  // 翌月 0 日目 = 当月末日（UTC 演算。時刻の変換は挟まないので JST/UTC のずれは影響しない）
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * JST の暦月を単位に加算する。日が対象月の末日を超える場合は末日にクランプする
 * （例: 1/31 の 1 ヶ月後 → 2/28 または 2/29。3/3 にはしない）
 */
export function addMonths(date: Date, months: number): Date {
  const p = toJstParts(date)
  const totalMonths = p.m - 1 + months
  const y = p.y + Math.floor(totalMonths / 12)
  const m = (((totalMonths % 12) + 12) % 12) + 1
  const d = Math.min(p.d, daysInMonth(y, m))
  return jstDate(y, m, d, p.h, p.mi)
}
