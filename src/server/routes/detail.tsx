import { Hono } from 'hono'
import { DETAIL_CACHE_MAX_AGE_SECONDS } from '../../core/config/limits'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { withEdgeCache } from '../lib/edgeCache'
import { isServable } from '../lib/pageAccess'
import { applySecurityHeaders } from '../middleware/securityHeaders'
import { DetailPage } from '../views/DetailPage'
import { NotFound } from '../views/NotFound'

export function detailRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  // catch-all（§2.2 の評価順序で最後）。ID 形式に合わないパスはこのルートに一致せず Hono の既定 404 になる
  app.get(`/:id{${PAGE_ID_PATTERN}}`, async (c) => {
    return withEdgeCache(c.req.raw, c.executionCtx, DETAIL_CACHE_MAX_AGE_SECONDS, async () => {
      const id = c.req.param('id')
      const now = deps.clock.now()
      const page = await deps.pages.findById(id)

      if (page === null || !isServable(page, now)) {
        const res = await c.html(<NotFound serviceName={deps.config.serviceName} />, 404)
        return applySecurityHeaders(res)
      }

      const res = await c.html(<DetailPage page={page} config={deps.config} now={now} />)
      return applySecurityHeaders(res)
    })
  })

  return app
}
