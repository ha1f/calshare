import type { ParseContext, ParsedEvent } from '../parse/types'

/**
 * 予定のテキストをパース結果に変換する境界。呼び出し側はこの型に依存し、
 * 実装を差し替えるだけで解釈方法を変えられる（§5.9）
 */
export interface TextInterpreter {
  interpret(input: string, ctx: ParseContext): Promise<ParsedEvent>
}
