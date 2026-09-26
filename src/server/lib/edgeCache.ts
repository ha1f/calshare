import type { ExecutionContext } from 'hono'

export interface EdgeCacheOptions {
  /** OGP 画像だけ `?v=` をキャッシュキーに残す（§2.4） */
  keepQuery?: boolean
}

/**
 * Cache API でレスポンスをキャッシュする（§2.4）。クエリ文字列を落としてからキーにすることで、
 * `/:id?x=1` `?x=2` ... の無限のバリエーションで D1 / R2 を直叩きされるのを防ぐ。
 * 編集・非表示後は最大 `maxAgeSeconds` 秒の古さを許容する（`cache.delete()` はローカル colo にしか
 * 効かないため頼らない）。
 * `request` はパスがデコード済みの正規形であることを呼び出し側が保証する。ルートパラメータをそのまま
 * URL に含む生の `request.url` を渡すと、`%XX` の表記違い（ハンドラでは同じ値に一致する）で無限にキーが
 * 割れてしまう
 */
export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  maxAgeSeconds: number,
  produce: () => Promise<Response>,
  options?: EdgeCacheOptions,
): Promise<Response> {
  const cache = caches.default
  const url = new URL(request.url)
  if (!options?.keepQuery) url.search = ''
  const key = new Request(url.toString(), { method: 'GET' })

  const hit = await cache.match(key)
  if (hit) return hit

  const res = await produce()
  if (res.ok) {
    res.headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}`)
    ctx.waitUntil(cache.put(key, res.clone()))
  }
  return res
}
