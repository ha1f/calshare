import { describe, expect, it } from 'vitest'
import { RANGE_SYMBOL_SOURCE, normalizeWidth } from '../../../../src/core/parse/normalize'

describe('normalizeWidth', () => {
  it('全角英数字・記号を半角にする', () => {
    expect(normalizeWidth('９／２０　１９：００')).toBe('9/20 19:00')
  })

  it('全角ピリオドを半角にする', () => {
    expect(normalizeWidth('９．２０')).toBe('9.20')
  })

  it('全角スペースを半角スペースにする', () => {
    expect(normalizeWidth('渋谷　飲み会')).toBe('渋谷 飲み会')
  })

  it('ひらがな・漢字はそのまま', () => {
    expect(normalizeWidth('渋谷で飲み会')).toBe('渋谷で飲み会')
  })

  it('ゼロ幅スペース（U+200B）は空白にする（空文字にすると前後の数字がくっつくため）', () => {
    const zwsp = String.fromCharCode(0x200b)
    expect(normalizeWidth(`9/20${zwsp}19時 飲み会`)).toBe('9/20 19時 飲み会')
  })

  it('C0 制御文字は空白にする', () => {
    const nul = String.fromCharCode(0x00)
    const soh = String.fromCharCode(0x01)
    expect(normalizeWidth(`9/20${nul}19時${soh} 飲み会`)).toBe('9/20 19時  飲み会')
  })
})

describe('RANGE_SYMBOL_SOURCE', () => {
  it('波ダッシュ・全角チルダ・マイナス・enダッシュ・半角チルダ・半角ハイフンに一致する', () => {
    const re = new RegExp(RANGE_SYMBOL_SOURCE, 'g')
    expect('9〜10 9～10 9~10 9−10 9–10 9-10'.match(re)).toEqual(['〜', '～', '~', '−', '–', '-'])
  })

  it('範囲記号以外には一致しない', () => {
    const re = new RegExp(RANGE_SYMBOL_SOURCE, 'g')
    expect('渋谷で飲み会'.match(re)).toBeNull()
  })
})
