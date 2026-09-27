import type {
  InsertReportResult,
  NewReportInput,
  ReportRepository,
} from '../../ports/reportRepository'
import type { MemoryPageStore } from './memoryPageRepository'

/**
 * `${pageId}:${ipHash}` をキーに最終通報時刻を持つインメモリ実装。D1 実装と同じテストスイートで検証する。
 * report_count の加算は memoryPageRepository と共有する store を直接書き換えて表す（D1 の db.batch() に相当）
 */
export function createMemoryReportRepository(pages: MemoryPageStore): ReportRepository {
  const lastReportedAt = new Map<string, Date>()

  return {
    insertIfNotDuplicate: async (
      report: NewReportInput,
      dedupeSince: Date,
    ): Promise<InsertReportResult> => {
      const key = `${report.pageId}:${report.ipHash}`
      const previous = lastReportedAt.get(key)
      if (previous && previous >= dedupeSince) {
        return { kind: 'duplicate' }
      }
      lastReportedAt.set(key, report.now)
      const page = pages.get(report.pageId)
      if (page) page.reportCount += 1
      return { kind: 'inserted', reportCount: page?.reportCount ?? 0 }
    },
  }
}
