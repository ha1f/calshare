import { describe, expect, it } from 'vitest'
import {
  computeDatetimeInputValues,
  computeManualDatetimeFromInputs,
} from '../../../../src/web/create/tapEdit'

describe('computeManualDatetimeFromInputs', () => {
  it('開始のみで終日なら 1 日分の範囲にする', () => {
    const value = computeManualDatetimeFromInputs('2026-09-20', '', true)
    expect(value).toEqual({
      start: new Date('2026-09-19T15:00:00.000Z'),
      end: new Date('2026-09-20T15:00:00.000Z'),
      isAllDay: true,
    })
  })

  it('終日で開始が空なら isAllDay のチェックはそのまま保つ（下書きで外れない）', () => {
    const value = computeManualDatetimeFromInputs('', '', true)
    expect(value).toEqual({ start: null, end: null, isAllDay: true })
  })

  it('終了が空欄なら開始 + 既定所要時間（60 分）を補う', () => {
    const value = computeManualDatetimeFromInputs('2026-09-20T19:00', '', false)
    expect(value).toEqual({
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
    })
  })

  it('開始が空なら日時未定にする', () => {
    const value = computeManualDatetimeFromInputs('', '2026-09-20T20:00', false)
    expect(value).toEqual({ start: null, end: null, isAllDay: false })
  })

  it('開始・終了とも入力済みならそのまま使う', () => {
    const value = computeManualDatetimeFromInputs('2026-09-20T19:00', '2026-09-20T21:00', false)
    expect(value).toEqual({
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T12:00:00.000Z'),
      isAllDay: false,
    })
  })
})

describe('computeDatetimeInputValues', () => {
  it('時刻ありから終日へ切り替えると、終了は開始と同じ日になる（単日）', () => {
    const values = computeDatetimeInputValues(
      {
        start: new Date('2026-09-20T10:00:00.000Z'), // 9/20 19:00 JST
        end: new Date('2026-09-20T11:00:00.000Z'), // 9/20 20:00 JST
        isAllDay: false,
      },
      true,
    )
    expect(values).toEqual({ start: '2026-09-20', end: '2026-09-20' })
  })

  it('日をまたぐ時刻ありから終日へ切り替えると、終了は終了時刻の日付になる', () => {
    const values = computeDatetimeInputValues(
      {
        start: new Date('2026-09-20T10:00:00.000Z'), // 9/20 19:00 JST
        end: new Date('2026-09-20T17:00:00.000Z'), // 9/21 02:00 JST
        isAllDay: false,
      },
      true,
    )
    expect(values).toEqual({ start: '2026-09-20', end: '2026-09-21' })
  })

  it('すでに終日の値を再表示するときは、排他的な翌日 00:00 から 1 日引く', () => {
    const values = computeDatetimeInputValues(
      {
        start: new Date('2026-09-19T15:00:00.000Z'), // 9/20 00:00 JST
        end: new Date('2026-09-21T15:00:00.000Z'), // 9/22 00:00 JST（排他的）
        isAllDay: true,
      },
      true,
    )
    expect(values).toEqual({ start: '2026-09-20', end: '2026-09-21' })
  })

  it('開始が無ければ両方空文字にする', () => {
    expect(computeDatetimeInputValues({ start: null, end: null, isAllDay: false }, false)).toEqual({
      start: '',
      end: '',
    })
  })

  it('終日から時刻ありへ戻すと datetime-local の文字列になる', () => {
    const values = computeDatetimeInputValues(
      {
        start: new Date('2026-09-19T15:00:00.000Z'), // 9/20 00:00 JST
        end: new Date('2026-09-20T15:00:00.000Z'), // 9/21 00:00 JST
        isAllDay: true,
      },
      false,
    )
    expect(values).toEqual({ start: '2026-09-20T00:00', end: '2026-09-21T00:00' })
  })
})
