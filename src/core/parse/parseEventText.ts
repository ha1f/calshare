import { DEFAULT_EVENT_DURATION_MINUTES } from '../config/limits'
import { addDays, formatDateLabel, jstDate, toJstParts } from '../time/jst'
import type { EventFields } from '../types'
import { URL_PATTERN } from '../text/urlPattern'
import { detectDateTokens, resolveDateToken } from './dateTokens'
import type { CalendarDay, DateResolution, DateTokenMatch } from './dateTokens'
import { normalizeWidth } from './normalize'
import { splitTitleLocationMemo } from './locationTitle'
import { detectTimeToken } from './timeTokens'
import type { TimeResolution } from './timeTokens'
import type { ParseContext, ParseIssue, ParsedEvent } from './types'

interface Span {
  start: number
  end: number
}

/** 隣接・重複する範囲を 1 つにまとめる。順序は開始位置の昇順 */
function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

/** 消費した日付・時刻トークンの範囲を空白 1 文字に置き換える（§5.2 手順 6） */
function removeSpans(text: string, spans: Span[]): string {
  let result = ''
  let cursor = 0
  for (const span of mergeSpans(spans)) {
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

interface DateSelection {
  match: DateTokenMatch | null
  resolution: DateResolution | null
}

/**
 * 日付候補を出現順に試し、消費できる（有効な）最初の候補を採用する（規則 D6・D7）。
 * どれも消費できなければ、最初に見つかった不正な候補（invalid_date）を返す。
 * 不正と判定した日付範囲の内側にある候補（範囲の開始・終了の月日そのもの）は、
 * 範囲ごと不正な入力とみなし、単独の日付としては採用しない（規則 D6）
 */
function selectDateToken(
  candidates: DateTokenMatch[],
  now: Date,
  resolvedStart: { hour: number; minute: number } | null,
): DateSelection {
  let fallback: DateSelection | null = null
  const rejectedRangeSpans: Span[] = []
  for (const candidate of candidates) {
    const insideRejectedRange = rejectedRangeSpans.some(
      (span) => candidate.index >= span.start && candidate.index < span.end,
    )
    if (insideRejectedRange) continue

    const resolution = resolveDateToken(candidate.token, now, resolvedStart)
    if (resolution.consumed) return { match: candidate, resolution }
    fallback ??= { match: candidate, resolution }
    if (candidate.token.kind === 'range')
      rejectedRangeSpans.push({ start: candidate.index, end: candidate.index + candidate.length })
  }
  return fallback ?? { match: null, resolution: null }
}

/**
 * 予定を書いた 1 行目（＋メモになる 2 行目以降）から、タイトル・日時・場所・メモを取り出す（§5.1〜§5.6）。
 * 同期・純粋で core の外を import しない
 */
export function parseEventText(input: string, ctx: ParseContext): ParsedEvent {
  const lines = input.split(/\r?\n/)
  // 先頭が空行でも、最初の空でない行をパース対象にする（§5.2 手順 1）
  const line1Index = Math.max(
    lines.findIndex((line) => line.trim().length > 0),
    0,
  )
  const originalLine1 = lines[line1Index] ?? ''
  const restText = lines
    .slice(line1Index + 1)
    .join('\n')
    .trim()

  const widthNormalized = normalizeWidth(originalLine1)
  const urlRegex = new RegExp(URL_PATTERN.source, URL_PATTERN.flags)
  const urls: string[] = []
  const withoutUrls = widthNormalized.replace(urlRegex, (matched) => {
    urls.push(matched)
    return ''
  })

  const timeMatch = detectTimeToken(withoutUrls)
  const resolvedStartForDate =
    timeMatch !== null && timeMatch.consumed
      ? { hour: timeMatch.start.hour, minute: timeMatch.start.minute }
      : null

  const { match: dateMatch, resolution: dateResolution } = selectDateToken(
    detectDateTokens(withoutUrls),
    ctx.now,
    resolvedStartForDate,
  )

  const timeFound = timeMatch !== null && timeMatch.consumed
  const dateFound = dateResolution !== null && dateResolution.consumed

  const spans: Span[] = []
  if (dateMatch !== null && dateFound)
    spans.push({ start: dateMatch.index, end: dateMatch.index + dateMatch.length })
  if (timeMatch !== null && timeFound)
    spans.push({ start: timeMatch.index, end: timeMatch.index + timeMatch.length })
  // 消費した範囲を空白に置き換えると連続空白ができるので 1 つに畳む（前後の空白は各規則側で trim する）
  const remaining = removeSpans(withoutUrls, spans).replace(/ +/g, ' ')

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
