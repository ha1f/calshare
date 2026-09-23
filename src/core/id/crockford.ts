import { PAGE_ID_LENGTH } from '../config/limits'

/** Crockford Base32 の小文字。`i` `l` `o` `u` を除く 32 文字（§4.2） */
export const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

export const PAGE_ID_PATTERN = `[0-9a-hjkmnp-tv-z]{${PAGE_ID_LENGTH}}`

const PAGE_ID_REGEXP = new RegExp(`^${PAGE_ID_PATTERN}$`)

/** ページ ID の形式検証。サーバの全 `:id` ルートとクライアント（/done /edit /history）の入口で共通に使う */
export function isValidPageId(s: string): boolean {
  return PAGE_ID_REGEXP.test(s)
}

/**
 * ランダムバイト列を Crockford Base32 の文字列に写像する。
 * 256 は 32 で割り切れるため `% 32` に modulo bias が無く、rejection sampling は要らない（§4.2）
 */
export function encodeCrockford(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) {
    result += CROCKFORD_ALPHABET[byte % 32]
  }
  return result
}
