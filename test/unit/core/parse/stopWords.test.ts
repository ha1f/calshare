import { describe, expect, it } from 'vitest'
import { isLocationStopPhrase } from '../../../../src/core/parse/stopWords'

describe('isLocationStopPhrase', () => {
  it.each([
    'みんなで',
    '皆で',
    'ひとりで',
    '一人で',
    '全員で',
    '二人で',
    '2人で',
    'ふたりで',
    '家族で',
    '有志で',
    '急ぎで',
    '無料で',
  ])('%s はストップリストに一致する', (phrase) => {
    expect(isLocationStopPhrase(phrase)).toBe(true)
  })

  it('リストに無い候補は一致しない', () => {
    expect(isLocationStopPhrase('渋谷で')).toBe(false)
    expect(isLocationStopPhrase('オンラインで')).toBe(false)
  })
})
