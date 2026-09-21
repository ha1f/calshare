import { DEFAULT_EVENT_DURATION_MINUTES } from '../config/limits'
import { addDays, formatDateLabel, jstDate, toJstParts } from '../time/jst'
import type { EventFields } from '../types'
import { URL_PATTERN } from '../text/urlPattern'
import {
  detectDateToken,
  resolveDateToken,
  type CalendarDay,
  type DateResolution,
} from './dateTokens'
import { normalizeRangeSymbols, normalizeWidth } from './normalize'
import { splitTitleLocationMemo } from './locationTitle'
import { detectTimeToken, type TimeResolution } from './timeTokens'
import type { ParseContext, ParseIssue, ParsedEvent } from './types'

interface Span {
  start: number
  end: number
}

/** 消費した日付・時刻トークンの範囲を空白 1 文字に置き換える（§5.2 手順 6） */
function removeSpans(text: string, spans: Span[]): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  let result = ''
  let cursor = 0
  for (const span of sorted) {
    result += text.slice(cursor, span.start) + ' '
    cursor = span.end
  }
  return result + text.slice(cursor)
}

function dayToDate(day: CalendarDay, hour = 0, minute = 0): Date {
  return jstDate(day.y, day.m, day.d, hour, minute)
}

function addDaysToCalendarDay(day: CalendarDay, days: number): CalendarDay {
  const parts = toJstParts(addDays(dayToDate(day), days))
  return { y: parts.y, m: parts.m, d: parts.d }
}

interface ResolvedRange {
  start: Date | null
  end: Date | null
  isAllDay: boolean
}

/** 時刻が無ければ終日（規則 A1）、あれば T1・T3 に従って開始・終了を組み立てる */
function buildSingleDayRange(day: CalendarDay, time: TimeResolution | null): ResolvedRange {
  if (time === null) {
    const start = dayToDate(day)
    return { start, end: addDays(start, 1), isAllDay: true }
  }
  const start = dayToDate(day, time.start.hour, time.start.minute)
  if (time.end === null) {
    // 終了指定が無ければ既定の所要時間を足す（規則 T1）。日をまたぐ場合も Date の演算に任せる
    return {
      start,
      end: new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60_000),
      isAllDay: false,
    }
  }
  const endSameDay = dayToDate(day, time.end.hour, time.end.minute)
  return { start, end: time.end.nextDay ? addDays(endSameDay, 1) : endSameDay, isAllDay: false }
}

/** 日付トークンが無いときの規則 T4: 今日を仮定し、開始が基準時刻より前なら翌日にする */
function resolveDateless(time: TimeResolution, now: Date): ResolvedRange {
  const today = toJstParts(now)
  const todayDay: CalendarDay = { y: today.y, m: today.m, d: today.d }
  const candidateStart = dayToDate(todayDay, time.start.hour, time.start.minute)
  const day =
    candidateStart.getTime() < now.getTime() ? addDaysToCalendarDay(todayDay, 1) : todayDay
  return buildSingleDayRange(day, time)
}

function resolveDateTime(
  dateResolution: DateResolution | null,
  time: TimeResolution | null,
  now: Date,
): ResolvedRange {
  if (dateResolution !== null && dateResolution.consumed) {
    if (dateResolution.issues.length > 0) return { start: null, end: null, isAllDay: false }

    const startDay = dateResolution.start as CalendarDay
    const endDay = dateResolution.end as CalendarDay
    const isRange = startDay.y !== endDay.y || startDay.m !== endDay.m || startDay.d !== endDay.d
    if (isRange) {
      // 複数日の終日予定（規則 A2）。時刻付きの複数日レンジは仕様上サポートしない（§5.3）
      const start = dayToDate(startDay)
      return { start, end: addDays(dayToDate(endDay), 1), isAllDay: true }
    }
    return buildSingleDayRange(startDay, time)
  }

  if (time !== null) return resolveDateless(time, now)
  return { start: null, end: null, isAllDay: false } // 規則 A3: 日付も時刻も無い下書き
}

/**
 * 予定を書いた 1 行目（＋メモになる 2 行目以降）から、タイトル・日時・場所・メモを取り出す（§5.1〜§5.6）。
 * 同期・純粋で core の外を import しない
 */
export function parseEventText(input: string, ctx: ParseContext): ParsedEvent {
  const lines = input.split('\n')
  const originalLine1 = lines[0] ?? ''
  const restText = lines.slice(1).join('\n').trim()

  const widthNormalized = normalizeWidth(originalLine1)
  const urlRegex = new RegExp(URL_PATTERN.source, URL_PATTERN.flags)
  const urls: string[] = []
  const withoutUrls = widthNormalized.replace(urlRegex, (matched) => {
    urls.push(matched)
    return ''
  })
  const rangeNormalized = normalizeRangeSymbols(withoutUrls)

  const timeMatch = detectTimeToken(rangeNormalized)
  const resolvedStartForDate =
    timeMatch !== null && timeMatch.consumed
      ? { hour: timeMatch.start.hour, minute: timeMatch.start.minute }
      : null

  const dateMatch = detectDateToken(rangeNormalized)
  const dateResolution =
    dateMatch !== null ? resolveDateToken(dateMatch.token, ctx.now, resolvedStartForDate) : null

  const timeFound = timeMatch !== null && timeMatch.consumed
  const dateFound = dateResolution !== null && dateResolution.consumed

  const spans: Span[] = []
  if (dateMatch !== null && dateFound)
    spans.push({ start: dateMatch.index, end: dateMatch.index + dateMatch.length })
  if (timeMatch !== null && timeFound)
    spans.push({ start: timeMatch.index, end: timeMatch.index + timeMatch.length })
  // 消費した範囲を空白に置き換えると連続空白ができるので 1 つに畳む（前後の空白は各規則側で trim する）
  const remaining = removeSpans(rangeNormalized, spans).replace(/ +/g, ' ')

  const split = splitTitleLocationMemo(remaining)

  const issues: ParseIssue[] = []
  if (dateResolution !== null) issues.push(...dateResolution.issues)
  if (!dateFound && !timeFound) issues.push('no_datetime')

  const { start, end, isAllDay } = resolveDateTime(
    dateResolution,
    timeFound ? timeMatch : null,
    ctx.now,
  )

  const line1Memo = [urls.join('\n'), split.memo ?? ''].filter((s) => s.length > 0).join('\n')
  const memo = [line1Memo, restText].filter((s) => s.length > 0).join('\n')

  const fields: EventFields = {
    title: split.title,
    location: split.location,
    memo: null,
    start,
    end,
    isAllDay,
  }
  const title =
    split.title.length > 0
      ? split.title
      : start !== null
        ? formatDateLabel(fields)
        : originalLine1.trim()

  return {
    title,
    location: split.location,
    memo: memo.length > 0 ? memo : null,
    start,
    end,
    isAllDay,
    issues,
    singleTokenTitle: split.singleTokenTitle,
  }
}
