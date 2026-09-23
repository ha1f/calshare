import { describe, expect, it } from 'vitest'
import { hashEditToken } from '../../../../src/core/token/hashEditToken'

describe('hashEditToken', () => {
  it('SHA-256 の hex 文字列（64 文字）を返す', async () => {
    const hash = await hashEditToken('sample-token')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('同じ入力からは同じハッシュを返す', async () => {
    expect(await hashEditToken('same-token')).toBe(await hashEditToken('same-token'))
  })

  it('異なる入力からは異なるハッシュを返す', async () => {
    expect(await hashEditToken('token-a')).not.toBe(await hashEditToken('token-b'))
  })

  it('既知の入力に対する SHA-256 の値と一致する', async () => {
    // echo -n "abc" | shasum -a 256
    expect(await hashEditToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
