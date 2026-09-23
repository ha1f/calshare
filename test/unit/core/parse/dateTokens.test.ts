import { describe, expect, it } from 'vitest'
import { jstDate } from '../../../../src/core/time/jst'
import {
  detectDateToken,
  detectDateTokens,
  resolveDateToken,
} from '../../../../src/core/parse/dateTokens'

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

  it('数字列の途中から日付を切り出さない', () => {
    expect(detectDateToken('会費3000/5000円')).toBeNull()
  })

  it('不完全な `年/月` だけの表記は日付として検出しない', () => {
    expect(detectDateToken('2026/9 総会')).toBeNull()
  })

  it('曜日カッコの中身は曜日・祝に限る（時刻表記までは飲み込まない）', () => {
    const match = detectDateToken('9/20(19時〜) 渋谷で飲み会')
    expect(match?.length).toBe('9/20'.length)
  })

  it('「再来週」は「来週」の一部として消費しない', () => {
    expect(detectDateToken('再来週月曜に会議')?.token.kind).not.toBe('nextWeek')
  })
})

describe('detectDateTokens', () => {
  it('最初の候補が invalid_date でも、後続に有効な候補があれば全候補を返す', () => {
    const matches = detectDateTokens('2/30 or 3/1 飲み会')
    expect(matches.map((m) => m.token)).toEqual([
      { kind: 'absolute', year: null, month: 2, day: 30 },
      { kind: 'absolute', year: null, month: 3, day: 1 },
    ])
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

  it('D1: 翌年に繰り上げた先にも存在しない日付（2/29）は invalid_date', () => {
    const now2028 = jstDate(2028, 3, 1, 1, 0) // 2028 はうるう年で 2/29 は既に過ぎている、2029 は平年
    const result = resolveDateToken(
      { kind: 'absolute', year: null, month: 2, day: 29 },
      now2028,
      null,
    )
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

  it('D4: 基準時刻とちょうど同時刻は「過ぎていない」扱いにする（規則 T4 と揃える）', () => {
    const exact = resolveDateToken({ kind: 'weekday', weekday: 3 }, NOW, { hour: 10, minute: 0 })
    expect(exact.start).toEqual({ y: 2026, m: 9, d: 16 })
  })

  it('D2: 開始年を明示した範囲が過去日なら past_date', () => {
    const result = resolveDateToken(
      {
        kind: 'range',
        startYear: 2024,
        startMonth: 3,
        startDay: 1,
        endYear: 2024,
        endMonth: 3,
        endDay: 2,
      },
      NOW,
      null,
    )
    expect(result).toEqual({ consumed: true, issues: ['past_date'], start: null, end: null })
  })

  it('D3: 開始年を明示した範囲が 13 ヶ月超なら beyond_max_lead_time', () => {
    const result = resolveDateToken(
      {
        kind: 'range',
        startYear: 2028,
        startMonth: 1,
        startDay: 1,
        endYear: 2028,
        endMonth: 1,
        endDay: 3,
      },
      NOW,
      null,
    )
    expect(result).toEqual({
      consumed: true,
      issues: ['beyond_max_lead_time'],
      start: null,
      end: null,
    })
  })

  it('終了年を明示していて開始より前なら矛盾した入力として invalid_date', () => {
    const result = resolveDateToken(
      {
        kind: 'range',
        startYear: 2027,
        startMonth: 1,
        startDay: 3,
        endYear: 2026,
        endMonth: 12,
        endDay: 30,
      },
      NOW,
      null,
    )
    expect(result).toEqual({ consumed: false, issues: ['invalid_date'], start: null, end: null })
  })

  it('開始が D1 で翌年に繰り上がり、明示した終了年がそれより前になる場合も invalid_date', () => {
    const result = resolveDateToken(
      {
        kind: 'range',
        startYear: null,
        startMonth: 9,
        startDay: 15,
        endYear: 2026,
        endMonth: 9,
        endDay: 16,
      },
      NOW,
      null,
    )
    expect(result).toEqual({ consumed: false, issues: ['invalid_date'], start: null, end: null })
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
