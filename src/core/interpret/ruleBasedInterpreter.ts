import { parseEventText } from '../parse/parseEventText'
import type { TextInterpreter } from './types'

/** ルールベースの TextInterpreter 実装。通信は発生しない（§5.9） */
export const ruleBasedInterpreter: TextInterpreter = {
  // TextInterpreter は Promise を返す契約（test/unit/core/interpret/ruleBasedInterpreter.test.ts）。
  // Promise コンストラクタの executor は同期実行されるため、parseEventText が例外を投げても
  // 同期の throw にはならず reject になる
  interpret: (input, ctx) => new Promise((resolve) => resolve(parseEventText(input, ctx))),
}
