import { describe, expect, it } from 'vitest'
import { escapeIcsText } from '../../../../src/core/ics/buildIcs'

describe('escapeIcsText', () => {
  it('バックスラッシュ・セミコロン・カンマ・改行をエスケープする', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('\\r\\n を \\n に正規化してからエスケープする', () => {
    expect(escapeIcsText('1行目\r\n2行目')).toBe('1行目\\n2行目')
  })

  it('残った lone \\r と title 中の \\rATTACH: は 1 行のまま除去される', () => {
    expect(escapeIcsText('懇親会\rATTACH:evil')).toBe('懇親会ATTACH:evil')
  })

  it('U+0000-U+001F の制御文字を除去する（\\t は残す）', () => {
    const withControls = `a${String.fromCharCode(0x00)}b${String.fromCharCode(0x1f)}c\td`
    expect(escapeIcsText(withControls)).toBe('abc\td')
  })

  it('U+007F（DEL）も除去する（RFC 5545 の TSAFE-CHAR は %x7F を含まない）', () => {
    expect(escapeIcsText(`a${String.fromCharCode(0x7f)}b`)).toBe('ab')
  })

  it('NEL・LINE SEPARATOR・PARAGRAPH SEPARATOR も除去する（寛容な splitlines 実装が行区切りとして扱うため）', () => {
    const parts = [
      'a',
      String.fromCharCode(0x85),
      'ATTACH:b',
      String.fromCharCode(0x2028),
      'c',
      String.fromCharCode(0x2029),
      'd',
    ]
    expect(escapeIcsText(parts.join(''))).toBe('aATTACH:bcd')
  })

  it('バックスラッシュを含む値を二重エスケープしない', () => {
    // 素朴に置換順序を間違えると \; が \\; になったりする
    expect(escapeIcsText('C:\\path;a,b')).toBe('C:\\\\path\\;a\\,b')
  })
})
