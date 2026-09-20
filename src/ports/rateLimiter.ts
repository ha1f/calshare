/** 'interpret' は Phase 2 の POST /api/interpret 用に予約（§5.9）。Phase 1 では使わない */
export type RateLimitScope = 'create' | 'report' | 'interpret'
export type RateLimitWindow = 'hour' | 'day'
export interface RateLimitRule {
  scope: RateLimitScope
  bucketKey: string
  window: RateLimitWindow
  limit: number
}
export interface RateLimiter {
  /**
   * まず全ルールの現在値を読み、1 つでも上限以上なら書かずに allowed=false を返す。
   * 全て未満のときだけカウンタを進める（§9.3）
   */
  consume(
    rules: RateLimitRule[],
    now: Date,
  ): Promise<{ allowed: boolean; exceeded: RateLimitRule[] }>
  deleteExpired(before: Date): Promise<void>
}
