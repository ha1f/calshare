import { generateCookie } from 'hono/cookie'
import { parse } from 'hono/utils/cookie'
import { DEVICE_COOKIE_MAX_AGE_SECONDS, DEVICE_COOKIE_NAME } from '../../core/config/limits'

/** device_id は crypto.randomUUID() が返す形式のみ受理する（§9.3） */
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * リクエストの Cookie ヘッダから device_id を取り出す（§9.3 の cs_device）。
 * bucket_key や creator_device_id にそのまま入るため、UUID 形式でなければ null にする。
 */
export function readDeviceId(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null

  const value = parse(header, DEVICE_COOKIE_NAME)[DEVICE_COOKIE_NAME]
  return value !== undefined && DEVICE_ID_PATTERN.test(value) ? value : null
}

/** POST /api/pages が Cookie 無しで来たときに発行する Set-Cookie 値（§9.3） */
export function buildDeviceCookie(deviceId: string): string {
  return generateCookie(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  })
}
