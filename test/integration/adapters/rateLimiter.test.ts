import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { createD1RateLimiter } from '../../../src/adapters/d1/d1RateLimiter'
import { createMemoryRateLimiter } from '../../../src/adapters/memory/memoryRateLimiter'
import type { RateLimiter, RateLimitRule } from '../../../src/ports/rateLimiter'

// このアダプタの担当外（D1 スキーマのタスクが migrations/ に置く）なので、§3 の定義どおりに
// テストのセットアップだけでテーブルを作る。migrations/ には何も追加しない。
// db.exec() は改行区切りで文を分割するため、複数行にまたがる CREATE TABLE には使えない。
// 単一のステートメントなので prepare().run() で実行する。
async function createRateLimitCountersTable(): Promise<void> {
  await env.DB.exec('DROP TABLE IF EXISTS rate_limit_counters')
  await env.DB.prepare(
    `CREATE TABLE rate_limit_counters (
      scope TEXT NOT NULL,
      bucket_key TEXT NOT NULL,
      window_kind TEXT NOT NULL,
      window_start TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, bucket_key, window_kind, window_start)
    )`,
  ).run()
}

function ipRule(overrides: Partial<RateLimitRule> = {}): RateLimitRule {
  return { scope: 'create', bucketKey: 'ip:aaa', window: 'hour', limit: 2, ...overrides }
}

