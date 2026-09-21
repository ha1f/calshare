import type { NewReportInput, ReportRepository } from '../../ports/reportRepository'

export function createD1ReportRepository(db: D1Database): ReportRepository {
  return {
    async insertIfNotDuplicate(report: NewReportInput, dedupeSince: Date) {
      // 重複確認と INSERT を 1 文にする。別文に分けると、確認と INSERT の間に別リクエストが割り込み、
      // 並行リクエストが揃って重複扱いをすり抜ける
      const result = await db
        .prepare(
          `INSERT INTO reports (id, page_id, reason, comment, ip_hash, created_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM reports WHERE page_id = ? AND ip_hash = ? AND created_at >= ?
           )`,
        )
        .bind(
          report.id,
          report.pageId,
          report.reason,
          report.comment,
          report.ipHash,
          report.now.toISOString(),
          report.pageId,
          report.ipHash,
          dedupeSince.toISOString(),
        )
        .run()
      return result.meta.changes === 1 ? 'inserted' : 'duplicate'
    },
  }
}
