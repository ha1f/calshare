import type { Clock } from '../../ports/clock'
import type { ObjectStorage } from '../../ports/objectStorage'

/** memoryObjectStorage もこのキー関数を import して使う（R2 実装と同じキー設計で検証するため） */
export function icsKey(pageId: string): string {
  return `ics/${pageId}.ics`
}
export function ogpImageKey(pageId: string, version: number): string {
  return `ogp/${pageId}/${version}.png`
}
export function ogpFailureKey(pageId: string, version: number): string {
  return `ogp/${pageId}/${version}.failed`
}
export function ogpPrefix(pageId: string): string {
  return `ogp/${pageId}/`
}

/** 有効期限を示すキー（R2 の customMetadata に持たせる。§2.5） */
const EXPIRES_AT_METADATA_KEY = 'expiresAt'

/** prefix に一致するキーをすべて削除する。R2 の delete は 1 回最大 1000 キーなので list の 1 ページずつ消す */
async function deleteAllWithPrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  do {
    const page = await bucket.list(cursor === undefined ? { prefix } : { prefix, cursor })
    if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
}

export function createR2ObjectStorage(bucket: R2Bucket, clock: Clock): ObjectStorage {
  return {
    putIcs: async (pageId, body) => {
      await bucket.put(icsKey(pageId), body)
    },
    getIcs: async (pageId) => {
      const object = await bucket.get(icsKey(pageId))
      return object ? object.text() : null
    },
    putOgpImage: async (pageId, version, png) => {
      await bucket.put(ogpImageKey(pageId, version), png)
    },
    getOgpImage: async (pageId, version) => {
      const object = await bucket.get(ogpImageKey(pageId, version))
      return object ? object.bytes() : null
    },
    putOgpFailureMarker: async (pageId, version, ttlSeconds) => {
      const expiresAt = clock.now().getTime() + ttlSeconds * 1000
      // 本文は使わず customMetadata に有効期限を持たせる。get の代わりに head で済み、本文の破損にも影響されない
      await bucket.put(ogpFailureKey(pageId, version), '', {
        customMetadata: { [EXPIRES_AT_METADATA_KEY]: String(expiresAt) },
      })
    },
    getOgpFailureMarker: async (pageId, version) => {
      const object = await bucket.head(ogpFailureKey(pageId, version))
      if (!object) return false
      const expiresAt = Number(object.customMetadata?.[EXPIRES_AT_METADATA_KEY])
      return Number.isFinite(expiresAt) && clock.now().getTime() < expiresAt
    },
    getFont: async (key) => {
      const object = await bucket.get(key)
      return object ? object.arrayBuffer() : null
    },
    deleteAllForPage: async (pageId) => {
      await bucket.delete(icsKey(pageId))
      await deleteAllWithPrefix(bucket, ogpPrefix(pageId))
    },
  }
}