describe.each([
  ['D1', () => createD1RateLimiter(env.DB)],
  ['memory', () => createMemoryRateLimiter()],
] as const)('%s RateLimiter', (_name, createLimiter) => {
  let limiter: RateLimiter

  beforeEach(async () => {
    await createRateLimitCountersTable()
    limiter = createLimiter()
  })

  it('上限未満は allowed になり、カウントが進む', async () => {
    const now = new Date('2026-09-16T01:00:00.000Z')
    const rule = ipRule({ limit: 2 })

    expect(await limiter.consume([rule], now)).toEqual({ allowed: true, exceeded: [] })
    expect(await limiter.consume([rule], now)).toEqual({ allowed: true, exceeded: [] })
  })

  it('上限に達すると allowed=false になり、exceeded に該当ルールが入る', async () => {
    const now = new Date('2026-09-16T01:00:00.000Z')
    const rule = ipRule({ limit: 1 })

    expect(await limiter.consume([rule], now)).toEqual({ allowed: true, exceeded: [] })
    expect(await limiter.consume([rule], now)).toEqual({ allowed: false, exceeded: [rule] })
  })

  it('上限超過後に何度呼んでもカウントは増えない（同じ状態のまま exceeded を返す）', async () => {
    const now = new Date('2026-09-16T01:00:00.000Z')
    const rule = ipRule({ limit: 1 })

    await limiter.consume([rule], now)
    await limiter.consume([rule], now)
    await limiter.consume([rule], now)

    // カウントが増え続けていれば、後で上限を上げたときに古いカウントが残ってしまう。
    // 窓を跨がず、同じ rule を limit=2 で試すと「まだ 1 回分の余地がある」ことで検証する
    const relaxedRule = { ...rule, limit: 2 }
    expect(await limiter.consume([relaxedRule], now)).toEqual({ allowed: true, exceeded: [] })
  })

  it('ip と device は独立したバケットで数える', async () => {
    const now = new Date('2026-09-16T01:00:00.000Z')
    const ip = ipRule({ bucketKey: 'ip:aaa', limit: 1 })
    const device = ipRule({ bucketKey: 'device:zzz', limit: 1 })

    await limiter.consume([ip], now)
    expect(await limiter.consume([ip], now)).toEqual({ allowed: false, exceeded: [ip] })
    // ip 側が超過していても device 側は別バケットなので許可される
    expect(await limiter.consume([device], now)).toEqual({ allowed: true, exceeded: [] })
  })

  it('1 回の consume に複数ルールを渡し、1 つでも超過すればどれも進めない', async () => {
    const now = new Date('2026-09-16T01:00:00.000Z')
    const hourRule = ipRule({ window: 'hour', limit: 1 })
    const dayRule = ipRule({ window: 'day', limit: 100 })

    await limiter.consume([hourRule, dayRule], now)
    const result = await limiter.consume([hourRule, dayRule], now)
    expect(result).toEqual({ allowed: false, exceeded: [hourRule] })

    // day 側のカウントは 1 のまま進んでいないはず（99 回追加で消費できる）
    const oneHourLater = new Date('2026-09-16T02:00:00.000Z')
    for (let i = 0; i < 98; i++) {
      expect((await limiter.consume([dayRule], oneHourLater)).allowed).toBe(true)
    }
    expect((await limiter.consume([dayRule], oneHourLater)).allowed).toBe(true)
    expect((await limiter.consume([dayRule], oneHourLater)).allowed).toBe(false)
  })

  it('時間窓の境界を跨ぐとカウントがリセットされる', async () => {
    const rule = ipRule({ window: 'hour', limit: 1 })
    const beforeBoundary = new Date('2026-09-16T01:59:59.000Z')
    const afterBoundary = new Date('2026-09-16T02:00:00.000Z')

    expect(await limiter.consume([rule], beforeBoundary)).toEqual({ allowed: true, exceeded: [] })
    expect(await limiter.consume([rule], beforeBoundary)).toEqual({
      allowed: false,
      exceeded: [rule],
    })
    // 窓が変わったので同じルールでも再び許可される
    expect(await limiter.consume([rule], afterBoundary)).toEqual({ allowed: true, exceeded: [] })
  })

  it('日窓の境界を跨ぐとカウントがリセットされる', async () => {
    const rule = ipRule({ window: 'day', limit: 1 })
    const beforeBoundary = new Date('2026-09-16T23:59:59.000Z')
    const afterBoundary = new Date('2026-09-17T00:00:00.000Z')

    expect(await limiter.consume([rule], beforeBoundary)).toEqual({ allowed: true, exceeded: [] })
    expect(await limiter.consume([rule], beforeBoundary)).toEqual({
      allowed: false,
      exceeded: [rule],
    })
    expect(await limiter.consume([rule], afterBoundary)).toEqual({ allowed: true, exceeded: [] })
  })

  describe('deleteExpired', () => {
    it('指定時刻より前の窓の行だけを消す。以降の窓は残る', async () => {
      const rule = ipRule({ window: 'hour', limit: 1 })
      const oldWindow = new Date('2026-09-01T00:30:00.000Z') // window_start = 2026-09-01T00:00:00Z
      const newWindow = new Date('2026-09-01T02:30:00.000Z') // window_start = 2026-09-01T02:00:00Z

      await limiter.consume([rule], oldWindow)
      await limiter.consume([rule], newWindow)

      await limiter.deleteExpired(new Date('2026-09-01T01:00:00.000Z'))

      // 古い窓の行は消えたので再び許可される
      expect(await limiter.consume([rule], oldWindow)).toEqual({ allowed: true, exceeded: [] })
      // 新しい窓の行は残っているので、既に上限に達したまま
      expect(await limiter.consume([rule], newWindow)).toEqual({ allowed: false, exceeded: [rule] })
    })
  })
})

describe('D1RateLimiter（テーブル行の検証）', () => {
  beforeEach(async () => {
    await createRateLimitCountersTable()
  })

  it('上限超過後にリクエストを重ねても rate_limit_counters の行数は増えない', async () => {
    const limiter = createD1RateLimiter(env.DB)
    const now = new Date('2026-09-16T01:00:00.000Z')
    const rule = ipRule({ limit: 1 })

    await limiter.consume([rule], now)
    await limiter.consume([rule], now)
    await limiter.consume([rule], now)

    const { results } = await env.DB.prepare('SELECT count FROM rate_limit_counters').all<{
      count: number
    }>()
    expect(results).toHaveLength(1)
    expect(results[0].count).toBe(1)
  })
})
