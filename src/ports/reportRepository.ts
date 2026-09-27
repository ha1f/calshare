import type { ReportReason } from '../core/types'

export interface NewReportInput {
  id: string // UUID
  pageId: string
  reason: ReportReason
  comment: string | null
  ipHash: string
  now: Date
}
export type InsertReportResult = { kind: 'inserted'; reportCount: number } | { kind: 'duplicate' }

export interface ReportRepository {
  /**
   * 同一 ipHash・同一 pageId の通報が dedupeSince 以降に既にあれば duplicate を返して INSERT しない（§9.3 の 24 時間デデュープ）。
   * 無ければ同じ db.batch() で reports に INSERT し pages.report_count を +1 する（§4.3）。保存と加算のどちらかだけが成功する状態を作らない
   */
  insertIfNotDuplicate(report: NewReportInput, dedupeSince: Date): Promise<InsertReportResult>
}
