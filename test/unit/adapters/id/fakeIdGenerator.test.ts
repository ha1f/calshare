import { describe, expect, it } from 'vitest'
import { createFakeIdGenerator } from '../../../../src/adapters/id/fakeIdGenerator'
import { isValidPageId } from '../../../../src/core/id/crockford'

describe('createFakeIdGenerator', () => {
  it('generatePageId は isValidPageId を満たす決定的な値を、呼び出しごとに変えて返す', () => {
    const generator = createFakeIdGenerator()
    const first = generator.generatePageId()
    const second = generator.generatePageId()
    expect(isValidPageId(first)).toBe(true)
    expect(isValidPageId(second)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('generateEditToken は 43 文字を、呼び出しごとに変えて返す', () => {
    const generator = createFakeIdGenerator()
    const first = generator.generateEditToken()
    const second = generator.generateEditToken()
    expect(first).toHaveLength(43)
    expect(second).toHaveLength(43)
    expect(first).not.toBe(second)
  })

  it('generateUuid は呼び出しごとに異なる値を返す', () => {
    const generator = createFakeIdGenerator()
    expect(generator.generateUuid()).not.toBe(generator.generateUuid())
  })

  it('複数インスタンス間で採番が独立する', () => {
    const a = createFakeIdGenerator()
    const b = createFakeIdGenerator()
    expect(a.generatePageId()).toBe(b.generatePageId())
  })
})
