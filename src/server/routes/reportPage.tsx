import { Hono } from 'hono'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { X_ROBOTS_TAG } from '../lib/headers'
import { isServable } from '../lib/pageAccess'
import { ReportPage } from '../views/ReportPage'

export function reportPageRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get(`/:id{${PAGE_ID_PATTERN}}/report`, async (c) => {
    const pageId = c.req.param('id')
    const page = await deps.pages.findById(pageId)
    if (page === null || !isServable(page, deps.clock.now())) {
      return c.notFound()
    }

    // noindex は meta タグと X-Robots-Tag の両方で示す（§9.5）
    c.header('X-Robots-Tag', X_ROBOTS_TAG)
    return c.html(<ReportPage pageId={page.id} serviceName={deps.config.serviceName} />)
  })

  return app
}
