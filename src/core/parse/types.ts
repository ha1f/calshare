export interface ParseContext {
  /** 基準時刻。テストでは固定値、本番では new Date() */
  now: Date
}

export type ParseIssue =
  | 'no_datetime' // 日付も時刻も見つからない（下書き）
  | 'invalid_date' // 2/30 のような存在しない日付があった
  | 'past_date' // 年を明示した過去日
  | 'beyond_max_lead_time' // 13 ヶ月より先

export interface ParsedEvent {
  title: string // 空文字にはしない（§5.5 規則 T）
  location: string | null
  memo: string | null // 1 行目の残り + 2 行目以降。無ければ null
  start: Date | null // 確定できなければ null（下書き）
  end: Date | null // start が非 null なら必ず非 null
  isAllDay: boolean
  issues: ParseIssue[]
  /** 残りが空白区切り 1 語だけでタイトルにした場合 true。UI の「場所にする」入れ替えに使う（§6.1） */
  singleTokenTitle: boolean
}
