import { describe, expect, it } from 'vitest'
import { detectTimeToken } from '../../../../src/core/parse/timeTokens'

describe('detectTimeToken', () => {
  it('H:MM はリテラル（規則 T2 を適用しない）', () => {
    const result = detectTimeToken('7:00 集合')
    expect(result?.start).toEqual({ hour: 7, minute: 0 })
    expect(result?.end).toBeNull()
  })

  it('T2: 午前・午後の語が無く 1〜7 時なら午後にする', () => {
    expect(detectTimeToken('7時')?.start).toEqual({ hour: 19, minute: 0 })
    expect(detectTimeToken('8時')?.start).toEqual({ hour: 8, minute: 0 })
    expect(detectTimeToken('0時')?.start).toEqual({ hour: 0, minute: 0 })
  })

  it('午前・午後・朝・夜・夕方の語があればリテラル（12 時は加算しない）', () => {
    expect(detectTimeToken('午前7時')?.start).toEqual({ hour: 7, minute: 0 })
    expect(detectTimeToken('午後7時')?.start).toEqual({ hour: 19, minute: 0 })
    expect(detectTimeToken('朝7時')?.start).toEqual({ hour: 7, minute: 0 })
    expect(detectTimeToken('夜7時')?.start).toEqual({ hour: 19, minute: 0 })
    expect(detectTimeToken('夕方7時')?.start).toEqual({ hour: 19, minute: 0 })
    expect(detectTimeToken('午後12時')?.start).toEqual({ hour: 12, minute: 0 })
  })

  it('「半」は 30 分', () => {
    expect(detectTimeToken('19時半')?.start).toEqual({ hour: 19, minute: 30 })
  })

  it('T3: 素の「H時」の終了は候補 {E, E+12} のうち開始より後になる最小を採る', () => {
    expect(detectTimeToken('6時〜8時')?.end).toEqual({ hour: 20, minute: 0, nextDay: false })
    expect(detectTimeToken('10時〜2時')?.end).toEqual({ hour: 14, minute: 0, nextDay: false })
  })

  it('T3: 候補が無ければ E のまま翌日にする', () => {
    expect(detectTimeToken('19時〜7時')?.end).toEqual({ hour: 7, minute: 0, nextDay: true })
    expect(detectTimeToken('23時〜1時')?.end).toEqual({ hour: 1, minute: 0, nextDay: true })
  })

  it('T3: H:MM の範囲はリテラル。終了 ≤ 開始なら翌日', () => {
    expect(detectTimeToken('6:00〜8:00')?.end).toEqual({ hour: 8, minute: 0, nextDay: false })
    expect(detectTimeToken('23:00〜1:00')?.end).toEqual({ hour: 1, minute: 0, nextDay: true })
  })

  it('開始のみ（H〜 / Hから）は end が null', () => {
    expect(detectTimeToken('19時〜')?.end).toBeNull()
    expect(detectTimeToken('20時から反省会')?.end).toBeNull()
  })

  it('T6: 24 時以上は不正としてトークンを消費しない', () => {
    const result = detectTimeToken('25時 集合')
    expect(result?.consumed).toBe(false)
  })

  it('時刻トークンが無ければ null', () => {
    expect(detectTimeToken('渋谷で飲み会')).toBeNull()
  })
})
