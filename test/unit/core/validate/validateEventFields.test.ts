import { describe, expect, it } from 'vitest'
import { countUrls, validateEventFields } from '../../../../src/core/validate/validateEventFields'
import type { EventFields } from '../../../../src/core/types'
import { jstDate } from '../../../../src/core/time/jst'
import {
  MAX_INPUT_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_MEMO_LENGTH,
  MAX_MEMO_URLS,
  MAX_TITLE_LENGTH,
} from '../../../../src/core/config/limits'

const NOW = jstDate(2026, 9, 20, 10, 0)

function baseFields(overrides: Partial<EventFields> = {}): EventFields {
  return {
    title: '懇親会',
    location: '渋谷オフィス',
    memo: null,
    start: jstDate(2026, 9, 21, 19, 0),
    end: jstDate(2026, 9, 21, 21, 0),
    isAllDay: false,
    ...overrides,
  }
}

describe('validateEventFields', () => {
  it('妥当な作成リクエストは ok', () => {
    expect(
      validateEventFields('懇親会 9/21 19時〜21時', baseFields(), NOW, { mode: 'create' }),
    ).toEqual({ ok: true })
  })

  it('日時の無い下書きは拒否しない', () => {
    const fields = baseFields({ start: null, end: null })
    expect(validateEventFields('懇親会だけ', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
  })

  describe('EMPTY_INPUT', () => {
    it('rawText が空白のみなら EMPTY_INPUT', () => {
      expect(validateEventFields('   ', baseFields(), NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'EMPTY_INPUT',
      })
    })

    it('title が空白のみなら EMPTY_INPUT', () => {
      const fields = baseFields({ title: '  ' })
      expect(validateEventFields('本文はある', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'EMPTY_INPUT',
      })
    })
  })

  describe('INPUT_TOO_LONG', () => {
    it('title が上限を超えたら INPUT_TOO_LONG', () => {
      const fields = baseFields({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INPUT_TOO_LONG',
      })
    })

    it('title がちょうど上限なら ok', () => {
      const fields = baseFields({ title: 'a'.repeat(MAX_TITLE_LENGTH) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })

    it('location が上限を超えたら INPUT_TOO_LONG', () => {
      const fields = baseFields({ location: 'a'.repeat(MAX_LOCATION_LENGTH + 1) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INPUT_TOO_LONG',
      })
    })

    it('memo が上限を超えたら INPUT_TOO_LONG', () => {
      const fields = baseFields({ memo: 'a'.repeat(MAX_MEMO_LENGTH + 1) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INPUT_TOO_LONG',
      })
    })

    it('location がちょうど上限なら ok', () => {
      const fields = baseFields({ location: 'a'.repeat(MAX_LOCATION_LENGTH) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })

    it('memo がちょうど上限なら ok', () => {
      const fields = baseFields({ memo: 'a'.repeat(MAX_MEMO_LENGTH) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })

    it('rawText が上限を超えたら INPUT_TOO_LONG', () => {
      const rawText = 'a'.repeat(MAX_INPUT_LENGTH + 1)
      expect(validateEventFields(rawText, baseFields(), NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INPUT_TOO_LONG',
      })
    })

    it('rawText がちょうど上限なら ok', () => {
      const rawText = 'a'.repeat(MAX_INPUT_LENGTH)
      expect(validateEventFields(rawText, baseFields(), NOW, { mode: 'create' })).toEqual({
        ok: true,
      })
    })

    it('絵文字はサロゲートペア 2 文字として数える', () => {
      const fields = baseFields({ title: '🎉'.repeat(200) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INPUT_TOO_LONG',
      })
    })
  })

  describe('INVALID_RANGE', () => {
    it('start だけ null なら INVALID_RANGE', () => {
      const fields = baseFields({ start: null })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })

    it('end だけ null なら INVALID_RANGE', () => {
      const fields = baseFields({ end: null })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })

    it('end <= start なら INVALID_RANGE', () => {
      const fields = baseFields({
        start: jstDate(2026, 9, 21, 21, 0),
        end: jstDate(2026, 9, 21, 19, 0),
      })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })

    it('end === start なら INVALID_RANGE', () => {
      const t = jstDate(2026, 9, 21, 19, 0)
      const fields = baseFields({ start: t, end: t })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })

    it('終日で開始が JST 00:00 でなければ INVALID_RANGE', () => {
      const fields = baseFields({
        isAllDay: true,
        start: jstDate(2026, 9, 21, 1, 0),
        end: jstDate(2026, 9, 22, 0, 0),
      })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })

    it('終日で終了が JST 00:00 でなければ INVALID_RANGE', () => {
      const fields = baseFields({
        isAllDay: true,
        start: jstDate(2026, 9, 21, 0, 0),
        end: jstDate(2026, 9, 22, 1, 0),
      })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })

    it('終日で開始・終了とも JST 00:00 なら ok', () => {
      const fields = baseFields({
        isAllDay: true,
        start: jstDate(2026, 9, 21, 0, 0),
        end: jstDate(2026, 9, 22, 0, 0),
      })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })

    it('start / end が Invalid Date なら INVALID_RANGE', () => {
      const fields = baseFields({ start: new Date(NaN), end: new Date(NaN) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INVALID_RANGE',
      })
    })
  })

  describe('PAST_EVENT', () => {
    it('作成時に end < now なら PAST_EVENT', () => {
      const fields = baseFields({
        start: jstDate(2026, 9, 1, 19, 0),
        end: jstDate(2026, 9, 1, 21, 0),
      })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'PAST_EVENT',
      })
    })

    it('更新時に日時を変更していなければ end < now でも ok', () => {
      const start = jstDate(2026, 9, 1, 19, 0)
      const end = jstDate(2026, 9, 1, 21, 0)
      const previous = baseFields({ start, end, memo: '編集前のメモ' })
      const fields = baseFields({
        start: jstDate(2026, 9, 1, 19, 0),
        end: jstDate(2026, 9, 1, 21, 0),
        memo: '編集後のメモ',
      })
      const result = validateEventFields('本文', fields, NOW, { mode: 'update', previous })
      expect(result).toEqual({ ok: true })
    })

    it('end === now なら ok（strict な過去判定は end < now のみ）', () => {
      const fields = baseFields({ start: jstDate(2026, 9, 20, 8, 0), end: NOW })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })

    it('end が now の 1ms 前なら PAST_EVENT', () => {
      const fields = baseFields({
        start: jstDate(2026, 9, 20, 8, 0),
        end: new Date(NOW.getTime() - 1),
      })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'PAST_EVENT',
      })
    })

    it('更新で下書き（日時未確定）から過去日時に変えると PAST_EVENT', () => {
      const previous = baseFields({ start: null, end: null })
      const fields = baseFields({
        start: jstDate(2026, 9, 1, 19, 0),
        end: jstDate(2026, 9, 1, 21, 0),
      })
      const result = validateEventFields('本文', fields, NOW, { mode: 'update', previous })
      expect(result).toEqual({ ok: false, code: 'PAST_EVENT' })
    })

    it('更新で日時ありから下書き（日時未確定）に変えると ok', () => {
      const previous = baseFields()
      const fields = baseFields({ start: null, end: null })
      const result = validateEventFields('本文', fields, NOW, { mode: 'update', previous })
      expect(result).toEqual({ ok: true })
    })

    it('更新時に日時を過去に変更すると PAST_EVENT', () => {
      const previous = baseFields()
      const fields = baseFields({
        start: jstDate(2026, 9, 1, 19, 0),
        end: jstDate(2026, 9, 1, 21, 0),
      })
      const result = validateEventFields('本文', fields, NOW, { mode: 'update', previous })
      expect(result).toEqual({ ok: false, code: 'PAST_EVENT' })
    })

    it('更新時に isAllDay だけ変えて日時が過去になっても PAST_EVENT（日時変更とみなす）', () => {
      const previous = baseFields({
        isAllDay: true,
        start: jstDate(2026, 9, 1, 0, 0),
        end: jstDate(2026, 9, 2, 0, 0),
      })
      const fields = { ...previous, isAllDay: false }
      const result = validateEventFields('本文', fields, NOW, { mode: 'update', previous })
      expect(result).toEqual({ ok: false, code: 'PAST_EVENT' })
    })
  })

  describe('BEYOND_MAX_LEAD_TIME', () => {
    it('13 ヶ月ちょうど先なら ok', () => {
      const start = jstDate(2027, 10, 20, 10, 0)
      const fields = baseFields({ start, end: new Date(start.getTime() + 60 * 60 * 1000) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })

    it('13 ヶ月 + 1 秒先なら BEYOND_MAX_LEAD_TIME', () => {
      const start = new Date(jstDate(2027, 10, 20, 10, 0).getTime() + 1000)
      const fields = baseFields({ start, end: new Date(start.getTime() + 60 * 60 * 1000) })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'BEYOND_MAX_LEAD_TIME',
      })
    })
  })

  describe('TOO_MANY_URLS', () => {
    it('URL が上限を超えたら TOO_MANY_URLS', () => {
      const urls = Array.from({ length: MAX_MEMO_URLS + 1 }, (_, i) => `https://${i}.example`).join(
        ' ',
      )
      const fields = baseFields({ memo: urls })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'TOO_MANY_URLS',
      })
    })

    it('URL がちょうど上限なら ok', () => {
      const urls = Array.from({ length: MAX_MEMO_URLS }, (_, i) => `https://${i}.example`).join(' ')
      const fields = baseFields({ memo: urls })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({ ok: true })
    })
  })

  describe('検証の順序', () => {
    it('EMPTY_INPUT は他のエラーより先に検出する', () => {
      const fields = baseFields({ title: '', start: null })
      expect(validateEventFields('', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'EMPTY_INPUT',
      })
    })

    it('INPUT_TOO_LONG は INVALID_RANGE より先に検出する', () => {
      const fields = baseFields({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1), start: null })
      expect(validateEventFields('本文', fields, NOW, { mode: 'create' })).toEqual({
        ok: false,
        code: 'INPUT_TOO_LONG',
      })
    })
  })
})

describe('countUrls', () => {
  it('URL が無ければ 0', () => {
    expect(countUrls(['懇親会', '渋谷オフィス', null])).toBe(0)
  })

  it('複数のテキストにまたがる URL を合計する', () => {
    expect(countUrls(['https://a.example', '会場は https://b.example です', null])).toBe(2)
  })

  it('null は無視する', () => {
    expect(countUrls([null, null, 'https://a.example'])).toBe(1)
  })

  it('1 つのテキスト中の複数 URL も数える', () => {
    expect(countUrls(['https://a.example と https://b.example', null, null])).toBe(2)
  })

  it('URL_PATTERN と同じ形式（www. 始まり・条件付きベアドメイン）を数える', () => {
    expect(countUrls(['www.example.com', 'example.com/path', 'ただの文章', null])).toBe(2)
  })
})
