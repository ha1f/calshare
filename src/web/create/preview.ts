import { ruleBasedInterpreter } from '../../core/interpret/ruleBasedInterpreter'
import type { ParseContext, ParsedEvent } from '../../core/parse/types'
import type { EventFields } from '../../core/types'

/** input イベントからプレビューを更新するまでのデバウンス（§6.1） */
export const PREVIEW_DEBOUNCE_MS = 150

export interface DatetimeValue {
  start: Date | null
  end: Date | null
  isAllDay: boolean
}

/** manual なら編集済みの値、auto ならプレビューの自動解釈に従う（§6.1） */
export type ItemState<T> = { mode: 'auto' } | { mode: 'manual'; value: T }

export interface CreateState {
  rawText: string
  parsed: ParsedEvent
  title: ItemState<string>
  location: ItemState<string | null>
  memo: ItemState<string | null>
  datetime: ItemState<DatetimeValue>
}

const EMPTY_PARSED: ParsedEvent = {
  title: '',
  location: null,
  memo: null,
  start: null,
  end: null,
  isAllDay: false,
  issues: [],
  singleTokenTitle: false,
}

export function createInitialState(): CreateState {
  return {
    rawText: '',
    parsed: EMPTY_PARSED,
    title: { mode: 'auto' },
    location: { mode: 'auto' },
    memo: { mode: 'auto' },
    datetime: { mode: 'auto' },
  }
}

/**
 * textarea の内容を `TextInterpreter`（§5.9）に渡して解釈する。Phase 1 の実装は
 * `ruleBasedInterpreter` で通信は発生しない。空文字は解釈を呼ばず空の結果を返す
 */
export async function interpret(rawText: string, ctx: ParseContext): Promise<ParsedEvent> {
  if (rawText.trim() === '') return EMPTY_PARSED
  return ruleBasedInterpreter.interpret(rawText, ctx)
}

export function effectiveDatetime(state: CreateState): DatetimeValue {
  if (state.datetime.mode === 'manual') return state.datetime.value
  return { start: state.parsed.start, end: state.parsed.end, isAllDay: state.parsed.isAllDay }
}

export function effectiveTitle(state: CreateState): string {
  return state.title.mode === 'manual' ? state.title.value : state.parsed.title
}

export function effectiveLocation(state: CreateState): string | null {
  return state.location.mode === 'manual' ? state.location.value : state.parsed.location
}

export function effectiveMemo(state: CreateState): string | null {
  return state.memo.mode === 'manual' ? state.memo.value : state.parsed.memo
}

/** API に送る確定値（§2.3）。プレビューが示している内容と同じものを組み立てる */
export function effectiveFields(state: CreateState): EventFields {
  const datetime = effectiveDatetime(state)
  return {
    title: effectiveTitle(state),
    location: effectiveLocation(state),
    memo: effectiveMemo(state),
    start: datetime.start,
    end: datetime.end,
    isAllDay: datetime.isAllDay,
  }
}
