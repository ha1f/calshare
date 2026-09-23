import { parseEventText } from '../parse/parseEventText'
import type { TextInterpreter } from './types'

/** ルールベースの TextInterpreter 実装。通信は発生しない（§5.9） */
export const ruleBasedInterpreter: TextInterpreter = {
  interpret: async (input, ctx) => parseEventText(input, ctx),
}
