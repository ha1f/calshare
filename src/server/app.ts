import { Hono } from 'hono'
import type { Deps } from './deps'
import type { Env } from './env'
import { healthRoutes } from './routes/health'

export function createApp(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  // §2.2 の評価順序で 1 行ずつ足す（後続 PR はこのファイルへの追記のみ許される、§11.6）
  app.route('/', healthRoutes(deps))

  return app
}
