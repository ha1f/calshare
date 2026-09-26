import { Hono } from 'hono'
import type { Deps } from './deps'
import type { Env } from './env'
import { securityHeaders } from './middleware/securityHeaders'
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
