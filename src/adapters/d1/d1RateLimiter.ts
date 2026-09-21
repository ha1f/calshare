import type { RateLimiter, RateLimitWindow } from '../../ports/rateLimiter'

/** 窓の開始時刻を UTC で切り捨てる（§9.3）。memoryRateLimiter と同じ規則 */
function windowStart(now: Date, window: RateLimitWindow): string {
  const truncated =
    window === 'hour'
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(truncated).toISOString()
}

interface RowCount {
  count: number
}

/**
 * D1 の rate_limit_counters（§3.1）を使う固定窓レート制限。まず全ルールの現在値を SELECT で読み、
 * 1 つでも上限以上なら書かずに allowed=false を返す。全て未満のときだけ db.batch() で 1 回ずつ進める（§9.3）。
 * テーブルのマイグレーションはこのアダプタの担当外（D1 スキーマのタスクが migrations/ に置く）。
 */
export function createD1RateLimiter(db: D1Database): RateLimiter {
  return {
    consume: async (rules, now) => {
      if (rules.length === 0) return { allowed: true, exceeded: [] }

      const targets = rules.map((rule) => ({ rule, windowStart: windowStart(now, rule.window) }))
      const selectResults = await db.batch<RowCount>(
        targets.map(({ rule, windowStart: ws }) =>
          db
            .prepare(
              'SELECT count FROM rate_limit_counters WHERE scope = ? AND bucket_key = ? AND window_kind = ? AND window_start = ?',
            )
            .bind(rule.scope, rule.bucketKey, rule.window, ws),
        ),
      )

      const exceeded = targets
        .filter(({ rule }, i) => (selectResults[i].results[0]?.count ?? 0) >= rule.limit)
        .map(({ rule }) => rule)
      if (exceeded.length > 0) return { allowed: false, exceeded }

      await db.batch(
        targets.map(({ rule, windowStart: ws }) =>
          db
            .prepare(
              `INSERT INTO rate_limit_counters (scope, bucket_key, window_kind, window_start, count)
               VALUES (?, ?, ?, ?, 1)
               ON CONFLICT (scope, bucket_key, window_kind, window_start)
               DO UPDATE SET count = count + 1`,
            )
            .bind(rule.scope, rule.bucketKey, rule.window, ws),
        ),
      )
      return { allowed: true, exceeded: [] }
    },
    deleteExpired: async (before) => {
      await db
        .prepare('DELETE FROM rate_limit_counters WHERE window_start < ?')
        .bind(before.toISOString())
        .run()
    },
  }
}
