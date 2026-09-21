import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createMemoryObjectStorage } from '../../../src/adapters/memory/memoryObjectStorage'
import { createR2ObjectStorage } from '../../../src/adapters/r2/r2ObjectStorage'
import type { ObjectStorage } from '../../../src/ports/objectStorage'

const NOW = new Date('2026-09-16T01:00:00.000Z')

interface Fixture {
  storage: ObjectStorage
  clock: ReturnType<typeof fakeClock>
  seedFont(key: string, data: ArrayBuffer): Promise<void>
}

function createR2Fixture(): Fixture {
  const clock = fakeClock(NOW)
  return {
    storage: createR2ObjectStorage(env.BUCKET, clock),
    clock,
    seedFont: async (key, data) => {
      await env.BUCKET.put(key, data)
    },
  }
}

function createMemoryFixture(): Fixture {
  const clock = fakeClock(NOW)
  const storage = createMemoryObjectStorage(clock)
  return {
    storage,
    clock,
    seedFont: async (key, data) => storage.seedFont(key, data),
  }
}

describe.each([
  ['R2', createR2Fixture],
  ['memory', createMemoryFixture],
] as const)('%s ObjectStorage', (_name, createFixture) => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  it('putIcs → getIcs で同じ内容が返り、上書きもできる（ics/{id}.ics）', async () => {
    await fixture.storage.putIcs('page-1', 'BEGIN:VCALENDAR...v1')
    expect(await fixture.storage.getIcs('page-1')).toBe('BEGIN:VCALENDAR...v1')

    await fixture.storage.putIcs('page-1', 'BEGIN:VCALENDAR...v2')
    expect(await fixture.storage.getIcs('page-1')).toBe('BEGIN:VCALENDAR...v2')
  })

  it('ics が無ければ null', async () => {
    expect(await fixture.storage.getIcs('missing')).toBeNull()
  })

  it('putOgpImage → getOgpImage で同じバイト列が返る', async () => {
    const png = new Uint8Array([1, 2, 3, 4])
    await fixture.storage.putOgpImage('page-1', 1, png)

    expect(await fixture.storage.getOgpImage('page-1', 1)).toEqual(png)
  })

  it('ogp 画像が無ければ null。version が違えば別物として扱う', async () => {
    expect(await fixture.storage.getOgpImage('missing', 1)).toBeNull()

    await fixture.storage.putOgpImage('page-1', 1, new Uint8Array([1]))
    expect(await fixture.storage.getOgpImage('page-1', 2)).toBeNull()
  })

  describe('失敗マーカー', () => {
    it('置いた直後は true、TTL 経過後は false になる', async () => {
      await fixture.storage.putOgpFailureMarker('page-1', 1, 300)
      expect(await fixture.storage.getOgpFailureMarker('page-1', 1)).toBe(true)

      fixture.clock.set(new Date(NOW.getTime() + 301 * 1000))
      expect(await fixture.storage.getOgpFailureMarker('page-1', 1)).toBe(false)
    })

    it('TTL 経過前なら true のまま', async () => {
      await fixture.storage.putOgpFailureMarker('page-1', 1, 300)
      fixture.clock.set(new Date(NOW.getTime() + 299 * 1000))

      expect(await fixture.storage.getOgpFailureMarker('page-1', 1)).toBe(true)
    })

    it('置いていなければ false', async () => {
      expect(await fixture.storage.getOgpFailureMarker('missing', 1)).toBe(false)
    })
  })

  it('deleteAllForPage は ics と ogp/{pageId}/ 配下だけを消し、他ページには影響しない', async () => {
    await fixture.storage.putIcs('page-1', 'ics-1')
    await fixture.storage.putOgpImage('page-1', 1, new Uint8Array([1]))
    await fixture.storage.putOgpFailureMarker('page-1', 1, 300)
    await fixture.storage.putIcs('page-2', 'ics-2')
    await fixture.storage.putOgpImage('page-2', 1, new Uint8Array([2]))

    await fixture.storage.deleteAllForPage('page-1')

    expect(await fixture.storage.getIcs('page-1')).toBeNull()
    expect(await fixture.storage.getOgpImage('page-1', 1)).toBeNull()
    expect(await fixture.storage.getOgpFailureMarker('page-1', 1)).toBe(false)
    expect(await fixture.storage.getIcs('page-2')).toBe('ics-2')
    expect(await fixture.storage.getOgpImage('page-2', 1)).toEqual(new Uint8Array([2]))
  })

  it('deleteAllForPage は対象が何も無くても失敗しない', async () => {
    await expect(fixture.storage.deleteAllForPage('missing')).resolves.toBeUndefined()
  })

  it('getFont はキーそのままで取得できる。無ければ null', async () => {
    const data = new TextEncoder().encode('font-bytes').buffer as ArrayBuffer
    await fixture.seedFont('fonts/NotoSansJP-Regular.subset.otf', data)

    const found = await fixture.storage.getFont('fonts/NotoSansJP-Regular.subset.otf')
    expect(found).not.toBeNull()
    expect(new Uint8Array(found as ArrayBuffer)).toEqual(new Uint8Array(data))
    expect(await fixture.storage.getFont('fonts/missing.otf')).toBeNull()
  })
})
