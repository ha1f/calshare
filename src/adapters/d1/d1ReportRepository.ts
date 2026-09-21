import type { NewReportInput, ReportRepository } from '../../ports/reportRepository'

export function createD1ReportRepository(db: D1Database): ReportRepository {
  return {
    async insertIfNotDuplicate(report: NewReportInput, dedupeSince: Date) {
      const duplicate = await db
        .prepare(
          'SELECT 1 FROM reports WHERE page_id = ? AND ip_hash = ? AND created_at >= ? LIMIT 1',
        )
        .bind(report.pageId, report.ipHash, dedupeSince.toISOString())
        .first()
      if (duplicate) return 'duplicate'

      await db
        .prepare(
          'INSERT INTO reports (id, page_id, reason, comment, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          report.id,
          report.pageId,
          report.reason,
          report.comment,
          report.ipHash,
          report.now.toISOString(),
        )
        .run()
      return 'inserted'
    },
  }
}
