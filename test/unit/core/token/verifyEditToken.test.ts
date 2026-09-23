import { describe, expect, it } from 'vitest'
import { hashEditToken } from '../../../../src/core/token/hashEditToken'
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

  it('同じトークンから hashEditToken で作ったハッシュ同士は true', async () => {
    const a = await hashEditToken('a')
    const b = await hashEditToken('a')
    expect(verifyEditTokenHash(a, b)).toBe(true)
  })

  it('1 文字違うトークンのハッシュは false', async () => {
    const a = await hashEditToken('a')
    const b = await hashEditToken('b')
    expect(verifyEditTokenHash(a, b)).toBe(false)
  })

  it('正解ハッシュを大文字化したものは false（hex は小文字である前提）', async () => {
    const hash = await hashEditToken('a')
    expect(verifyEditTokenHash(hash, hash.toUpperCase())).toBe(false)
  })
})
