import { afterEach, describe, expect, it, vi } from 'vitest'
import { addHistoryEntry, readHistory, updateHistoryEntry } from '../../../../src/web/lib/history'
import type { HistoryEntry } from '../../../../src/web/lib/history'

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
    key: () => null,
    get length() {
      return store.size
    },
  }
}

const ENTRY_A: HistoryEntry = {
  id: '0123456789ab',
  url: 'https://example.test/0123456789ab',
  editToken: 'token-a',
  fields: {
    title: '飲み会',
    location: '渋谷',
    memo: null,
    start: '2026-09-20T10:00:00.000Z',
    end: '2026-09-20T11:00:00.000Z',
    isAllDay: false,
  },
  expiresAt: '2026-09-27T00:00:00.000Z',
  createdAt: '2026-09-16T01:00:00.000Z',
  updatedAt: '2026-09-16T01:00:00.000Z',
}

const ENTRY_B: HistoryEntry = {
  ...ENTRY_A,
  id: 'ba9876543210',
  url: 'https://example.test/ba9876543210',
  editToken: 'token-b',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('updateHistoryEntry', () => {
  it('fields / expiresAt / updatedAt だけ上書きし、並び順・他の項目は変えない', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    addHistoryEntry(ENTRY_B)
    addHistoryEntry(ENTRY_A)

    updateHistoryEntry(ENTRY_B.id, {
      fields: { ...ENTRY_B.fields, location: '新宿' },
      expiresAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    })

    const entries = readHistory()
    expect(entries.map((e) => e.id)).toEqual([ENTRY_A.id, ENTRY_B.id])

    const updated = entries.find((e) => e.id === ENTRY_B.id)
    expect(updated?.fields.location).toBe('新宿')
    expect(updated?.expiresAt).toBe('2026-10-01T00:00:00.000Z')
    expect(updated?.updatedAt).toBe('2026-09-21T00:00:00.000Z')
    expect(updated?.url).toBe(ENTRY_B.url)
    expect(updated?.editToken).toBe(ENTRY_B.editToken)
    expect(updated?.createdAt).toBe(ENTRY_B.createdAt)
  })

  it('該当 id が無ければ何もしない', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    addHistoryEntry(ENTRY_A)

    updateHistoryEntry('unknown0000', {
      fields: ENTRY_A.fields,
      expiresAt: ENTRY_A.expiresAt,
      updatedAt: '2026-09-21T00:00:00.000Z',
    })

    expect(readHistory()).toEqual([ENTRY_A])
  })

  it('localStorage が使えない環境でも例外にならない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })

    expect(() =>
      updateHistoryEntry(ENTRY_A.id, {
        fields: ENTRY_A.fields,
        expiresAt: ENTRY_A.expiresAt,
        updatedAt: ENTRY_A.updatedAt,
      }),
    ).not.toThrow()
  })
})
