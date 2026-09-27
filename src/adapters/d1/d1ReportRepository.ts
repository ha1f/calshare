import { requireDefined } from '../../core/assert'
import type {
  InsertReportResult,
  NewReportInput,
  ReportRepository,
} from '../../ports/reportRepository'

interface ReportCountRow {
  report_count: number
}

export function createD1ReportRepository(db: D1Database): ReportRepository {
  return {
    async insertIfNotDuplicate(
      report: NewReportInput,
      dedupeSince: Date,
    ): Promise<InsertReportResult> {
      // 重複確認と INSERT を 1 文にする。別文に分けると、確認と INSERT の間に別リクエストが割り込み、
      // 並行リクエストが揃って重複扱いをすり抜ける
      const insertStmt = db
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
      // INSERT が重複で見送られたときは id が reports に無いので EXISTS が false になり、
      // report_count はここでは加算されない（保存と加算を同じ batch で揃える。docs/guidelines.md §4.3）
      const updateStmt = db
        .prepare(
          `UPDATE pages SET report_count = report_count + 1
           WHERE id = ? AND EXISTS (SELECT 1 FROM reports WHERE id = ?)
           RETURNING report_count`,
        )
        .bind(report.pageId, report.id)

      const [insertResult, updateResult] = await db.batch<ReportCountRow>([insertStmt, updateStmt])
      if (requireDefined(insertResult, 'batch returns a result per statement').meta.changes === 0) {
        return { kind: 'duplicate' }
      }
      const row = requireDefined(updateResult, 'batch returns a result per statement').results[0]
      return { kind: 'inserted', reportCount: row?.report_count ?? 0 }
    },
  }
}
