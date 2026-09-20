import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  formatBasicDateJst,
  formatBasicUtc,
  formatDateLabel,
  jstDate,
  toJstParts,
} from '../../../../src/core/time/jst'
import type { EventFields } from '../../../../src/core/types'

describe('jstDate / toJstParts', () => {
  it('JST の壁時計を UTC の Date に変換する', () => {
    // 2026-09-20 19:00 JST = 2026-09-20 10:00 UTC
    const date = jstDate(2026, 9, 20, 19, 0)
    expect(date.toISOString()).toBe('2026-09-20T10:00:00.000Z')
  })

  it('往復して同じ壁時計の値に戻る', () => {
    const date = jstDate(2026, 9, 20, 19, 0)
    const parts = toJstParts(date)
    expect(parts).toEqual({ y: 2026, m: 9, d: 20, h: 19, mi: 0, weekday: 0 }) // 2026-09-20 は日曜
  })

  it('JST 0〜8 時台は UTC では前日になる', () => {
    // 2026-09-19 15:00 UTC = 2026-09-20 00:00 JST
    const parts = toJstParts(new Date('2026-09-19T15:00:00Z'))
    expect(parts).toEqual({ y: 2026, m: 9, d: 20, h: 0, mi: 0, weekday: 0 })
  })
})

describe('formatDateLabel', () => {
  const base: EventFields = {
    title: '',
    location: null,
    memo: null,
    start: null,
    end: null,
    isAllDay: false,
  }

  it('19:00〜20:00 形式で返す', () => {
    const fields: EventFields = {
      ...base,
      start: jstDate(2026, 9, 20, 19, 0),
      end: jstDate(2026, 9, 20, 20, 0),
    }
    expect(formatDateLabel(fields)).toBe('9月20日(日) 19:00〜20:00')
  })

  it('終日 1 日は end（翌日 00:00 の排他的終端）を 1 日戻して表示する', () => {
    const fields: EventFields = {
      ...base,
      isAllDay: true,
      start: jstDate(2026, 9, 20, 0, 0),
      end: jstDate(2026, 9, 21, 0, 0),
    }
    expect(formatDateLabel(fields)).toBe('9月20日(日)')
  })

  it('終日の複数日は開始日〜最終日（end の前日）で返す', () => {
    const fields: EventFields = {
      ...base,
      isAllDay: true,
      start: jstDate(2026, 9, 20, 0, 0),
      end: jstDate(2026, 9, 22, 0, 0),
    }
    expect(formatDateLabel(fields)).toBe('9月20日(日)〜9月21日(月)')
  })

  it('日をまたぐ時刻ありイベントは終了側にも日付を出す', () => {
    const fields: EventFields = {
      ...base,
      start: jstDate(2026, 12, 31, 23, 0),
      end: jstDate(2027, 1, 1, 0, 0),
    }
    expect(formatDateLabel(fields)).toBe('12月31日(木) 23:00〜1月1日(金) 00:00')
  })

  it('end が無い時刻ありイベントは開始のみを返す（保存前の途中状態。§5.7 では INVALID_RANGE）', () => {
    const fields: EventFields = { ...base, start: jstDate(2026, 9, 20, 19, 0) }
    expect(formatDateLabel(fields)).toBe('9月20日(日) 19:00')
  })

  it('日時が無ければ「日時未定」', () => {
    expect(formatDateLabel(base)).toBe('日時未定')
  })
})

describe('formatBasicUtc / formatBasicDateJst', () => {
  it('formatBasicUtc は UTC basic format', () => {
    const date = jstDate(2026, 9, 20, 19, 0)
    expect(formatBasicUtc(date)).toBe('20260920T100000Z')
  })

  it('formatBasicDateJst は JST の暦日', () => {
    const date = jstDate(2026, 9, 20, 19, 0)
    expect(formatBasicDateJst(date)).toBe('20260920')
  })

  it('formatBasicDateJst は JST 0 時台でも UTC の前日に引きずられない', () => {
    expect(formatBasicDateJst(jstDate(2026, 9, 20, 0, 0))).toBe('20260920')
  })
})

describe('addDays', () => {
  it('日数分だけ加算する', () => {
    const date = jstDate(2026, 9, 20, 19, 0)
    expect(addDays(date, 7).toISOString()).toBe(jstDate(2026, 9, 27, 19, 0).toISOString())
  })
})

describe('addMonths', () => {
  it('月をまたいで加算する', () => {
    const date = jstDate(2026, 9, 20, 19, 0)
    expect(toJstParts(addMonths(date, 1))).toEqual({
      y: 2026,
      m: 10,
      d: 20,
      h: 19,
      mi: 0,
      weekday: 2,
    })
  })

  it('年をまたいで加算する', () => {
    const date = jstDate(2026, 12, 20, 19, 0)
    expect(toJstParts(addMonths(date, 1))).toEqual({
      y: 2027,
      m: 1,
      d: 20,
      h: 19,
      mi: 0,
      weekday: 3,
    })
  })

  it('月末境界: 1/31 の 1 ヶ月後は 2/28（平年）にクランプする', () => {
    const date = jstDate(2025, 1, 31, 10, 0)
    expect(toJstParts(addMonths(date, 1))).toEqual({
      y: 2025,
      m: 2,
      d: 28,
      h: 10,
      mi: 0,
      weekday: 5,
    })
  })

  it('月末境界: 1/31 の 1 ヶ月後は 2/29（うるう年）にクランプする', () => {
    const date = jstDate(2028, 1, 31, 10, 0)
    expect(toJstParts(addMonths(date, 1))).toEqual({
      y: 2028,
      m: 2,
      d: 29,
      h: 10,
      mi: 0,
      weekday: 2,
    })
  })

  it('13 ヶ月ちょうどの加算', () => {
    // §5.1 の基準時刻 2026-09-16(水) 10:00 JST から 13 ヶ月後
    const date = jstDate(2026, 9, 16, 10, 0)
    expect(toJstParts(addMonths(date, 13))).toEqual({
      y: 2027,
      m: 10,
      d: 16,
      h: 10,
      mi: 0,
      weekday: 6,
    })
  })

  it('負数（年をまたぐ）を加算すると前年に戻る', () => {
    const date = jstDate(2026, 1, 15, 10, 0)
    expect(toJstParts(addMonths(date, -1))).toEqual({
      y: 2025,
      m: 12,
      d: 15,
      h: 10,
      mi: 0,
      weekday: 1,
    })
  })

  it('負数の加算でも月末境界のクランプが効く', () => {
    const date = jstDate(2026, 3, 31, 10, 0)
    expect(toJstParts(addMonths(date, -1))).toEqual({
      y: 2026,
      m: 2,
      d: 28,
      h: 10,
      mi: 0,
      weekday: 6,
    })
  })
})
