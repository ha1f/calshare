import { isValidPageId } from '../../core/id/crockford'
import type { EventFieldsJson } from '../../core/types'

const STORAGE_KEY = 'calshare.history'

/** 作成履歴の 1 件（§6.4）。完成画面の Google カレンダーリンクを組むのに fields が要る */
export interface HistoryEntry {
  id: string
  url: string
  editToken: string
  fields: EventFieldsJson
  expiresAt: string
  createdAt: string
  updatedAt: string
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    isValidPageId(v.id) &&
    typeof v.url === 'string' &&
    typeof v.editToken === 'string' &&
    typeof v.fields === 'object' &&
    v.fields !== null &&
    typeof v.expiresAt === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.updatedAt === 'string'
  )
}

/** localStorage が使えない環境（プライベートモード等）でも例外で画面を壊さないための読み取り */
function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isHistoryEntry)
  } catch {
    return []
  }
}

/** 新しい順に保存する。同じ id の既存項目は入れ替える（編集完了時の更新にも使う想定） */
export function addHistoryEntry(entry: HistoryEntry): void {
  const rest = readHistory().filter((e) => e.id !== entry.id)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...rest]))
  } catch {
    // 書き込めない環境では履歴を諦める。作成自体は成功しているので画面遷移は続ける
  }
}
