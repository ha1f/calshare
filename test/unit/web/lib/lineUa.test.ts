import { describe, expect, it } from 'vitest'
import {
  addOpenExternalBrowserParam,
  isAndroidUserAgent,
  isLineUserAgent,
} from '../../../../src/web/lib/lineUa'

describe('isLineUserAgent', () => {
  it('Line/ を含む UA を LINE と判定する', () => {
    expect(
      isLineUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 Line/14.0.0'),
    ).toBe(true)
  })

  it('含まない UA は LINE と判定しない', () => {
    expect(isLineUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false)
  })
})

describe('isAndroidUserAgent', () => {
  it('Android を含む UA を判定する', () => {
    expect(isAndroidUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(true)
  })

  it('含まない UA は判定しない', () => {
    expect(isAndroidUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false)
  })
})

describe('addOpenExternalBrowserParam', () => {
  it('既存のクエリ（action=TEMPLATE）を壊さず openExternalBrowser=1 を付ける', () => {
    const href =
      'https://calendar.google.com/calendar/render?action=TEMPLATE&dates=20260920T100000Z%2F20260920T110000Z'

    const result = addOpenExternalBrowserParam(href)
    const url = new URL(result)

    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('dates')).toBe('20260920T100000Z/20260920T110000Z')
    expect(url.searchParams.get('openExternalBrowser')).toBe('1')
  })

  it('クエリの無い URL にも付けられる（ics リンク）', () => {
    const result = addOpenExternalBrowserParam('https://example.com/abc123def456.ics')

    expect(new URL(result).searchParams.get('openExternalBrowser')).toBe('1')
  })
})
