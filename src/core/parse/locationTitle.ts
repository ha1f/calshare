import { isLocationStopPhrase } from './stopWords'

const BOUNDARY_RE = /[\s、]/

/** text[i] が「直前の空白・読点、または先頭」から続くまとまりのどこに属すかを、まとまりの開始位置で表す */
function computeChunkStarts(text: string): number[] {
  const starts = new Array<number>(text.length)
  let currentStart = 0
  for (let i = 0; i < text.length; i++) {
    if (BOUNDARY_RE.test(text[i])) currentStart = i + 1
    starts[i] = currentStart
  }
  return starts
}

interface LocationFound {
  location: string
  beforeText: string
  afterText: string
}

/** 「で」「にて」の直前のひとまとまりを場所候補として探す（§5.5 規則 L1・L2） */
function findLocation(text: string): LocationFound | null {
  const chunkStarts = computeChunkStarts(text)
  const separatorRe = /にて|で/g
  for (let match = separatorRe.exec(text); match !== null; match = separatorRe.exec(text)) {
    const sepStart = match.index
    const sepText = match[0]
    const nextChar = text[sepStart + sepText.length]
    if (sepText === 'で' && nextChar === 'も') continue // 「でも」は区切りにしない（規則 L1）

    const chunkStart = chunkStarts[sepStart]
    const candidate = text.slice(chunkStart, sepStart)
    if (candidate.length === 0) continue
    if (sepText === 'で' && isLocationStopPhrase(candidate + 'で')) continue // 規則 L2

    return {
      location: candidate,
      beforeText: text.slice(0, chunkStart),
      afterText: text.slice(sepStart + sepText.length),
    }
  }
  return null
}

export interface TitleLocationSplit {
  /** 何も残らなければ空文字。呼び出し側が規則 T-c を適用する */
  title: string
  location: string | null
  /** 1 行目由来のメモ（trim 済み）。無ければ null */
  memo: string | null
  singleTokenTitle: boolean
}

/** 日付・時刻トークンを取り除いた残り文字列から、場所・タイトル・メモを分ける（§5.5 規則 L・T） */
export function splitTitleLocationMemo(remaining: string): TitleLocationSplit {
  const found = findLocation(remaining)
  if (found !== null) {
    const after = found.afterText.replace(/^[\s、]+/, '')
    const breakIndex = after.search(BOUNDARY_RE)
    const title = breakIndex === -1 ? after : after.slice(0, breakIndex)
    const memoFromAfter = breakIndex === -1 ? '' : after.slice(breakIndex).replace(/^[\s、]+/, '')
    const before = found.beforeText.trim()
    const memo = [before, memoFromAfter].filter((s) => s.length > 0).join('\n')
    return {
      title: title.trim(),
      location: found.location,
      memo: memo.length > 0 ? memo : null,
      singleTokenTitle: false,
    }
  }

  const trimmed = remaining.trim()
  const commaIndex = trimmed.indexOf('、')
  if (commaIndex !== -1) {
    const title = trimmed.slice(0, commaIndex).trim()
    const memo = trimmed.slice(commaIndex + 1).trim()
    return { title, location: null, memo: memo.length > 0 ? memo : null, singleTokenTitle: false }
  }

  const singleTokenTitle = trimmed.length > 0 && !/\s/.test(trimmed)
  return { title: trimmed, location: null, memo: null, singleTokenTitle }
}
