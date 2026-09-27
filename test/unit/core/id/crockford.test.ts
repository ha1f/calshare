import { describe, expect, it } from 'vitest'
import { requireDefined } from '../../../../src/core/assert'
import {
  CROCKFORD_ALPHABET,
  encodeCrockford,
  isValidPageId,
  PAGE_ID_PATTERN,
} from '../../../../src/core/id/crockford'
import { PAGE_ID_LENGTH } from '../../../../src/core/config/limits'
import { RESERVED_PATHS } from '../../../../src/core/config/reservedPaths'

describe('encodeCrockford', () => {
  it('各バイトを Crockford Base32 の 1 文字に写像する', () => {
    // 32 の倍数と余りの境界（0, 31, 32, 255）を確認する
    const alphabetChar = (index: number): string =>
      requireDefined(CROCKFORD_ALPHABET[index], 'index is within CROCKFORD_ALPHABET')
    expect(encodeCrockford(new Uint8Array([0, 31, 32, 255]))).toBe(
      alphabetChar(0) + alphabetChar(31) + alphabetChar(0) + alphabetChar(255 % 32),
    )
  })

  it('アルファベットに i l o u を含まない（32 文字）', () => {
    expect(CROCKFORD_ALPHABET.length).toBe(32)
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ilou]/)
  })
})

describe('isValidPageId', () => {
  it('12 文字・許可文字のみの ID を受け付ける', () => {
    expect(isValidPageId('a1b2c3d4e5f6')).toBe(true)
  })

  it('11 文字は拒否する', () => {
    expect(isValidPageId('a1b2c3d4e5f')).toBe(false)
  })

  it('13 文字は拒否する', () => {
    expect(isValidPageId('a1b2c3d4e5f67')).toBe(false)
  })

  it('大文字は拒否する', () => {
    expect(isValidPageId('A1b2c3d4e5f6')).toBe(false)
  })

  it('i l o u を含む文字列は拒否する', () => {
    expect(isValidPageId('ailou3d4e5f6')).toBe(false)
  })

  it('プロトコル相対 URL（//example.com）を拒否する', () => {
    expect(isValidPageId('//example.com')).toBe(false)
  })

  it('URL エンコードされたスラッシュ（%2F%2F）を拒否する', () => {
    expect(isValidPageId('%2F%2F')).toBe(false)
  })

  it('予約パスとは長さが異なるため一致しない', () => {
    for (const path of RESERVED_PATHS) {
      expect(isValidPageId(path)).toBe(false)
    }
  })

  it('PAGE_ID_PATTERN は isValidPageId と同じ文字集合・長さを表す', () => {
    expect(new RegExp(`^${PAGE_ID_PATTERN}$`).test('a1b2c3d4e5f6')).toBe(true)
  })

  it('PAGE_ID_PATTERN は CROCKFORD_ALPHABET の 32 文字を過不足なく受理する', () => {
    const regexp = new RegExp(`^${PAGE_ID_PATTERN}$`)
    for (const ch of CROCKFORD_ALPHABET) {
      const s = ch.repeat(PAGE_ID_LENGTH)
      expect(regexp.test(s)).toBe(true)
      expect(isValidPageId(s)).toBe(true)
    }
    const uppercaseLetters = [...CROCKFORD_ALPHABET]
      .filter((c) => /[a-z]/.test(c))
      .map((c) => c.toUpperCase())
    for (const ch of ['i', 'l', 'o', 'u', ...uppercaseLetters]) {
      const s = ch.repeat(PAGE_ID_LENGTH)
      expect(regexp.test(s)).toBe(false)
      expect(isValidPageId(s)).toBe(false)
    }
  })
})
