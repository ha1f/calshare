import { describe, expect, it } from 'vitest'
import { buildGoogleCalendarUrl } from '../../../../src/core/google/buildGoogleCalendarUrl'
import type { CalendarEventInput } from '../../../../src/core/google/buildGoogleCalendarUrl'
import { jstDate } from '../../../../src/core/time/jst'
import { MAX_CALENDAR_DETAILS_LENGTH } from '../../../../src/core/config/limits'

function baseInput(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    title: '懇親会',
    location: '渋谷オフィス',
    memo: 'カジュアルな飲み会です',
    start: jstDate(2026, 9, 20, 19, 0),
    end: jstDate(2026, 9, 20, 21, 0),
    isAllDay: false,
    detailUrl: 'https://calshare.example/abc123def456',
    ...overrides,
  }
}

function parseParams(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe('buildGoogleCalendarUrl', () => {
  it('render エンドポイントと action=TEMPLATE を組む', () => {
    const url = buildGoogleCalendarUrl(baseInput())
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
    expect(parseParams(url).get('action')).toBe('TEMPLATE')
  })

  it('ctz=Asia/Tokyo を常に付ける', () => {
    expect(parseParams(buildGoogleCalendarUrl(baseInput())).get('ctz')).toBe('Asia/Tokyo')
  })

  it('時刻ありイベントは dates を UTC の Z 表記・スラッシュ区切りで組む', () => {
    const params = parseParams(buildGoogleCalendarUrl(baseInput()))
    expect(params.get('dates')).toBe('20260920T100000Z/20260920T120000Z')
  })

  it('終日イベントは dates を JST 日付・排他的翌日で組む', () => {
    const params = parseParams(
      buildGoogleCalendarUrl(
        baseInput({ isAllDay: true, start: jstDate(2026, 9, 20), end: jstDate(2026, 9, 21) }),
      ),
    )
    expect(params.get('dates')).toBe('20260920/20260921')
  })

  it('title を text に、location をそのまま渡す（URL の除去はしない）', () => {
    const params = parseParams(
      buildGoogleCalendarUrl(
        baseInput({ title: '懇親会 https://x.example', location: '会場 https://y.example' }),
      ),
    )
    expect(params.get('text')).toBe('懇親会 https://x.example')
    expect(params.get('location')).toBe('会場 https://y.example')
  })

  it('location が null なら location パラメータを付けない', () => {
    const params = parseParams(buildGoogleCalendarUrl(baseInput({ location: null })))
    expect(params.has('location')).toBe(false)
  })

  it('details はメモの後ろに詳細ページ URL の行を連結する', () => {
    const params = parseParams(buildGoogleCalendarUrl(baseInput({ memo: 'メモ本文' })))
    expect(params.get('details')).toBe('メモ本文\n詳細: https://calshare.example/abc123def456')
  })

  it('memo が null なら details は詳細ページ URL の行だけになる', () => {
    const params = parseParams(buildGoogleCalendarUrl(baseInput({ memo: null })))
    expect(params.get('details')).toBe('詳細: https://calshare.example/abc123def456')
  })

  it('memo が上限文字数ちょうどなら切り詰めない', () => {
    const memo = 'あ'.repeat(MAX_CALENDAR_DETAILS_LENGTH)
    const params = parseParams(buildGoogleCalendarUrl(baseInput({ memo })))
    expect(params.get('details')).toBe(`${memo}\n詳細: https://calshare.example/abc123def456`)
  })

  it('memo が上限を超えたら末尾に … を付けて切り詰め、詳細ページ URL は切り詰めの対象にしない', () => {
    const memo = 'あ'.repeat(MAX_CALENDAR_DETAILS_LENGTH + 1)
    const params = parseParams(buildGoogleCalendarUrl(baseInput({ memo })))
    const truncated = 'あ'.repeat(MAX_CALENDAR_DETAILS_LENGTH) + '…'
    expect(params.get('details')).toBe(`${truncated}\n詳細: https://calshare.example/abc123def456`)
  })
})
