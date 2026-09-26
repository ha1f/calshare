import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { PageRecord } from '../../ports/pageRepository'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { ReportPage } from '../views/ReportPage'

/** hidden／期限切れのページは通報フォームも 404 にする（存在しないページと区別させない、§4.1） */
export function isReportTargetServable(page: PageRecord, now: Date): boolean {
  return page.status === 'active' && page.expiresAt > now
}

export function reportPageRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get(`/:id{${PAGE_ID_PATTERN}}/report`, async (c) => {
    const pageId = c.req.param('id')
    const page = await deps.pages.findById(pageId)
    if (page === null || !isReportTargetServable(page, deps.clock.now())) {
      return c.notFound()
    }

    // noindex は meta タグと X-Robots-Tag の両方で示す（§9.5）
    c.header('X-Robots-Tag', 'noindex, nofollow')
    return c.html(html`${raw('<!DOCTYPE html>')}${(<ReportPage pageId={page.id} />)}`)
  })

  return app
}
