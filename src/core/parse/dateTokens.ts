import { requireDefined } from '../assert'
import { MAX_EVENT_LEAD_TIME_MONTHS } from '../config/limits'
import { addDays, addMonths, jstDate, toJstParts } from '../time/jst'
import { RANGE_SYMBOL_SOURCE } from './normalize'
import type { ParseIssue } from './types'

const WEEKDAY_CHARS = '日月火水木金土'

// 年（任意）+ 月 + 日（曜日カッコ書きは任意で無視）。年は `/` `年` の両方に対応する。
// 前後の `(?<!\d)` `(?!\d)` は、長い数字列の途中から日付として切り出すのを防ぐ境界。
// 曜日カッコの中身は曜日・祝に限定する（任意の文字列だと後続の時刻表記まで飲み込んでしまうため）
const DATE_ATOM = String.raw`(?<!\d)(?:(\d{4})[/年])?(\d{1,2})[/月](\d{1,2})(?!\d)日?(?:\((?:[${WEEKDAY_CHARS}](?:曜日?)?|祝)\))?`
const RANGE_RE = new RegExp(`${DATE_ATOM}${RANGE_SYMBOL_SOURCE}${DATE_ATOM}`)
const ABSOLUTE_RE = new RegExp(DATE_ATOM)
const RELATIVE_RE = /今日|本日|明後日|あさって|明日/
// 「再来週」は未対応（§5.3）。前に「再」が無いことを確認し、「来週」だけを消費しないようにする
const NEXT_WEEK_RE = new RegExp(`(?<!再)来週([${WEEKDAY_CHARS}])曜日?`)
const THIS_WEEK_RE = new RegExp(`今週([${WEEKDAY_CHARS}])曜日?`)
const WEEKDAY_RE = new RegExp(`([${WEEKDAY_CHARS}])曜日?`)

type RawDateToken =
  | {
      kind: 'range'
      startYear: number | null
      startMonth: number
      startDay: number
      endYear: number | null
      endMonth: number
      endDay: number
    }
  | { kind: 'absolute'; year: number | null; month: number; day: number }
  | { kind: 'relative'; offsetDays: 0 | 1 | 2 }
  | { kind: 'weekday'; weekday: number }
  | { kind: 'thisWeek'; weekday: number }
  | { kind: 'nextWeek'; weekday: number }

export interface DateTokenMatch {
  token: RawDateToken
  index: number
  length: number
}

function relativeOffset(matched: string): 0 | 1 | 2 {
  if (matched === '今日' || matched === '本日') return 0
  if (matched === '明日') return 1
  return 2 // あさって・明後日
}

/** pattern に一致するすべての箇所を、出現順のトークン候補に変換する */
function collectMatches<T extends RawDateToken>(
  text: string,
  pattern: RegExp,
  build: (match: RegExpExecArray) => T,
): DateTokenMatch[] {
  const withG = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
  )
  const matches: DateTokenMatch[] = []
  for (let m = withG.exec(text); m !== null; m = withG.exec(text)) {
    matches.push({ index: m.index, length: m[0].length, token: build(m) })
  }
  return matches
}

/**
 * 1 行目から日付らしいトークンをすべて検出し、出現位置順（同じ位置なら range を優先）に並べて返す（§5.2 手順 4）。
 * 検出のみを行い、カレンダーとしての妥当性や年の補完は resolveDateToken で行う。
 * 先頭の候補が不正（D6）でも、後続に有効な候補があればそちらを採用できるよう全件返す
 */
export function detectDateTokens(text: string): DateTokenMatch[] {
  const candidates: DateTokenMatch[] = [
    ...collectMatches(text, RANGE_RE, (m) => ({
      kind: 'range',
      startYear: m[1] ? Number(m[1]) : null,
      startMonth: Number(m[2]),
      startDay: Number(m[3]),
      endYear: m[4] ? Number(m[4]) : null,
      endMonth: Number(m[5]),
      endDay: Number(m[6]),
    })),
    ...collectMatches(text, ABSOLUTE_RE, (m) => ({
      kind: 'absolute',
      year: m[1] ? Number(m[1]) : null,
      month: Number(m[2]),
      day: Number(m[3]),
    })),
    ...collectMatches(text, RELATIVE_RE, (m) => ({
      kind: 'relative',
      offsetDays: relativeOffset(m[0]),
    })),
    // 各正規表現は曜日を表すキャプチャグループを 1 つだけ持ち、一致すれば必ず埋まる
    ...collectMatches(text, NEXT_WEEK_RE, (m) => ({
      kind: 'nextWeek',
      weekday: WEEKDAY_CHARS.indexOf(requireDefined(m[1], 'NEXT_WEEK_RE: missing weekday group')),
    })),
    ...collectMatches(text, THIS_WEEK_RE, (m) => ({
      kind: 'thisWeek',
      weekday: WEEKDAY_CHARS.indexOf(requireDefined(m[1], 'THIS_WEEK_RE: missing weekday group')),
    })),
    ...collectMatches(text, WEEKDAY_RE, (m) => ({
      kind: 'weekday',
      weekday: WEEKDAY_CHARS.indexOf(requireDefined(m[1], 'WEEKDAY_RE: missing weekday group')),
    })),
  ]

  // 同じ開始位置なら range を absolute より優先する（絶対日付の範囲表現の方が具体的なため）
  const priority: RawDateToken['kind'][] = [
    'range',
    'absolute',
    'relative',
    'nextWeek',
    'thisWeek',
    'weekday',
  ]
  return candidates.sort(
    (a, b) => a.index - b.index || priority.indexOf(a.token.kind) - priority.indexOf(b.token.kind),
  )
}

