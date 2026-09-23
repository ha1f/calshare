import { describe, expect, it } from 'vitest'
import { ruleBasedInterpreter } from '../../../../src/core/interpret/ruleBasedInterpreter'
import { parseEventText } from '../../../../src/core/parse/parseEventText'

describe('ruleBasedInterpreter', () => {
  it('parseEventText と同じ結果を返す', async () => {
    const ctx = { now: new Date('2026-09-20T00:00:00.000Z') }
    const input = '懇親会 9/21 19時〜21時 渋谷オフィス'
    const result = await ruleBasedInterpreter.interpret(input, ctx)
    expect(result).toEqual(parseEventText(input, ctx))
  })

  it('Promise を返す（TextInterpreter の契約）', () => {
    const ctx = { now: new Date('2026-09-20T00:00:00.000Z') }
    expect(ruleBasedInterpreter.interpret('懇親会', ctx)).toBeInstanceOf(Promise)
  })
})
