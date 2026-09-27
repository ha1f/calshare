import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { routePath } from 'hono/route'
import type { Deps } from './deps'
import type { Env } from './env'
import { ApiRequestError, toApiErrorResponse } from './lib/errors'
import { logUnhandledError, resolveLoggablePageId } from './lib/logger'
import { handleNotFound } from './lib/notFound'
import { securityHeaders } from './middleware/securityHeaders'
import { requestLog } from './middleware/requestLog'
import { apiPagesRoutes } from './routes/apiPages'
import { apiPagesEditRoutes } from './routes/apiPagesEdit'
import { apiReportsRoutes } from './routes/apiReports'
import { detailRoutes } from './routes/detail'
import { editPageRoutes } from './routes/editPage'
import { healthRoutes } from './routes/health'
import { icsRoutes } from './routes/ics'
import { ogpRoutes } from './routes/ogp'
import { reportPageRoutes } from './routes/reportPage'

export function createApp(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  // 全ルートより先に登録する。後から足すルートはヘッダ付与の対象から漏れる（§9.1）
  app.use('*', securityHeaders())

  // ルートが投げた例外・意図的な ApiRequestError はここで応答に変換する。各ルートに
  // try / catch と c.json(body, status) を繰り返し書かない（docs/guidelines.md §5.4）
  app.onError((err, c) => {
    // HTTPException は Hono 自身が投げることがあるので、自前のステータス・レスポンスをそのまま返す
    if (err instanceof HTTPException) return err.getResponse()

    const isApi = c.req.path.startsWith('/api/')
    // ApiRequestError の 4xx は /api/* では意図した応答なのでログに残さない。HTML ルートは
    // 常に 500 を返すので、応答が 5xx になるときは必ず記録する
    if (!isApi || !(err instanceof ApiRequestError) || err.status >= 500) {
      const pageId = resolveLoggablePageId(c.req.param('id'))
      logUnhandledError(deps.logger, { route: routePath(c), pageId }, err)
    }

    if (isApi) {
      const { status, body } = toApiErrorResponse(err)
      return c.json(body, status)
    }
    return c.text('Internal Server Error', 500)
  })

  // どのルートにも一致しないリクエストへの応答（docs/guidelines.md §5.4）。top-level app にしか効かないので、
  // routes/*.ts の各サブアプリには登録しない
  app.notFound((c) => handleNotFound(c, deps.config.serviceName))

  // リクエスト完了ログ用ミドルウェア（requestLog.ts）。onError が応答に変換した後のステータスも
  // 記録できるよう各ルートの外側に置く
  app.use('*', requestLog(deps))

  // §2.2 の評価順序で 1 行ずつ足す（後続 PR はこのファイルへの追記のみ許される、§11.6）
  app.route('/', healthRoutes(deps))
  app.route('/', apiPagesRoutes(deps))
  app.route('/', apiPagesEditRoutes(deps))
  app.route('/', apiReportsRoutes(deps))
  app.route('/', icsRoutes(deps))
  app.route('/', ogpRoutes(deps))
  app.route('/', editPageRoutes(deps))
  app.route('/', reportPageRoutes(deps))
  app.route('/', detailRoutes(deps))

  return app
}
