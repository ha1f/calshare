import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'
import type { Deps } from '../deps'
import { logRequestCompleted, resolveLoggablePageId } from '../lib/logger'

/** 全リクエストの完了時にルート名・メソッド・ステータス・所要時間・pageId をログに残す（§9.6） */
export function requestLog(deps: Deps) {
  return createMiddleware(async (c, next) => {
    const start = Date.now()
    await next()
    const pageId = resolveLoggablePageId(c.req.param('id'))
    logRequestCompleted(deps.logger, {
      route: routePath(c),
      method: c.req.method,
      status: c.res.status,
      durationMs: Date.now() - start,
      ...(pageId !== undefined && { pageId }),
    })
  })
}
