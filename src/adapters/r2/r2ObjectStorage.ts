import type { Clock } from '../../ports/clock'
import type { ObjectStorage } from '../../ports/objectStorage'

function icsKey(pageId: string): string {
  return `ics/${pageId}.ics`
}
function ogpImageKey(pageId: string, version: number): string {
  return `ogp/${pageId}/${version}.png`
}
function ogpFailureKey(pageId: string, version: number): string {
  return `ogp/${pageId}/${version}.failed`
}
function ogpPrefix(pageId: string): string {
  return `ogp/${pageId}/`
}

/** 失敗マーカーの本文。R2 に TTL は無いので有効期限を自分で持つ（§2.5） */
interface FailureMarkerBody {
  expiresAt: number
}

/** すべての R2 オブジェクトキーを列挙する（deleteAllForPage の削除対象。1000 件ずつページングする） */
async function listAllKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix, cursor })
    keys.push(...page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
  return keys
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
      const body: FailureMarkerBody = { expiresAt: clock.now().getTime() + ttlSeconds * 1000 }
      await bucket.put(ogpFailureKey(pageId, version), JSON.stringify(body))
    },
    getOgpFailureMarker: async (pageId, version) => {
      const object = await bucket.get(ogpFailureKey(pageId, version))
      if (!object) return false
      const body = (await object.json()) as FailureMarkerBody
      return clock.now().getTime() < body.expiresAt
    },
    getFont: async (key) => {
      const object = await bucket.get(key)
      return object ? object.arrayBuffer() : null
    },
    deleteAllForPage: async (pageId) => {
      const keys = [icsKey(pageId), ...(await listAllKeys(bucket, ogpPrefix(pageId)))]
      await bucket.delete(keys)
    },
  }
}
