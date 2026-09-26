import { Hono } from 'hono'
import { ICS_CACHE_MAX_AGE_SECONDS } from '../../core/config/limits'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { withEdgeCache } from '../lib/edgeCache'
import { buildIcsForPage } from '../lib/ics'
import { isServable } from '../lib/pageAccess'

const ICS_EXTENSION = '.ics'

export function icsRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  // Hono の `:id{pattern}` はセグメント全体をパラメータ値にするため、`.ics` を含めた
  // パターンにしないと拡張子無しの `/:id` にも一致してしまう（§2.2）。ハンドラで拡張子を落とす
  app.get(`/:id{${PAGE_ID_PATTERN}\\${ICS_EXTENSION}}`, async (c) => {
    const id = c.req.param('id').slice(0, -ICS_EXTENSION.length)
    // request.url をそのまま使うと %XX 表記違いでキャッシュキーが割れる（§2.4、detail.tsx と同じ対策）
    const cacheKeyRequest = new Request(new URL(`/${id}${ICS_EXTENSION}`, c.req.url))

    return withEdgeCache(cacheKeyRequest, c.executionCtx, ICS_CACHE_MAX_AGE_SECONDS, async () => {
      const now = deps.clock.now()
      const page = await deps.pages.findById(id)
      if (page === null || !isServable(page, now)) {
        return c.notFound()
      }

      let ics = await deps.storage.getIcs(id)
      if (ics === null) {
        // 作成・更新時の R2 PUT 失敗からの自己修復（§2.3）。日時の無い下書きは buildIcsForPage が
        // null を返すので、その場合は再生成せず 404 のままにする
        ics = buildIcsForPage(page, deps.config, now)
        if (ics === null) return c.notFound()
        await deps.storage.putIcs(id, ics)
      }

      return c.text(ics, 200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    })
  })

  return app
}
