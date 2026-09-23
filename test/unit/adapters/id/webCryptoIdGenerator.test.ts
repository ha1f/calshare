import { describe, expect, it } from 'vitest'
import { createWebCryptoIdGenerator } from '../../../../src/adapters/id/webCryptoIdGenerator'
import { isValidPageId } from '../../../../src/core/id/crockford'
import { RESERVED_PATHS } from '../../../../src/core/config/reservedPaths'

describe('createWebCryptoIdGenerator', () => {
  it('generatePageId は 1 万件生成しても許可文字のみ・12 文字・予約パスと不一致', () => {
    const generator = createWebCryptoIdGenerator()
    const ids = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      const id = generator.generatePageId()
      expect(id).toHaveLength(12)
      expect(isValidPageId(id)).toBe(true)
      expect(RESERVED_PATHS as readonly string[]).not.toContain(id)
      ids.add(id)
    }
    // 60 bit のキースペースなので 1 万件生成して衝突しないことも確認する
    expect(ids.size).toBe(10_000)
  })

  it('generateEditToken は 43 文字の base64url を返す', () => {
    const generator = createWebCryptoIdGenerator()
    const token = generator.generateEditToken()
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('generateEditToken は毎回異なる値を返す', () => {
    const generator = createWebCryptoIdGenerator()
    expect(generator.generateEditToken()).not.toBe(generator.generateEditToken())
  })

  it('generateUuid は UUID v4 の形式で返す', () => {
    const generator = createWebCryptoIdGenerator()
    const uuid = generator.generateUuid()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
