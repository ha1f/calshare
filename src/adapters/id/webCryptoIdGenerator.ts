import { PAGE_ID_LENGTH } from '../../core/config/limits'
import { encodeCrockford } from '../../core/id/crockford'
import type { IdGenerator } from '../../ports/idGenerator'

const EDIT_TOKEN_BYTES = 32

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Web Crypto（`crypto.getRandomValues` / `crypto.randomUUID`）を使う本番用の ID 生成器（§4.2） */
export function createWebCryptoIdGenerator(): IdGenerator {
  return {
    generatePageId: () => encodeCrockford(crypto.getRandomValues(new Uint8Array(PAGE_ID_LENGTH))),
    generateEditToken: () => toBase64Url(crypto.getRandomValues(new Uint8Array(EDIT_TOKEN_BYTES))),
    generateUuid: () => crypto.randomUUID(),
  }
}
