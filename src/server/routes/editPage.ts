import { Hono } from 'hono'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'

/**
 * 編集画面の HTML を配信する（§2.2）。可変 ID を含むパスは Static Assets のビルド時ルーティングに
 * 一致しないため、Worker が env.ASSETS.fetch(new URL('/edit', ...)) で編集画面の HTML を取りに行き、
 * そのまま返す。D1 には触れない（トークンの有無や中身は編集画面の JS が GET /api/pages/:id で確認する）
 */
export function editPageRoutes(_deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get(`/:id{${PAGE_ID_PATTERN}}/edit`, async (c) => {
    const assetUrl = new URL('/edit', c.req.url)
    const assetResponse = await c.env.ASSETS.fetch(assetUrl)
    // ASSETS から返る Response のヘッダは変更不可なので、包み直してから X-Robots-Tag を足す（§2.2・§9.5）
    const response = new Response(assetResponse.body, assetResponse)
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  })

  return app
}
