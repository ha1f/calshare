import { RATE_LIMITS } from '../../core/config/limits'
import { readDeviceId } from '../lib/deviceCookie'
import { apiRequestError } from '../lib/errors'
import { ipHash } from '../lib/ipHash'
import type { RateLimitRule } from '../../ports/rateLimiter'
import type { Deps } from '../deps'

export interface RequestIdentity {
  ipHash: string
  deviceId: string
  /** Cookie が無く、このリクエストのために新しく発行した device_id かどうか */
  isNewDevice: boolean
}

/**
 * リクエストから ip_hash と device_id を求める（§9.3）。`cs_device` Cookie が無ければ
 * `deps.ids.generateUuid()` で新しい device_id を発行する（発行した ID は呼び出し側が Set-Cookie で返す）
 */
export async function resolveRequestIdentity(
  request: Request,
  deps: Deps,
): Promise<RequestIdentity> {
  const rawIp = request.headers.get('CF-Connecting-IP')
  if (!rawIp && new URL(deps.config.publicOrigin).hostname !== 'localhost') {
    deps.logger.warn('ip_unknown', {})
  }
  const hash = await ipHash(rawIp, deps.config.ratePepper)

  const existingDeviceId = readDeviceId(request)
  if (existingDeviceId !== null) {
    return { ipHash: hash, deviceId: existingDeviceId, isNewDevice: false }
  }
  return { ipHash: hash, deviceId: deps.ids.generateUuid(), isNewDevice: true }
}

/**
 * `create` スコープのレート制限を消費する（§9.3）。IP・device のいずれかが上限に達していれば
 * カウンタを進めずに 429 `RATE_LIMITED` を投げる
 */
export async function consumeCreateRateLimit(
  deps: Deps,
  identity: RequestIdentity,
  now: Date,
): Promise<void> {
  const rules: RateLimitRule[] = [
    {
      scope: 'create',
      bucketKey: `ip:${identity.ipHash}`,
      window: 'hour',
      limit: RATE_LIMITS.create.ipPerHour,
    },
    {
      scope: 'create',
      bucketKey: `ip:${identity.ipHash}`,
      window: 'day',
      limit: RATE_LIMITS.create.ipPerDay,
    },
    {
      scope: 'create',
      bucketKey: `device:${identity.deviceId}`,
      window: 'day',
      limit: RATE_LIMITS.create.devicePerDay,
    },
  ]
  const result = await deps.rateLimiter.consume(rules, now)
  if (!result.allowed) {
    deps.logger.warn('rate_limited', {
      scope: 'create',
      exceeded: result.exceeded.map((rule) => ({
        bucket: rule.bucketKey.split(':')[0],
        window: rule.window,
      })),
    })
    throw apiRequestError(429, 'RATE_LIMITED', 'rate limit exceeded')
  }
}
