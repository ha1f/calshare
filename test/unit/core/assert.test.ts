import { describe, expect, it } from 'vitest'
import { requireDefined } from '../../../src/core/assert'

describe('requireDefined', () => {
  it('undefined でなければそのまま返す', () => {
    expect(requireDefined(1, 'unreachable')).toBe(1)
    expect(requireDefined('a', 'unreachable')).toBe('a')
  })

  it('undefined なら指定したメッセージで例外を投げる', () => {
    expect(() => requireDefined(undefined, 'boom')).toThrow('boom')
  })
})
