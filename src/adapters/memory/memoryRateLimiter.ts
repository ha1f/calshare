import type { RateLimiter, RateLimitRule, RateLimitWindow } from '../../ports/rateLimiter'

/** 窓の開始時刻を UTC で切り捨てる（§9.3）。d1RateLimiter と同じ規則 */
function windowStart(now: Date, window: RateLimitWindow): string {
  const truncated =
    window === 'hour'
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return new Date(truncated).toISOString()
}

interface CounterEntry {
  windowStart: string
  count: number
}

/** rate_limit_counters と同じ (scope, bucketKey, window, windowStart) をキーにする。値に ':' を含みうるため JSON で組む */
function counterKey(rule: RateLimitRule, windowStartValue: string): string {
  return JSON.stringify([rule.scope, rule.bucketKey, rule.window, windowStartValue])
}

/** d1RateLimiter と同じテストスイートで検証するインメモリ実装（§9.3・§11.4） */
export function createMemoryRateLimiter(): RateLimiter {
  const counters = new Map<string, CounterEntry>()

  return {
    consume: async (rules, now) => {
      const targets = rules.map((rule) => {
        const ws = windowStart(now, rule.window)
        return { rule, key: counterKey(rule, ws), windowStart: ws }
      })

      const exceeded = targets
        .filter(({ rule, key }) => (counters.get(key)?.count ?? 0) >= rule.limit)
        .map(({ rule }) => rule)
      if (exceeded.length > 0) return { allowed: false, exceeded }

      for (const { key, windowStart: ws } of targets) {
        const current = counters.get(key)
        counters.set(key, { windowStart: ws, count: (current?.count ?? 0) + 1 })
      }
      return { allowed: true, exceeded: [] }
    },
    deleteExpired: async (before) => {
      const cutoff = before.toISOString()
      for (const [key, entry] of counters) {
        if (entry.windowStart < cutoff) counters.delete(key)
      }
    },
  }
}
