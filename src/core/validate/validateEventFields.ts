import {
  MAX_INPUT_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_MEMO_LENGTH,
  MAX_MEMO_URLS,
  MAX_TITLE_LENGTH,
} from '../config/limits'
import { isWithinMaxLeadTime } from '../retention/calculateExpiresAt'
import { URL_PATTERN } from '../text/urlPattern'
import { jstDate, toJstParts } from '../time/jst'
import type { EventFields, ValidationErrorCode } from '../types'

export type ValidationResult = { ok: true } | { ok: false; code: ValidationErrorCode }

export type ValidationMode = { mode: 'create' } | { mode: 'update'; previous: EventFields }

/** title / location / memo などにまたがる URL の総数を数える（§5.7 の TOO_MANY_URLS） */
export function countUrls(texts: (string | null)[]): number {
  const pattern = new RegExp(URL_PATTERN.source, URL_PATTERN.flags)
  return texts.reduce((total, text) => total + (text?.match(pattern)?.length ?? 0), 0)
}

function isJstMidnight(date: Date): boolean {
  const p = toJstParts(date)
  return jstDate(p.y, p.m, p.d).getTime() === date.getTime()
}

/** start / end / isAllDay が一致するかを比較する。§3.5 の変更バナー判定でも使う */
export function sameDateTime(a: EventFields, b: EventFields): boolean {
  if (a.isAllDay !== b.isAllDay) return false
  const aStart = a.start?.getTime() ?? null
  const bStart = b.start?.getTime() ?? null
  const aEnd = a.end?.getTime() ?? null
  const bEnd = b.end?.getTime() ?? null
  return aStart === bStart && aEnd === bEnd
}

/**
 * 予定の入力を検証する（§5.7）。作成・更新 API がプレビューの確定値を受け取ったときに呼ぶほか、
 * クライアントのプレビューも同じ関数で事前表示する。
 * 検証順序は EMPTY_INPUT → INPUT_TOO_LONG → INVALID_RANGE → PAST_EVENT → BEYOND_MAX_LEAD_TIME
 * → TOO_MANY_URLS で固定し、最初に見つかった違反だけを返す
 */
export function validateEventFields(
  rawText: string,
  fields: EventFields,
  now: Date,
  mode: ValidationMode,
): ValidationResult {
  if (rawText.trim() === '' || fields.title.trim() === '') return { ok: false, code: 'EMPTY_INPUT' }

  if (
    rawText.length > MAX_INPUT_LENGTH ||
    fields.title.length > MAX_TITLE_LENGTH ||
    (fields.location !== null && fields.location.length > MAX_LOCATION_LENGTH) ||
    (fields.memo !== null && fields.memo.length > MAX_MEMO_LENGTH)
  ) {
    return { ok: false, code: 'INPUT_TOO_LONG' }
  }

  const hasStart = fields.start !== null
  const hasEnd = fields.end !== null
  if (hasStart !== hasEnd) return { ok: false, code: 'INVALID_RANGE' }
  if (fields.start !== null && fields.end !== null) {
    if (Number.isNaN(fields.start.getTime()) || Number.isNaN(fields.end.getTime())) {
      return { ok: false, code: 'INVALID_RANGE' }
    }
    if (fields.end.getTime() <= fields.start.getTime()) return { ok: false, code: 'INVALID_RANGE' }
    if (fields.isAllDay && (!isJstMidnight(fields.start) || !isJstMidnight(fields.end))) {
      return { ok: false, code: 'INVALID_RANGE' }
    }

    // 日時未確定の下書き（start/end が null）は過去日時・上限先の検証対象にならない
    const dateTimeChanged = mode.mode === 'create' || !sameDateTime(fields, mode.previous)
    if (dateTimeChanged && fields.end.getTime() < now.getTime()) {
      return { ok: false, code: 'PAST_EVENT' }
    }
    if (!isWithinMaxLeadTime(fields.start, now)) return { ok: false, code: 'BEYOND_MAX_LEAD_TIME' }
  }

  if (countUrls([fields.title, fields.location, fields.memo]) > MAX_MEMO_URLS) {
    return { ok: false, code: 'TOO_MANY_URLS' }
  }

  return { ok: true }
}
