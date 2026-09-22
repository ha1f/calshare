import { IPV6_BUCKET_PREFIX_BITS } from '../../core/config/limits'

const IP_HASH_HEX_LENGTH = 32
const IPV6_GROUP_COUNT = 8
const IPV6_GROUP_BITS = 16

/**
 * CF-Connecting-IP の値から HMAC-SHA256（hex 先頭 32 文字）の決定的なハッシュを作る（§9.3）。
 * 生 IP は保存もログもしないため、この戻り値だけが creator_ip_hash やレート制限のバケットキーに使われる。
 * IP が取れないとき（wrangler dev・CI）や空白のみのときは 'unknown' を返す。
 */
export async function ipHash(rawIp: string | null, pepper: string): Promise<string> {
  const ip = rawIp?.trim()
  if (!ip) return 'unknown'

  const normalized = normalizeIp(ip)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalized))
  return toHex(signature).slice(0, IP_HASH_HEX_LENGTH)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** IPv4 はそのまま、IPv4-mapped IPv6 は元の IPv4 として、それ以外の IPv6 は /64 プレフィックスに丸める */
function normalizeIp(ip: string): string {
  const groups = expandIpv6(ip)
  if (groups === null) return ip // IPv4 または解釈できない形式はそのまま使う

  const mappedIpv4 = toIpv4IfMapped(groups)
  if (mappedIpv4 !== null) return mappedIpv4

  return groups.slice(0, IPV6_BUCKET_PREFIX_BITS / IPV6_GROUP_BITS).join(':')
}

/** IPv6 アドレスを 8 グループの 16 進文字列に展開する。IPv6 に見えなければ null */
function expandIpv6(ip: string): string[] | null {
  const withoutZoneId = ip.split('%')[0]
  if (!withoutZoneId.includes(':')) return null

  const withHextetSuffix = embedTrailingIpv4(withoutZoneId)
  if (withHextetSuffix === null) return null

  const compressedAt = withHextetSuffix.indexOf('::')
  if (compressedAt === -1) {
    const allGroups = withHextetSuffix.split(':')
    return allGroups.length === IPV6_GROUP_COUNT ? allGroups.map(normalizeHextet) : null
  }

  const head = withHextetSuffix.slice(0, compressedAt)
  const tail = withHextetSuffix.slice(compressedAt + 2)
  const headGroups = head === '' ? [] : head.split(':')
  const tailGroups = tail === '' ? [] : tail.split(':')
  const missing = IPV6_GROUP_COUNT - headGroups.length - tailGroups.length
  if (missing < 0) return null

  return [...headGroups, ...Array(missing).fill('0'), ...tailGroups].map(normalizeHextet)
}

function normalizeHextet(group: string): string {
  return group.toLowerCase().replace(/^0+(?=.)/, '')
}

/**
 * 末尾の a.b.c.d（IPv4-mapped の表記）を 2 つの 16 進グループに変換する。含まなければ入力をそのまま返す。
 * オクテットが 0〜255 の整数でなければ null を返す。
 */
function embedTrailingIpv4(ip: string): string | null {
  const lastColon = ip.lastIndexOf(':')
  const lastSegment = ip.slice(lastColon + 1)
  if (!lastSegment.includes('.')) return ip

  const octets = lastSegment.split('.').map(Number)
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255))
    return null

  const high = ((octets[0] << 8) | octets[1]).toString(16)
  const low = ((octets[2] << 8) | octets[3]).toString(16)
  return `${ip.slice(0, lastColon)}:${high}:${low}`
}

/** ::ffff:0:0/96 の IPv4-mapped アドレスなら元の IPv4 表記を返す。それ以外は null */
function toIpv4IfMapped(groups: string[]): string | null {
  const isMapped = groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff'
  if (!isMapped) return null

  const high = parseInt(groups[6], 16)
  const low = parseInt(groups[7], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}
