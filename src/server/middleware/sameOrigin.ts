import { requireDefined } from '../../core/assert'
import { apiRequestError } from '../lib/errors'

/**
 * 状態変更 API の入口検査（§5.7 の (1)、§9.8）。
 * Content-Type が `application/json` でなければ 415、CSRF 対策として同一オリジンでなければ 403 を投げる。
 * `Sec-Fetch-Site` があればそれだけで判定し、無ければ `Origin` を `publicOrigin` と比較する。
 * 両方無い（古いクライアント）場合は通す
 */
export function assertSameOriginJsonRequest(request: Request, publicOrigin: string): void {
  const contentType = request.headers.get('Content-Type') ?? ''
  const mediaType = requireDefined(
    contentType.split(';')[0],
    'split always returns at least one element',
  )
    .trim()
    .toLowerCase()
  if (mediaType !== 'application/json') {
    throw apiRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }

  const secFetchSite = request.headers.get('Sec-Fetch-Site')
  if (secFetchSite !== null) {
    if (secFetchSite !== 'same-origin') {
      throw apiRequestError(403, 'FORBIDDEN_ORIGIN', 'cross-site request')
    }
    return
  }

  const origin = request.headers.get('Origin')
  if (origin !== null && origin !== publicOrigin) {
    throw apiRequestError(403, 'FORBIDDEN_ORIGIN', 'request origin is not allowed')
  }
}
