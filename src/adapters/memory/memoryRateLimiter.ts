import { windowStart } from '../d1/d1RateLimiter'
import type { RateLimiter, RateLimitRule } from '../../ports/rateLimiter'

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
    consume: (rules, now) => {
      const targets = rules.map((rule) => {
        const ws = windowStart(now, rule.window)
        return { rule, key: counterKey(rule, ws), windowStart: ws }
      })

      const exceeded = targets
        .filter(({ rule, key }) => (counters.get(key)?.count ?? 0) >= rule.limit)
        .map(({ rule }) => rule)
      if (exceeded.length > 0) return Promise.resolve({ allowed: false, exceeded })

      for (const { key, windowStart: ws } of targets) {
        const current = counters.get(key)
        counters.set(key, { windowStart: ws, count: (current?.count ?? 0) + 1 })
      }
      return Promise.resolve({ allowed: true, exceeded: [] })
    },
    deleteExpired: (before) => {
      const cutoff = before.toISOString()
      for (const [key, entry] of counters) {
        if (entry.windowStart < cutoff) counters.delete(key)
      }
      return Promise.resolve()
    },
  }
}
