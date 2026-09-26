import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addHistoryEntry,
  findHistoryEntry,
  type HistoryEntry,
} from '../../../../src/web/lib/history'

function fakeLocalStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

const baseEntry: HistoryEntry = {
  id: '0123456789ab',
  url: 'https://example.com/0123456789ab',
  editToken: 'token',
  fields: {
    title: '飲み会',
    location: null,
    memo: null,
    start: null,
    end: null,
    isAllDay: false,
  },
  expiresAt: '2026-09-27T00:00:00.000Z',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('findHistoryEntry', () => {
  it('保存した id で見つかる', () => {
    addHistoryEntry(baseEntry)

    expect(findHistoryEntry(baseEntry.id)).toEqual(baseEntry)
  })

  it('無い id は null', () => {
    expect(findHistoryEntry('zzzzzzzzzzzz')).toBeNull()
  })

  it('同じ id を追加すると新しい内容に入れ替わる', () => {
    addHistoryEntry(baseEntry)
    const updated: HistoryEntry = { ...baseEntry, updatedAt: '2026-09-21T00:00:00.000Z' }
    addHistoryEntry(updated)

    expect(findHistoryEntry(baseEntry.id)).toEqual(updated)
  })
})
