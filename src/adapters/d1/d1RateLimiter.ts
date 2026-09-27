import { requireDefined } from '../../core/assert'
import type { RateLimiter, RateLimitWindow } from '../../ports/rateLimiter'

/** 窓の開始時刻を UTC で切り捨てる（§9.3）。memoryRateLimiter からもこの関数を import する */
export function windowStart(now: Date, window: RateLimitWindow): string {
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
 * 1 つでも上限以上なら書かずに allowed=false を返す（§9.3）。全て未満のときだけ書き込みに進む。
 * テーブルのマイグレーションはこのアダプタの担当外（D1 スキーマのタスクが migrations/ に置く）。
 */
export function createD1RateLimiter(db: D1Database): RateLimiter {
  return {
    consume: async (rules, now) => {
      if (rules.length === 0) return { allowed: true, exceeded: [] }

      const targets = rules.map((rule) => ({ rule, windowStart: windowStart(now, rule.window) }))
      // db は buildDeps 時点では読まないので、他のアダプタと同じく呼び出しの中で prepare する
      // （deps.test.ts が固定する不変条件）
      const selectStmt = db.prepare(
        'SELECT count FROM rate_limit_counters WHERE scope = ? AND bucket_key = ? AND window_kind = ? AND window_start = ?',
      )
      const selectResults = await db.batch<RowCount>(
        targets.map(({ rule, windowStart: ws }) =>
          selectStmt.bind(rule.scope, rule.bucketKey, rule.window, ws),
        ),
      )

      const preExceeded = targets
        .filter(({ rule }, i) => {
          const result = requireDefined(selectResults[i], 'batch returns a result per statement')
          return (result.results[0]?.count ?? 0) >= rule.limit
        })
        .map(({ rule }) => rule)
      if (preExceeded.length > 0) return { allowed: false, exceeded: preExceeded }

      // SELECT と書き込みの間に他リクエストが割り込むと、ここまでの判定だけでは上限を超えて書ける。
      // RETURNING で書き込み後の値を受け取り、超えていれば exceeded として返す（書き込み自体は取り消せない）。
      const insertStmt = db.prepare(
        `INSERT INTO rate_limit_counters (scope, bucket_key, window_kind, window_start, count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (scope, bucket_key, window_kind, window_start)
         DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      const insertResults = await db.batch<RowCount>(
        targets.map(({ rule, windowStart: ws }) =>
          insertStmt.bind(rule.scope, rule.bucketKey, rule.window, ws),
        ),
      )
      const exceeded = targets
        .filter(({ rule }, i) => {
          const result = requireDefined(insertResults[i], 'batch returns a result per statement')
          return (result.results[0]?.count ?? Infinity) > rule.limit
        })
        .map(({ rule }) => rule)
      return { allowed: exceeded.length === 0, exceeded }
    },
    deleteExpired: async (before) => {
      await db
        .prepare('DELETE FROM rate_limit_counters WHERE window_start < ?')
        .bind(before.toISOString())
        .run()
    },
  }
}
