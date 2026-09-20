import { Hono } from 'hono'
import type { HealthResponse } from '../../core/api/types'
import type { Deps } from '../deps'
import type { Env } from '../env'

export function healthRoutes(_deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/api/health', (c) => {
    const body: HealthResponse = { ok: true }
    c.header('Cache-Control', 'no-store')
    return c.json(body)
  })

  return app
}
