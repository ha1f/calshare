import { Hono } from 'hono'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { fetchAsset } from '../lib/assets'
import { X_ROBOTS_TAG } from '../lib/headers'

/**
 * 編集画面の HTML を配信する（§2.2）。可変 ID を含むパスは Static Assets のビルド時ルーティングに
 * 一致しないため、Worker が env.ASSETS.fetch(new URL('/edit', ...)) で編集画面の HTML を取りに行き、
 * そのまま返す。D1 には触れない（トークンの有無や中身は編集画面の JS が GET /api/pages/:id で確認する）
 */
export function editPageRoutes(_deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get(`/:id{${PAGE_ID_PATTERN}}/edit`, async (c) => {
    const response = await fetchAsset(c.env.ASSETS, new URL('/edit', c.req.url))
    response.headers.set('X-Robots-Tag', X_ROBOTS_TAG)
    return response
  })

  return app
}
