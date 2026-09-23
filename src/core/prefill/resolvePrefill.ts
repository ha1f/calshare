import { parseEventText } from '../parse/parseEventText'
import type { ParseContext } from '../parse/types'
import { jstDate, toJstParts } from '../time/jst'
import type { EventFields, FieldKey } from '../types'

export interface PrefillParams {
  text?: string // タイトル
  dates?: string // 開始/終了。ISO basic UTC（Google の render?action=TEMPLATE と同形式）。終日は YYYYMMDD/YYYYMMDD
  location?: string
  details?: string // メモ
  q?: string // 自然文。構造化パラメータに使える値が無いときだけ使う
}

export interface PrefillResult {
  rawText: string // textarea の初期値。構造化パラメータがあれば text を 1 行にしたもの（無ければ空文字）、q のみなら q そのもの
  fields: Partial<EventFields>
  manualKeys: FieldKey[] // 構造化パラメータで来た項目は manual 扱いで固定する
}

interface DatesResolution {
  start: Date
  end: Date
  isAllDay: boolean
}

const ALL_DAY_DATES_PATTERN = /^(\d{4})(\d{2})(\d{2})\/(\d{4})(\d{2})(\d{2})$/
const TIMED_DATES_PATTERN =
  /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/

function isValidJstDate(y: number, m: number, d: number): boolean {
  const p = toJstParts(jstDate(y, m, d))
  return p.y === y && p.m === m && p.d === d
}

function isValidUtcDateTime(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): boolean {
  const date = new Date(Date.UTC(y, m - 1, d, h, mi, s))
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  )
}

/**
 * Google の `render?action=TEMPLATE` と同形式の `dates` パラメータをパースする（§5.8）。
 * 形式・暦・時刻のいずれかが不正、または終了が開始以前なら null を返す（呼び出し側は無視する）
 */
function parseDatesParam(dates: string): DatesResolution | null {
  const allDay = ALL_DAY_DATES_PATTERN.exec(dates)
  if (allDay !== null) {
    const [y1, m1, d1, y2, m2, d2] = allDay.slice(1).map(Number)
    if (!isValidJstDate(y1, m1, d1) || !isValidJstDate(y2, m2, d2)) return null
    const start = jstDate(y1, m1, d1)
    const end = jstDate(y2, m2, d2)
    if (end.getTime() <= start.getTime()) return null
    return { start, end, isAllDay: true }
  }

  const timed = TIMED_DATES_PATTERN.exec(dates)
  if (timed !== null) {
    const [y1, m1, d1, h1, mi1, s1, y2, m2, d2, h2, mi2, s2] = timed.slice(1).map(Number)
    if (
      !isValidUtcDateTime(y1, m1, d1, h1, mi1, s1) ||
      !isValidUtcDateTime(y2, m2, d2, h2, mi2, s2)
    ) {
      return null
    }
    const start = new Date(Date.UTC(y1, m1 - 1, d1, h1, mi1, s1))
    const end = new Date(Date.UTC(y2, m2 - 1, d2, h2, mi2, s2))
    if (end.getTime() <= start.getTime()) return null
    return { start, end, isAllDay: false }
  }

  return null
}

// Google の TEMPLATE 形式のリンクを作るツールは空の `location=` `details=` を
// 付けたまま出すことがあるため、値が空（trim 後空文字）のパラメータも無いものとして扱う（§5.8）
function present(v: string | undefined): v is string {
  return v !== undefined && v.trim() !== ''
}

/** text は 1 行のタイトル用パラメータなので、改行は空白に変換してから使う（§5.8） */
function toSingleLine(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .join(' ')
    .trim()
}

function resolveStructuredPrefill(params: PrefillParams): PrefillResult {
  const fields: Partial<EventFields> = {}
  const manualKeys: FieldKey[] = []
  let rawText = ''

  if (present(params.text)) {
    rawText = toSingleLine(params.text)
    fields.title = rawText
    manualKeys.push('title')
  }
  if (present(params.location)) {
    fields.location = params.location
    manualKeys.push('location')
  }
  if (present(params.details)) {
    fields.memo = params.details
    manualKeys.push('memo')
  }
  if (present(params.dates)) {
    const resolved = parseDatesParam(params.dates)
    if (resolved !== null) {
      fields.start = resolved.start
      fields.end = resolved.end
      fields.isAllDay = resolved.isAllDay
      manualKeys.push('start', 'end', 'isAllDay')
    }
  }

  return { rawText, fields, manualKeys }
}

function resolveAutoPrefill(q: string, ctx: ParseContext): PrefillResult {
  const parsed = parseEventText(q, ctx)
  return {
    rawText: q,
    fields: {
      title: parsed.title,
      location: parsed.location,
      memo: parsed.memo,
      start: parsed.start,
      end: parsed.end,
      isAllDay: parsed.isAllDay,
    },
    manualKeys: [],
  }
}

/**
 * `/new` のクエリ文字列から作成画面の初期値を組む（§5.8）。構造化パラメータ
 * （`text` `dates` `location` `details`）に使える値が 1 つでもあればそれを優先し `q` は無視する。
 * 構造化パラメータが無い、または全て空・不正で使える値が残らなければ、
 * `q` があれば `parseEventText` の結果を auto（`manualKeys` 空）として返す
 */
export function resolvePrefill(params: PrefillParams, ctx: ParseContext): PrefillResult {
  const structured = resolveStructuredPrefill(params)
  if (structured.manualKeys.length > 0) return structured
  if (params.q !== undefined) return resolveAutoPrefill(params.q, ctx)
  return { rawText: '', fields: {}, manualKeys: [] }
}
