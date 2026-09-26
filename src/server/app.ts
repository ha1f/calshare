import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { routePath } from 'hono/route'
import type { Deps } from './deps'
import type { Env } from './env'
import { logUnhandledError, resolveLoggablePageId } from './lib/logger'
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

  // ルートが catch していない例外はここで 500 に変換する。Hono の既定ハンドラの
  // console.error(err) を避け、構造化ログ（§9.6）に一本化するため。HTTPException は
  // ステータス・レスポンスを自分で持っているので、そのまま返す（Hono 既定ハンドラと同じ扱い）
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse()
    logUnhandledError(
      deps.logger,
      { route: routePath(c), pageId: resolveLoggablePageId(c.req.param('id')) },
      err,
    )
    return c.text('Internal Server Error', 500)
  })

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