/** detectDateTokens の先頭（最も左、同じ位置なら最優先）の候補。無ければ null */
export function detectDateToken(text: string): DateTokenMatch | null {
  return detectDateTokens(text)[0] ?? null
}

export interface CalendarDay {
  y: number
  m: number
  d: number
}

export interface DateResolution {
  /** トークンを消費した（日時として解釈できた）か。invalid_date のときだけ false（§5.5 D6） */
  consumed: boolean
  issues: ParseIssue[]
  /** 採用できたときの開始日。past_date / beyond_max_lead_time / invalid_date では null */
  start: CalendarDay | null
  /** 日付範囲（A2）のときだけ start と異なる。単日なら start と同じ */
  end: CalendarDay | null
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function compareDay(a: CalendarDay, b: CalendarDay): number {
  return a.y - b.y || a.m - b.m || a.d - b.d
}

/**
 * 年省略の月日を今日基準で補完する（規則 D1）。今年に存在しない日付（2/29 等）は
 * 来年に存在するかを確認し、それも無ければ null（invalid_date）を返す
 */
function resolveYearOmittedDate(
  month: number,
  day: number,
  today: CalendarDay,
): CalendarDay | null {
  if (isValidCalendarDate(today.y, month, day)) {
    const candidate = { y: today.y, m: month, d: day }
    if (compareDay(candidate, today) >= 0) return candidate
  }
  return isValidCalendarDate(today.y + 1, month, day) ? { y: today.y + 1, m: month, d: day } : null
}

/**
 * 年を明示した日付が過去日（D2）か 13 ヶ月超（D3）かを判定する。
 * 単一日付・日付範囲の開始のどちらでも使う共通の境界チェック
 */
function explicitYearIssue(
  candidate: CalendarDay,
  now: Date,
  resolvedStart: { hour: number; minute: number } | null,
): 'past_date' | 'beyond_max_lead_time' | null {
  const today = toJstParts(now)
  if (compareDay(candidate, { y: today.y, m: today.m, d: today.d }) < 0) return 'past_date'

  const startDate = jstDate(
    candidate.y,
    candidate.m,
    candidate.d,
    resolvedStart?.hour ?? 0,
    resolvedStart?.minute ?? 0,
  )
  const boundary = addMonths(now, MAX_EVENT_LEAD_TIME_MONTHS)
  return startDate.getTime() > boundary.getTime() ? 'beyond_max_lead_time' : null
}

function resolveExplicitYearDate(
  year: number,
  month: number,
  day: number,
  now: Date,
  resolvedStart: { hour: number; minute: number } | null,
): DateResolution {
  if (!isValidCalendarDate(year, month, day))
    return { consumed: false, issues: ['invalid_date'], start: null, end: null }

  const candidate = { y: year, m: month, d: day }
  const issue = explicitYearIssue(candidate, now, resolvedStart)
  if (issue !== null) return { consumed: true, issues: [issue], start: null, end: null }
  return { consumed: true, issues: [], start: candidate, end: candidate }
}

/** 直近の当該曜日を返す（今日を含む）。resolvedStart が今日を過ぎていれば +7 日（規則 D4） */
function resolveWeekdayAlone(
  weekday: number,
  today: CalendarDay,
  todayWeekday: number,
  resolvedStart: { hour: number; minute: number } | null,
  timeAlreadyPassed: boolean,
): CalendarDay {
  const daysUntil = (weekday - todayWeekday + 7) % 7
  const date = addDaysToDay(today, daysUntil)
  if (daysUntil === 0 && resolvedStart !== null && timeAlreadyPassed) return addDaysToDay(today, 7)
  return date
}

/** 月曜始まりの今週の当該曜日を返す（規則 D5）。今日より前なら翌週に繰り上げる */
function resolveThisWeekWeekday(
  weekday: number,
  today: CalendarDay,
  todayWeekday: number,
  timeAlreadyPassed: boolean,
): CalendarDay {
  const mondayOffset = (todayWeekday + 6) % 7 // 月曜=0 になるようにずらす
  const weekdayOffsetFromMonday = (weekday + 6) % 7
  const candidate = addDaysToDay(today, weekdayOffsetFromMonday - mondayOffset)
  if (compareDay(candidate, today) < 0) return addDaysToDay(candidate, 7)
  if (compareDay(candidate, today) === 0 && timeAlreadyPassed) return addDaysToDay(candidate, 7)
  return candidate
}

function addDaysToDay(day: CalendarDay, days: number): CalendarDay {
  const parts = toJstParts(addDays(jstDate(day.y, day.m, day.d), days))
  return { y: parts.y, m: parts.m, d: parts.d }
}

/**
 * 検出した日付トークンを、基準時刻と（分かっていれば）解決済みの開始時刻を使って解決する。
 * resolvedStart は規則 D4・D5（当該曜日が今日で時刻が既に過ぎているか）の判定にのみ使う
 */
export function resolveDateToken(
  token: RawDateToken,
  now: Date,
  resolvedStart: { hour: number; minute: number } | null,
): DateResolution {
  const today = toJstParts(now)
  const todayDay: CalendarDay = { y: today.y, m: today.m, d: today.d }
  // 同時刻は「まだ過ぎていない」とする（規則 T4 と揃える）
  const timeAlreadyPassed =
    resolvedStart !== null &&
    (resolvedStart.hour < today.h ||
      (resolvedStart.hour === today.h && resolvedStart.minute < today.mi))

  switch (token.kind) {
    case 'absolute': {
      if (token.year !== null)
        return resolveExplicitYearDate(token.year, token.month, token.day, now, resolvedStart)
      const resolved = resolveYearOmittedDate(token.month, token.day, todayDay)
      if (resolved === null)
        return { consumed: false, issues: ['invalid_date'], start: null, end: null }
      return { consumed: true, issues: [], start: resolved, end: resolved }
    }
    case 'range': {
      const start =
        token.startYear !== null
          ? { y: token.startYear, m: token.startMonth, d: token.startDay }
          : resolveYearOmittedDate(token.startMonth, token.startDay, todayDay)
      if (start === null || !isValidCalendarDate(start.y, start.m, start.d))
        return { consumed: false, issues: ['invalid_date'], start: null, end: null }

      // 開始の年を明示した範囲は、単一日付と同じ過去日・13 ヶ月超の境界を適用する（D2・D3）
      if (token.startYear !== null) {
        const issue = explicitYearIssue(start, now, resolvedStart)
        if (issue !== null) return { consumed: true, issues: [issue], start: null, end: null }
      }

      const endYear = token.endYear ?? start.y
      if (!isValidCalendarDate(endYear, token.endMonth, token.endDay))
        return { consumed: false, issues: ['invalid_date'], start: null, end: null }
      let end = { y: endYear, m: token.endMonth, d: token.endDay }
      if (token.endYear === null) {
        // 終了日 < 開始日は年またぎとみなし、終了日を翌年にする（規則 A2）
        if (compareDay(end, start) < 0) end = { y: endYear + 1, m: token.endMonth, d: token.endDay }
      } else if (compareDay(end, start) < 0) {
        // 終了の年を明示していて開始より前なら、矛盾した入力として invalid_date にする
        return { consumed: false, issues: ['invalid_date'], start: null, end: null }
      }
      return { consumed: true, issues: [], start, end }
    }
    case 'relative': {
      const day = addDaysToDay(todayDay, token.offsetDays)
      return { consumed: true, issues: [], start: day, end: day }
    }
    case 'weekday': {
      const day = resolveWeekdayAlone(
        token.weekday,
        todayDay,
        today.weekday,
        resolvedStart,
        timeAlreadyPassed,
      )
      return { consumed: true, issues: [], start: day, end: day }
    }
    case 'thisWeek': {
      const day = resolveThisWeekWeekday(token.weekday, todayDay, today.weekday, timeAlreadyPassed)
      return { consumed: true, issues: [], start: day, end: day }
    }
    case 'nextWeek': {
      const mondayOffset = (today.weekday + 6) % 7
      const weekdayOffsetFromMonday = (token.weekday + 6) % 7
      const thisWeekDay = addDaysToDay(todayDay, weekdayOffsetFromMonday - mondayOffset)
      const day = addDaysToDay(thisWeekDay, 7)
      return { consumed: true, issues: [], start: day, end: day }
    }
  }
}
