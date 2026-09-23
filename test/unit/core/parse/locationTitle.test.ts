import { describe, expect, it } from 'vitest'
import { splitTitleLocationMemo } from '../../../../src/core/parse/locationTitle'

describe('splitTitleLocationMemo', () => {
  it('規則 L1・T-a: 「で」の前を場所、後ろの最初のまとまりをタイトルにする', () => {
    expect(splitTitleLocationMemo('渋谷で飲み会')).toEqual({
      title: '飲み会',
      location: '渋谷',
      memo: null,
      singleTokenTitle: false,
    })
  })

  it('規則 L1: 「にて」でも場所を検出する', () => {
    expect(splitTitleLocationMemo('渋谷にて飲み会')).toEqual({
      title: '飲み会',
      location: '渋谷',
      memo: null,
      singleTokenTitle: false,
    })
  })

  it('規則 L1: 「でも」は区切りにしない', () => {
    expect(splitTitleLocationMemo('誰でも歓迎')).toEqual({
      title: '誰でも歓迎',
      location: null,
      memo: null,
      singleTokenTitle: true,
    })
  })

  it('規則 L2: ストップリストに一致する候補は場所にしない', () => {
    expect(splitTitleLocationMemo('みんなで飲み会')).toEqual({
      title: 'みんなで飲み会',
      location: null,
      memo: null,
      singleTokenTitle: true,
    })
  })

  it('規則 L3: 「で」が無く複数語なら場所は null で singleTokenTitle も false', () => {
    expect(splitTitleLocationMemo('渋谷 忘年会')).toEqual({
      title: '渋谷 忘年会',
      location: null,
      memo: null,
      singleTokenTitle: false,
    })
  })

  it('規則 L3: 「で」が無く空白区切り 1 語だけなら singleTokenTitle を true にする', () => {
    expect(splitTitleLocationMemo('渋谷')).toEqual({
      title: '渋谷',
      location: null,
      memo: null,
      singleTokenTitle: true,
    })
  })

  it('規則 T-b: 「で」が無ければ読点で分ける', () => {
    expect(splitTitleLocationMemo('忘年会、会費5000円')).toEqual({
      title: '忘年会',
      location: null,
      memo: '会費5000円',
      singleTokenTitle: false,
    })
  })

  it('規則 T-a: 場所より前の残りと A の残りをこの順で改行結合する', () => {
    expect(splitTitleLocationMemo('会費5000円 渋谷区役所で説明会')).toEqual({
      title: '説明会',
      location: '渋谷区役所',
      memo: '会費5000円',
      singleTokenTitle: false,
    })
  })

  it('何も残らなければタイトルは空文字（呼び出し側が規則 T-c を適用する）', () => {
    expect(splitTitleLocationMemo('')).toEqual({
      title: '',
      location: null,
      memo: null,
      singleTokenTitle: false,
    })
  })

  it('規則 T-a: 場所より前の残り B と A の残りが両方あれば B → A の残りの順で改行結合する', () => {
    expect(splitTitleLocationMemo('会費5000円 渋谷区役所で説明会 遅れる人は連絡')).toEqual({
      title: '説明会',
      location: '渋谷区役所',
      memo: '会費5000円\n遅れる人は連絡',
      singleTokenTitle: false,
    })
  })
})
