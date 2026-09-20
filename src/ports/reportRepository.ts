import type { ReportReason } from '../core/types'

export interface NewReportInput {
  id: string // UUID
  pageId: string
  reason: ReportReason
  comment: string | null
  ipHash: string
  now: Date
}
export interface ReportRepository {
  /**
   * 同一 ipHash・同一 pageId の通報が dedupeSince 以降に既にあれば 'duplicate' を返して INSERT しない（§9.3 の 24 時間デデュープ）。
   * 無ければ INSERT して 'inserted'。report_count の +1 は呼び出し側が PageRepository.incrementReportCount で行う
   */
  insertIfNotDuplicate(report: NewReportInput, dedupeSince: Date): Promise<'inserted' | 'duplicate'>
}
