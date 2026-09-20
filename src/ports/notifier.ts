import type { ReportReason } from '../core/types'

export interface ReportNotification {
  pageId: string
  url: string // config.publicOrigin から組んだ詳細ページ URL
  reason: ReportReason
  comment: string | null // 実装側で URL 置換と 200 文字の切り詰めを行う（§9.4）
  reportCount: number
  activePagesFromSameCreator: number
}
export interface Notifier {
  notifyReport(n: ReportNotification): Promise<void>
}
