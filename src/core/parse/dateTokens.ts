import { MAX_EVENT_LEAD_TIME_MONTHS } from '../config/limits'
import { addMonths, jstDate, toJstParts } from '../time/jst'
import type { ParseIssue } from './types'

const WEEKDAY_CHARS = '日月火水木金土'

// 年（任意）+ 月 + 日（曜日カッコ書きは任意で無視）。年は `/` `年` の両方に対応する
const DATE_ATOM = String.raw`(?:(\d{4})[/年])?(\d{1,2})[/月](\d{1,2})日?(?:\([^)]*\))?`
const RANGE_RE = new RegExp(`${DATE_ATOM}〜${DATE_ATOM}`)
const ABSOLUTE_RE = new RegExp(DATE_ATOM)
const RELATIVE_RE = /今日|本日|明後日|あさって|明日/
const NEXT_WEEK_RE = new RegExp(`来週([${WEEKDAY_CHARS}])曜日?`)
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

/**
 * 1 行目から最初（最も左）の日付らしいトークンを検出する（§5.2 手順 4）。
 * 検出のみを行い、カレンダーとしての妥当性や年の補完は resolveDateToken で行う
 */
export function detectDateToken(text: string): DateTokenMatch | null {
  const candidates: DateTokenMatch[] = []

  const range = RANGE_RE.exec(text)
  if (range) {
    candidates.push({
      index: range.index,
      length: range[0].length,
      token: {
        kind: 'range',
        startYear: range[1] ? Number(range[1]) : null,
        startMonth: Number(range[2]),
        startDay: Number(range[3]),
        endYear: range[4] ? Number(range[4]) : null,
        endMonth: Number(range[5]),
        endDay: Number(range[6]),
      },
    })
  }

  const absolute = ABSOLUTE_RE.exec(text)
  if (absolute) {
    candidates.push({
      index: absolute.index,
      length: absolute[0].length,
      token: {
        kind: 'absolute',
        year: absolute[1] ? Number(absolute[1]) : null,
        month: Number(absolute[2]),
        day: Number(absolute[3]),
      },
    })
  }

  const relative = RELATIVE_RE.exec(text)
  if (relative) {
    candidates.push({
      index: relative.index,
      length: relative[0].length,
      token: { kind: 'relative', offsetDays: relativeOffset(relative[0]) },
    })
  }

  const nextWeek = NEXT_WEEK_RE.exec(text)
  if (nextWeek) {
    candidates.push({
      index: nextWeek.index,
      length: nextWeek[0].length,
      token: { kind: 'nextWeek', weekday: WEEKDAY_CHARS.indexOf(nextWeek[1]) },
    })
  }

  const thisWeek = THIS_WEEK_RE.exec(text)
  if (thisWeek) {
    candidates.push({
      index: thisWeek.index,
      length: thisWeek[0].length,
      token: { kind: 'thisWeek', weekday: WEEKDAY_CHARS.indexOf(thisWeek[1]) },
    })
  }

  const weekday = WEEKDAY_RE.exec(text)
  if (weekday) {
    candidates.push({
      index: weekday.index,
      length: weekday[0].length,
      token: { kind: 'weekday', weekday: WEEKDAY_CHARS.indexOf(weekday[1]) },
    })
  }

  if (candidates.length === 0) return null

  // 同じ開始位置なら range を absolute より優先する（絶対日付の範囲表現の方が具体的なため）
  const priority: RawDateToken['kind'][] = [
    'range',
    'absolute',
    'relative',
    'nextWeek',
    'thisWeek',
    'weekday',
  ]
  candidates.sort(
    (a, b) => a.index - b.index || priority.indexOf(a.token.kind) - priority.indexOf(b.token.kind),
  )
  return candidates[0]
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
    return compareDay(candidate, today) >= 0 ? candidate : { y: today.y + 1, m: month, d: day }
  }
  if (isValidCalendarDate(today.y + 1, month, day)) return { y: today.y + 1, m: month, d: day }
  return null
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

  const today = toJstParts(now)
  const candidate = { y: year, m: month, d: day }
  if (compareDay(candidate, { y: today.y, m: today.m, d: today.d }) < 0) {
    return { consumed: true, issues: ['past_date'], start: null, end: null }
  }

  const startDate = jstDate(year, month, day, resolvedStart?.hour ?? 0, resolvedStart?.minute ?? 0)
  const boundary = addMonths(now, MAX_EVENT_LEAD_TIME_MONTHS)
  if (startDate.getTime() > boundary.getTime()) {
    return { consumed: true, issues: ['beyond_max_lead_time'], start: null, end: null }
  }
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
  const parts = toJstParts(addDaysToDate(jstDate(day.y, day.m, day.d), days))
  return { y: parts.y, m: parts.m, d: parts.d }
}

function addDaysToDate(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
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
  const timeAlreadyPassed =
    resolvedStart !== null &&
    (resolvedStart.hour < today.h ||
      (resolvedStart.hour === today.h && resolvedStart.minute <= today.mi))

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

      const endYear = token.endYear ?? start.y
      if (!isValidCalendarDate(endYear, token.endMonth, token.endDay))
        return { consumed: false, issues: ['invalid_date'], start: null, end: null }
      let end = { y: endYear, m: token.endMonth, d: token.endDay }
      // 終了日 < 開始日は年またぎとみなし、終了日を翌年にする（規則 A2）
      if (token.endYear === null && compareDay(end, start) < 0)
        end = { y: endYear + 1, m: token.endMonth, d: token.endDay }
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
