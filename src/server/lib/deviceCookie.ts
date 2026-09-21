import { generateCookie } from 'hono/cookie'
import { DEVICE_COOKIE_MAX_AGE_SECONDS, DEVICE_COOKIE_NAME } from '../../core/config/limits'

/** リクエストの Cookie ヘッダから device_id を取り出す。無ければ null（§9.3 の cs_device） */
export function readDeviceId(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null

  for (const pair of header.split(';')) {
    const separatorAt = pair.indexOf('=')
    if (separatorAt === -1) continue
    if (pair.slice(0, separatorAt).trim() !== DEVICE_COOKIE_NAME) continue

    const rawValue = pair.slice(separatorAt + 1).trim()
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
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
