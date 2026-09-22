import { icsKey, ogpFailureKey, ogpImageKey, ogpPrefix } from '../r2/r2ObjectStorage'
import type { Clock } from '../../ports/clock'
import type { ObjectStorage } from '../../ports/objectStorage'

interface FailureMarker {
  expiresAt: number
}

/**
 * R2 実装（r2ObjectStorage）と同じキー設計（§2.5）のインメモリ実装。結合テストは両方に同じスイートを流す。
 * `seedFont` はテストが getFont の対象を用意するための拡張で、ObjectStorage には無い。
 */
export function createMemoryObjectStorage(
  clock: Clock,
): ObjectStorage & { seedFont(key: string, data: ArrayBuffer): void } {
  const texts = new Map<string, string>()
  const images = new Map<string, Uint8Array>()
  const failures = new Map<string, FailureMarker>()
  const fonts = new Map<string, ArrayBuffer>()

  return {
    seedFont: (key, data) => {
      fonts.set(key, data.slice(0))
    },
    putIcs: async (pageId, body) => {
      texts.set(icsKey(pageId), body)
    },
    getIcs: async (pageId) => texts.get(icsKey(pageId)) ?? null,
    putOgpImage: async (pageId, version, png) => {
      images.set(ogpImageKey(pageId, version), png.slice())
    },
    getOgpImage: async (pageId, version) =>
      images.get(ogpImageKey(pageId, version))?.slice() ?? null,
    putOgpFailureMarker: async (pageId, version, ttlSeconds) => {
      failures.set(ogpFailureKey(pageId, version), {
        expiresAt: clock.now().getTime() + ttlSeconds * 1000,
      })
    },
    getOgpFailureMarker: async (pageId, version) => {
      const marker = failures.get(ogpFailureKey(pageId, version))
      if (!marker) return false
      return clock.now().getTime() < marker.expiresAt
    },
    getFont: async (key) => fonts.get(key)?.slice(0) ?? null,
    deleteAllForPage: async (pageId) => {
      texts.delete(icsKey(pageId))
      const prefix = ogpPrefix(pageId)
      for (const key of images.keys()) if (key.startsWith(prefix)) images.delete(key)
      for (const key of failures.keys()) if (key.startsWith(prefix)) failures.delete(key)
    },
  }
}
