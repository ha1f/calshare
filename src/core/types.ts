export interface EventFields {
  title: string
  location: string | null
  memo: string | null
  start: Date | null
  end: Date | null
  isAllDay: boolean
}

/** API レスポンス・詳細ページ・履歴で共通に使う、公開してよい情報 */
export interface PageSummary {
  id: string
  url: string
  fields: EventFields
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  version: number
}

/** Date を ISO8601 文字列にした JSON 用の型。API のリクエスト／レスポンスと localStorage で使う */
export type Jsonified<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K]
}
export type EventFieldsJson = Jsonified<EventFields>
export type PageSummaryJson = Omit<Jsonified<PageSummary>, 'fields'> & { fields: EventFieldsJson }

export function toEventFieldsJson(fields: EventFields): EventFieldsJson {
  return {
    title: fields.title,
    location: fields.location,
    memo: fields.memo,
    start: fields.start ? fields.start.toISOString() : null,
    end: fields.end ? fields.end.toISOString() : null,
    isAllDay: fields.isAllDay,
  }
}

// クライアントが送るのは Date.prototype.toISOString() の出力だけなので、その形（UTC、Z 終端）だけを受け付ける
const ISO8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

/**
 * JSON.parse 直後の信頼できない値を受け取る想定。EventFieldsJson 型は静的な建前でしかなく、
 * 実行時には型が違う・項目が欠けた値も届きうるので、フィールドごとに検査してから返す。
 * 形式不正は例外（API 側で INVALID_REQUEST にする）
 */
export function fromEventFieldsJson(json: EventFieldsJson): EventFields {
  return {
    title: requireString(json.title, 'title'),
    location: requireNullableString(json.location, 'location'),
    memo: requireNullableString(json.memo, 'memo'),
    start: parseDateOrThrow(json.start, 'start'),
    end: parseDateOrThrow(json.end, 'end'),
    isAllDay: requireBoolean(json.isAllDay, 'isAllDay'),
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid ${field}: expected string`)
  }
  return value
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null
  return requireString(value, field)
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`invalid ${field}: expected boolean`)
  }
  return value
}

function parseDateOrThrow(value: unknown, field: string): Date | null {
  if (value === null) return null
  if (typeof value !== 'string' || !ISO8601_PATTERN.test(value)) {
    throw new Error(`invalid ${field}: expected ISO8601 string`)
  }
  const date = new Date(value)
  // 2/30 や 24:00 のような暦に存在しない日時は Invalid Date にならず別の日時に繰り上がるので、
  // toISOString() に戻して先頭 19 文字（年月日時分秒）が入力と一致するかで弾く
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`invalid ${field}: expected ISO8601 string`)
  }
  return date
}

/** 作成の流入元（§6.1）。pages.source に保存し転換率の集計に使う */
export type CreateSource = 'direct' | 'detail_cta' | 'prefill'

/** 通報理由（§9.4）。API リクエスト・ports/notifier・ports/reportRepository で共用 */
export type ReportReason = 'spam' | 'personal_info' | 'inappropriate' | 'other'

/** core/validate が返す検証エラー（§5.7）。API の ApiError.code の一部でもあるので T1 でここに置く */
export type ValidationErrorCode =
  | 'EMPTY_INPUT'
  | 'INPUT_TOO_LONG'
  | 'INVALID_RANGE'
  | 'PAST_EVENT'
  | 'BEYOND_MAX_LEAD_TIME'
  | 'TOO_MANY_URLS'

/** 変更バナー用の編集前スナップショット。日時だけを持ち、タイトル・場所は変わった事実だけを持つ（§3.5） */
export interface ChangeSnapshot {
  start: Date | null
  end: Date | null
  isAllDay: boolean
  titleChanged: boolean
  locationChanged: boolean
}

export type ManualState = 'auto' | 'manual'
export type FieldKey = keyof EventFields
