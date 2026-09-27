import type { NewReportInput, ReportRepository } from '../../ports/reportRepository'

/** `${pageId}:${ipHash}` をキーに最終通報時刻を持つインメモリ実装。D1 実装と同じテストスイートで検証する */
export function createMemoryReportRepository(): ReportRepository {
  const lastReportedAt = new Map<string, Date>()

  return {
    insertIfNotDuplicate: (report: NewReportInput, dedupeSince: Date) => {
      const key = `${report.pageId}:${report.ipHash}`
      const previous = lastReportedAt.get(key)
      if (previous && previous >= dedupeSince) {
        return Promise.resolve('duplicate' as const)
      }
      lastReportedAt.set(key, report.now)
      return Promise.resolve('inserted' as const)
    },
  }
}
