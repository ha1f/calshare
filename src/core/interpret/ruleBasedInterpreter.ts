import { parseEventText } from '../parse/parseEventText'
import type { TextInterpreter } from './types'

/** ルールベースの TextInterpreter 実装。通信は発生しない（§5.9） */
export const ruleBasedInterpreter: TextInterpreter = {
  // parseEventText が例外を投げても同期の throw にせず reject にするため、
  // Promise コンストラクタの中で呼ぶ
  interpret: (input, ctx) => new Promise((resolve) => resolve(parseEventText(input, ctx))),
}
