import { describe, expect, it } from 'vitest'
import { jstDate } from '../../../../src/core/time/jst'
import { detectDateToken, resolveDateToken } from '../../../../src/core/parse/dateTokens'

const NOW = jstDate(2026, 9, 16, 10, 0) // 2026-09-16(水)

describe('detectDateToken', () => {
  it('複数の日付があれば最初（最も左）のものを検出する', () => {
    const match = detectDateToken('9/20と10/5どちらか')
    expect(match?.token).toEqual({ kind: 'absolute', year: null, month: 9, day: 20 })
  })

  it('range は absolute より優先して検出する', () => {
    const match = detectDateToken('9/20〜9/21 合宿')
    expect(match?.token.kind).toBe('range')
  })

  it('来週+曜日は曜日単独より先に見つかる', () => {
    const match = detectDateToken('来週水曜に会議')
    expect(match?.token).toEqual({ kind: 'nextWeek', weekday: 3 })
  })

  it('日付らしいトークンが無ければ null', () => {
    expect(detectDateToken('飲み会やります')).toBeNull()
  })
})

describe('resolveDateToken', () => {
  it('D1: 年省略の月日が今日より前なら翌年に繰り上げる', () => {
    const result = resolveDateToken({ kind: 'absolute', year: null, month: 9, day: 15 }, NOW, null)
    expect(result).toEqual({
      consumed: true,
      issues: [],
      start: { y: 2027, m: 9, d: 15 },
      end: { y: 2027, m: 9, d: 15 },
    })
  })

  it('D1: 今日と同日は繰り上げない', () => {
    const result = resolveDateToken({ kind: 'absolute', year: null, month: 9, day: 16 }, NOW, null)
    expect(result.start).toEqual({ y: 2026, m: 9, d: 16 })
  })

  it('D2: 年を明示した過去日は past_date で start が null', () => {
    const result = resolveDateToken({ kind: 'absolute', year: 2024, month: 3, day: 1 }, NOW, null)
    expect(result).toEqual({ consumed: true, issues: ['past_date'], start: null, end: null })
  })

  it('D3: 13 ヶ月を超える開始は beyond_max_lead_time', () => {
    const result = resolveDateToken({ kind: 'absolute', year: 2027, month: 10, day: 17 }, NOW, null)
    expect(result).toEqual({
      consumed: true,
      issues: ['beyond_max_lead_time'],
      start: null,
      end: null,
    })
  })

  it('D6: 存在しない日付は消費せず invalid_date', () => {
    const result = resolveDateToken({ kind: 'absolute', year: null, month: 2, day: 30 }, NOW, null)
    expect(result).toEqual({ consumed: false, issues: ['invalid_date'], start: null, end: null })
  })

  it('D4: 曜日単独は直近の当該曜日（時刻が既に過ぎていれば +7 日）', () => {
    const notPassed = resolveDateToken({ kind: 'weekday', weekday: 3 }, NOW, {
      hour: 19,
      minute: 0,
    })
    expect(notPassed.start).toEqual({ y: 2026, m: 9, d: 16 })
    const passed = resolveDateToken({ kind: 'weekday', weekday: 3 }, NOW, { hour: 8, minute: 0 })
    expect(passed.start).toEqual({ y: 2026, m: 9, d: 23 })
  })

  it('A2: 終了日が開始日より前なら年またぎとみなす', () => {
    const result = resolveDateToken(
      {
        kind: 'range',
        startYear: null,
        startMonth: 12,
        startDay: 30,
        endYear: null,
        endMonth: 1,
        endDay: 3,
      },
      NOW,
      null,
    )
    expect(result).toEqual({
      consumed: true,
      issues: [],
      start: { y: 2026, m: 12, d: 30 },
      end: { y: 2027, m: 1, d: 3 },
    })
  })
})
