import type { ParseContext, ParsedEvent } from '../parse/types'

/**
 * 予定のテキストをパース結果に変換する境界。Phase 1 は `ruleBasedInterpreter` の
 * 1 実装のみで、Phase 2 の LLM フォールバックもこの型を実装して差し替える（§5.9）
 */
export interface TextInterpreter {
  interpret(input: string, ctx: ParseContext): Promise<ParsedEvent>
}
