import { Hono } from 'hono'
import { DETAIL_CACHE_MAX_AGE_SECONDS } from '../../core/config/limits'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { withEdgeCache } from '../lib/edgeCache'
import { isServable } from '../lib/pageAccess'
import { DetailPage } from '../views/DetailPage'
import { NotFound } from '../views/NotFound'

export function detailRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  // catch-all（§2.2 の評価順序で最後）。ID 形式に合わないパスはこのルートに一致せず app.notFound になる
  app.get(`/:id{${PAGE_ID_PATTERN}}`, async (c) => {
    const id = c.req.param('id')
    // request.url をそのままキーにすると、Hono がデコードしてから照合する %XX 表記違いのぶんだけ
    // キャッシュキーが割れる（同じページなのに別キー）。検証済みの id から正規化して組み直す（§2.4）
    const cacheKeyRequest = new Request(new URL(`/${id}`, c.req.url))
    return withEdgeCache(
      cacheKeyRequest,
      c.executionCtx,
      DETAIL_CACHE_MAX_AGE_SECONDS,
      async () => {
        const now = deps.clock.now()
        const page = await deps.pages.findById(id)

        if (page === null || !isServable(page, now)) {
          return c.html(<NotFound serviceName={deps.config.serviceName} />, 404)
        }

        return c.html(<DetailPage page={page} config={deps.config} now={now} />)
      },
    )
  })

  return app
}
