import { describe, expect, it } from 'vitest'
import { foldIcsLine } from '../../../../src/core/ics/buildIcs'

function octetLength(text: string): number {
  return new TextEncoder().encode(text).length
}

describe('foldIcsLine', () => {
  it('75 オクテット以内なら折り返さない', () => {
    const line = `SUMMARY:${'a'.repeat(66)}` // 8 + 66 = 74 octets
    expect(octetLength(line)).toBe(74)
    expect(foldIcsLine(line)).toBe(line)
  })

  it('ちょうど 75 オクテットなら折り返さない', () => {
    const line = `SUMMARY:${'a'.repeat(67)}` // 8 + 67 = 75 octets
    expect(octetLength(line)).toBe(75)
    expect(foldIcsLine(line)).toBe(line)
  })

  it('76 オクテットなら 75 オクテット目の直後で折り返す', () => {
    const line = `SUMMARY:${'a'.repeat(68)}` // 76 octets
    const folded = foldIcsLine(line)
    const [first, second] = folded.split('\r\n')
    expect(octetLength(first)).toBe(75)
    expect(second).toBe(' a') // 継続行はスペース 1 個 + 残り 1 文字
    expect(octetLength(second)).toBe(2)
  })

  it('継続行が複数になっても先頭のスペースを含めて 75 オクテットを守る', () => {
    const line = `SUMMARY:${'a'.repeat(200)}` // 208 octets
    const folded = foldIcsLine(line)
    const segments = folded.split('\r\n')
    expect(segments.length).toBeGreaterThan(2)
    for (const seg of segments.slice(1)) {
      expect(seg.startsWith(' ')).toBe(true)
      expect(octetLength(seg)).toBeLessThanOrEqual(75)
    }
    // 折り返しを戻す（CRLF + 直後の 1 個のスペースを除去）と元の行に一致する
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })

  it('日本語（3 オクテット文字）の途中で切らない', () => {
    // 「あ」は UTF-8 で 3 オクテット
    const line = `SUMMARY:${'あ'.repeat(30)}` // 8 + 90 = 98 octets
    const folded = foldIcsLine(line)
    for (const seg of folded.split('\r\n')) {
      // 不完全なマルチバイト列が残っていれば decode 時に置換文字が出る
      const bytes = new TextEncoder().encode(seg.startsWith(' ') ? seg.slice(1) : seg)
      expect(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
      ).not.toContain('�')
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })

  it('ASCII と日本語が混在していても文字の途中で切らない', () => {
    const line = `SUMMARY:懇親会のお知らせ${'x'.repeat(80)}日本語混在テスト`
    const folded = foldIcsLine(line)
    expect(folded.replace(/\r\n /g, '')).toBe(line)
    for (const seg of folded.split('\r\n')) {
      expect(octetLength(seg)).toBeLessThanOrEqual(75)
    }
  })
})
