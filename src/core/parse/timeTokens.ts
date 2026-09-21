import { PM_HEURISTIC_MAX_HOUR } from '../config/limits'
import type { ParseIssue } from './types'

type Prefix = '午前' | '午後' | '朝' | '夜' | '夕方'
const PM_LIKE_PREFIXES: Prefix[] = ['午後', '夜', '夕方']

function timeAtomSource(
  prefixName: string,
  hourName: string,
  colonMinName: string,
  kanjiMinName: string,
  halfName: string,
): string {
  return String.raw`(?:(?<${prefixName}>午前|午後|朝|夜|夕方))?(?<${hourName}>\d{1,2})(?::(?<${colonMinName}>\d{2})|時(?:(?<${kanjiMinName}>\d{1,2})分|(?<${halfName}>半))?)`
}

const START_ATOM = timeAtomSource('sPrefix', 'sHour', 'sColonMin', 'sKanjiMin', 'sHalf')
const END_ATOM = timeAtomSource('ePrefix', 'eHour', 'eColonMin', 'eKanjiMin', 'eHalf')
// 開始のみ（H〜 / Hから）にも一致するよう、終了側の時刻表現とまでは丸ごと省略可能にする
const TIME_RE = new RegExp(`${START_ATOM}(?:(?:〜|から)(?:${END_ATOM})?(?:まで)?)?`)

interface AtomValue {
  isColon: boolean
  prefix: Prefix | null
  hour: number
  minute: number
}

function readAtom(
  groups: Record<string, string | undefined>,
  prefixName: string,
  hourName: string,
  colonMinName: string,
  kanjiMinName: string,
  halfName: string,
): AtomValue | null {
  const hourStr = groups[hourName]
  if (hourStr === undefined) return null
  const isColon = groups[colonMinName] !== undefined
  const minute = isColon
    ? Number(groups[colonMinName])
    : groups[halfName] !== undefined
      ? 30
      : groups[kanjiMinName] !== undefined
        ? Number(groups[kanjiMinName])
        : 0
  return {
    isColon,
    prefix: (groups[prefixName] as Prefix | undefined) ?? null,
    hour: Number(hourStr),
    minute,
  }
}

function isValidHourMinute(hour: number, minute: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

/**
 * 午前・午後系の語を時に反映する（リテラル）。語が無ければ呼び出し側で規則 T2 のヒューリスティックを適用する
 */
function applyPrefix(hour: number, prefix: Prefix): number {
  if (PM_LIKE_PREFIXES.includes(prefix)) return hour === 12 ? 12 : hour + 12
  return hour // 午前・朝はリテラル
}

/** 開始時刻を解決する（規則 T2）。`H:MM` はリテラルのまま */
function resolveStartHour(atom: AtomValue): number {
  if (atom.isColon) return atom.hour
  if (atom.prefix !== null) return applyPrefix(atom.hour, atom.prefix)
  if (atom.hour >= 1 && atom.hour <= PM_HEURISTIC_MAX_HOUR) return atom.hour + 12
  return atom.hour
}

export interface TimeResolution {
  index: number
  length: number
  /** 不正な時刻（規則 T6）ならトークンを消費しない */
  consumed: boolean
  issues: ParseIssue[]
  start: { hour: number; minute: number }
  /** 範囲指定があるときだけ非 null */
  end: { hour: number; minute: number; nextDay: boolean } | null
}

/** 終了時刻を解決する（規則 T3）。startTotalMinutes は解決済みの開始時刻（分換算） */
function resolveEnd(
  atom: AtomValue,
  startTotalMinutes: number,
): { hour: number; minute: number; nextDay: boolean } {
  if (atom.isColon || atom.prefix !== null) {
    const hour = atom.isColon ? atom.hour : applyPrefix(atom.hour, atom.prefix as Prefix)
    const total = hour * 60 + atom.minute
    return { hour, minute: atom.minute, nextDay: total <= startTotalMinutes }
  }
  // 素の「H時」表記: 候補 {E, E+12}（24 時未満）のうち開始より後になる最小の候補を採る（規則 T3(2)）
  const candidates = [atom.hour, atom.hour + 12].filter((h) => h < 24)
  const chosen = candidates
    .map((h) => ({ h, total: h * 60 + atom.minute }))
    .filter((c) => c.total > startTotalMinutes)
    .sort((a, b) => a.total - b.total)[0]
  if (chosen !== undefined) return { hour: chosen.h, minute: atom.minute, nextDay: false }
  // 候補が無い（終了 ≤ 開始）なら E のまま翌日にする（規則 T3(3)）
  return { hour: atom.hour, minute: atom.minute, nextDay: true }
}

/** 1 行目から最初の時刻トークン（単発・範囲・開始のみ）を検出して解決する（§5.2 手順 5） */
export function detectTimeToken(text: string): TimeResolution | null {
  const match = TIME_RE.exec(text)
  if (match === null) return null
  const groups = match.groups ?? {}

  const startAtom = readAtom(groups, 'sPrefix', 'sHour', 'sColonMin', 'sKanjiMin', 'sHalf')
  if (startAtom === null) return null
  if (!isValidHourMinute(startAtom.hour, startAtom.minute)) {
    return {
      index: match.index,
      length: match[0].length,
      consumed: false,
      issues: [],
      start: { hour: 0, minute: 0 },
      end: null,
    }
  }

  const startHour = resolveStartHour(startAtom)
  const endAtom = readAtom(groups, 'ePrefix', 'eHour', 'eColonMin', 'eKanjiMin', 'eHalf')
  if (endAtom === null) {
    return {
      index: match.index,
      length: match[0].length,
      consumed: true,
      issues: [],
      start: { hour: startHour, minute: startAtom.minute },
      end: null,
    }
  }
  if (!isValidHourMinute(endAtom.hour, endAtom.minute)) {
    return {
      index: match.index,
      length: match[0].length,
      consumed: false,
      issues: [],
      start: { hour: 0, minute: 0 },
      end: null,
    }
  }

  const end = resolveEnd(endAtom, startHour * 60 + startAtom.minute)
  return {
    index: match.index,
    length: match[0].length,
    consumed: true,
    issues: [],
    start: { hour: startHour, minute: startAtom.minute },
    end,
  }
}
