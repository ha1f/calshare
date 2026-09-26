import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'
import type { Deps } from '../deps'
import { logRequestCompleted } from '../lib/logger'

/**
 * 全リクエストの完了時にルート名・メソッド・ステータス・所要時間・pageId をログに残す（§9.6）。
 * `app.onError` で例外が応答に変換された後の `c.res` も対象になるよう、`securityHeaders` の内側・
 * 各ルートの外側に登録する
 */
export function requestLog(deps: Deps) {
  return createMiddleware(async (c, next) => {
    const start = Date.now()
    await next()
    logRequestCompleted(deps.logger, {
      route: routePath(c),
      method: c.req.method,
      status: c.res.status,
      durationMs: Date.now() - start,
      pageId: c.req.param('id'),
    })
  })
}
