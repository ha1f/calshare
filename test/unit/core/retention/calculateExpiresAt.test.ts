import { describe, expect, it } from 'vitest'
import {
  calculateExpiresAt,
  isWithinMaxLeadTime,
  maxLeadTimeLimit,
} from '../../../../src/core/retention/calculateExpiresAt'
import { jstDate } from '../../../../src/core/time/jst'

describe('calculateExpiresAt', () => {
  it('イベントが無ければ baseDate + 7 日を返す（日時の無い下書き）', () => {
    const baseDate = jstDate(2026, 9, 20, 10, 0)
    expect(calculateExpiresAt([], baseDate)).toEqual(jstDate(2026, 9, 27, 10, 0))
  })

  it('イベントの終了 + 7 日を返す', () => {
    const baseDate = jstDate(2026, 9, 1, 0, 0)
    const events = [{ endAt: jstDate(2026, 9, 20, 21, 0) }]
    expect(calculateExpiresAt(events, baseDate)).toEqual(jstDate(2026, 9, 27, 21, 0))
  })

  it('複数イベントのうち最も遅い終了を採る（Phase 2 の複数イベントに備える）', () => {
    const baseDate = jstDate(2026, 9, 1, 0, 0)
    const events = [
      { endAt: jstDate(2026, 9, 10, 21, 0) },
      { endAt: jstDate(2026, 9, 20, 21, 0) },
      { endAt: jstDate(2026, 9, 15, 21, 0) },
    ]
    expect(calculateExpiresAt(events, baseDate)).toEqual(jstDate(2026, 9, 27, 21, 0))
  })

  it('日時の無いイベント（endAt が null）は無視し、他のイベントの終了を使う', () => {
    const baseDate = jstDate(2026, 9, 1, 0, 0)
    const events = [{ endAt: null }, { endAt: jstDate(2026, 9, 20, 21, 0) }]
    expect(calculateExpiresAt(events, baseDate)).toEqual(jstDate(2026, 9, 27, 21, 0))
  })

  it('全イベントの endAt が null なら baseDate + 7 日を返す', () => {
    const baseDate = jstDate(2026, 9, 20, 10, 0)
    const events = [{ endAt: null }, { endAt: null }]
    expect(calculateExpiresAt(events, baseDate)).toEqual(jstDate(2026, 9, 27, 10, 0))
  })
})

describe('maxLeadTimeLimit / isWithinMaxLeadTime', () => {
  it('13 ヶ月ちょうどは上限内', () => {
    const now = jstDate(2026, 9, 20, 12, 0)
    const limit = maxLeadTimeLimit(now)
    expect(limit).toEqual(jstDate(2027, 10, 20, 12, 0))
    expect(isWithinMaxLeadTime(limit, now)).toBe(true)
  })

  it('13 ヶ月ちょうど + 1 秒は上限外', () => {
    const now = jstDate(2026, 9, 20, 12, 0)
    const limit = maxLeadTimeLimit(now)
    const beyond = new Date(limit.getTime() + 1000)
    expect(isWithinMaxLeadTime(beyond, now)).toBe(false)
  })

  it('13 ヶ月より前は上限内', () => {
    const now = jstDate(2026, 9, 20, 12, 0)
    expect(isWithinMaxLeadTime(jstDate(2027, 6, 1), now)).toBe(true)
  })
})
