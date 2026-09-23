import { describe, expect, it } from 'vitest'
import { verifyEditTokenHash } from '../../../../src/core/token/verifyEditToken'

describe('verifyEditTokenHash', () => {
  it('同じハッシュ同士は true', () => {
    expect(verifyEditTokenHash('abc123', 'abc123')).toBe(true)
  })

  it('異なるハッシュは false', () => {
    expect(verifyEditTokenHash('abc123', 'abc124')).toBe(false)
  })

  it('長さが異なれば false', () => {
    expect(verifyEditTokenHash('abc', 'abc123')).toBe(false)
  })

  it('空文字同士は true', () => {
    expect(verifyEditTokenHash('', '')).toBe(true)
  })
})
