import { Hono } from 'hono'
import { toOgpInput } from '../../adapters/ogp/satoriOgpRenderer'
import { OGP_CACHE_MAX_AGE_SECONDS, OGP_FAILURE_CACHE_SECONDS } from '../../core/config/limits'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { fetchAsset } from '../lib/assets'
import { withEdgeCache } from '../lib/edgeCache'
import { X_ROBOTS_TAG } from '../lib/headers'
import { isServable } from '../lib/pageAccess'

const OGP_PATH_SUFFIX = '/ogp.png'
const FALLBACK_ASSET_PATH = '/assets/img/ogp-fallback.png'

function pngResponse(png: Uint8Array): Response {
  return new Response(png, {
    headers: { 'Content-Type': 'image/png', 'X-Robots-Tag': X_ROBOTS_TAG },
  })
}

/** wasm 例外・フォント取得失敗・非公開ページのいずれでもカードが壊れないフォールバック（§2.5） */
async function fallbackResponse(env: Env, requestUrl: string): Promise<Response> {
  const response = await fetchAsset(env.ASSETS, new URL(FALLBACK_ASSET_PATH, requestUrl))
  response.headers.set('X-Robots-Tag', X_ROBOTS_TAG)
  return response
}

export function ogpRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get(`/:id{${PAGE_ID_PATTERN}}${OGP_PATH_SUFFIX}`, async (c) => {
    const id = c.req.param('id')
    // og:image は `?v={version}` を付けて SNS 側のキャッシュを更新させる（§2.4）。キャッシュキーは
    // 検証済みの id と v だけから組み直し、それ以外のクエリで無限にキーを増やされないようにする
    const version = c.req.query('v')
    const cacheKeyUrl = new URL(`/${id}${OGP_PATH_SUFFIX}`, c.req.url)
    if (version !== undefined) cacheKeyUrl.searchParams.set('v', version)
    const cacheKeyRequest = new Request(cacheKeyUrl)

    return withEdgeCache(
      cacheKeyRequest,
      c.executionCtx,
      OGP_CACHE_MAX_AGE_SECONDS,
      async () => {
        const now = deps.clock.now()
        const page = await deps.pages.findById(id)
        if (page === null || !isServable(page, now)) {
          return fallbackResponse(c.env, c.req.url)
        }

        // R2 の読み取り失敗（一時的な障害）はレンダラの失敗とは別に扱う。失敗マーカーを
        // 立てずにこのリクエストだけフォールバックにし、次のリクエストで再度生成を試みる
        try {
          const cached = await deps.storage.getOgpImage(id, page.version)
          if (cached !== null) return pngResponse(cached)

          const failed = await deps.storage.getOgpFailureMarker(id, page.version)
          if (failed) return fallbackResponse(c.env, c.req.url)
        } catch (error) {
          deps.logger.warn('ogp_cache_read_failed', { pageId: id, error })
          return fallbackResponse(c.env, c.req.url)
        }

        try {
          const png = await deps.ogpRenderer.render(toOgpInput(page, deps.config.serviceName))
          c.executionCtx.waitUntil(
            deps.storage.putOgpImage(id, page.version, png).catch((error) => {
              deps.logger.warn('ogp_store_failed', { pageId: id, error })
            }),
          )
          return pngResponse(png)
        } catch (error) {
          // Logger 側で { name, message } に正規化する（§9.6）
          deps.logger.warn('ogp_render_failed', { pageId: id, error })
          c.executionCtx.waitUntil(
            deps.storage
              .putOgpFailureMarker(id, page.version, OGP_FAILURE_CACHE_SECONDS)
              .catch((error) => {
                deps.logger.warn('ogp_store_failed', { pageId: id, error })
              }),
          )
          return fallbackResponse(c.env, c.req.url)
        }
      },
      { keepQuery: true },
    )
  })

  return app
}
