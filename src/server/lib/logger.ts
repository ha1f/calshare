import { isValidPageId } from '../../core/id/crockford'
import type { Logger } from '../../ports/logger'

export interface RequestLogContext {
  route: string
  method: string
  status: number
  durationMs: number
  /** 検証済みのページ ID のみを渡す。未知の文字列は resolveLoggablePageId で弾いてから渡す */
  pageId?: string
}

const ICS_EXTENSION = '.ics'

/**
 * ログに載せてよい pageId を返す。末尾の `.ics` を除いた値がページ ID の形式に一致するときだけ
 * その値を返し、それ以外は undefined にする。URL に書かれた任意の文字列をログに残さないため。
 */
export function resolveLoggablePageId(rawId: string | undefined): string | undefined {
  if (rawId === undefined) return undefined
  const id = rawId.endsWith(ICS_EXTENSION) ? rawId.slice(0, -ICS_EXTENSION.length) : rawId
  return isValidPageId(id) ? id : undefined
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
 * ルートが catch していない例外を構造化ログに残す（§9.6）。`consoleLogger` の正規化
 * （{ name, message }、200 文字切り詰め）に乗せる
 */
export function logUnhandledError(
  logger: Logger,
  context: { route: string; pageId?: string },
  error: unknown,
): void {
  logger.error('unhandled_error', { route: context.route, pageId: context.pageId, error })
}
