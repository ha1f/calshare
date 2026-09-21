import { describe, expect, it } from 'vitest'
import { normalizeRangeSymbols, normalizeWidth } from '../../../../src/core/parse/normalize'

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
})

describe('normalizeRangeSymbols', () => {
  it('波ダッシュ・全角チルダ・マイナス・enダッシュ・半角ハイフンを 〜 に統一する', () => {
    expect(normalizeRangeSymbols('9〜10')).toBe('9〜10')
    expect(normalizeRangeSymbols('9～10')).toBe('9〜10')
    expect(normalizeRangeSymbols('9~10')).toBe('9〜10')
    expect(normalizeRangeSymbols('9−10')).toBe('9〜10')
    expect(normalizeRangeSymbols('9–10')).toBe('9〜10')
    expect(normalizeRangeSymbols('9-10')).toBe('9〜10')
  })

  it('範囲記号が無ければそのまま', () => {
    expect(normalizeRangeSymbols('渋谷で飲み会')).toBe('渋谷で飲み会')
  })
})
