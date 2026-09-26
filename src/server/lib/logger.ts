import type { Logger } from '../../ports/logger'

export interface RequestLogContext {
  route: string
  method: string
  status: number
  durationMs: number
  /** ページ ID を含むルートでのみ渡す。URL パスパラメータの `id` が対象で、拡張子などは呼び出し側で剥がさない */
  pageId?: string
}

/**
 * リクエスト完了時のログ 1 行を出す（§9.6）。ルート名・メソッド・ステータス・所要時間・pageId のみを載せ、
 * クエリ文字列や本文は一切受け取らない
 */
export function logRequestCompleted(logger: Logger, context: RequestLogContext): void {
  logger.info('request_completed', {
    route: context.route,
    method: context.method,
    status: context.status,
    durationMs: context.durationMs,
    pageId: context.pageId,
  })
}

/**
 * ルートが catch していない例外を構造化ログに残す（§9.6）。Hono の既定の errorHandler は
 * `console.error(err)` で生の Error（スタックトレース込み）を出すため、Logger 経由に一本化して
 * `consoleLogger` の正規化（{ name, message }）に乗せる
 */
export function logUnhandledError(
  logger: Logger,
  context: { route: string; pageId?: string },
  error: unknown,
): void {
  logger.error('unhandled_error', { route: context.route, pageId: context.pageId, error })
}
