export interface Logger {
  /** data.error に Error を渡してよい。実装が { name, message } に正規化する（§9.6） */
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}
