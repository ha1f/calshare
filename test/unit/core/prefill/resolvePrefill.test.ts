import { describe, expect, it } from 'vitest'
import { resolvePrefill } from '../../../../src/core/prefill/resolvePrefill'
import { parseEventText } from '../../../../src/core/parse/parseEventText'
import type { ParseContext } from '../../../../src/core/parse/types'

const ctx: ParseContext = { now: new Date('2026-09-20T00:00:00.000Z') }

describe('resolvePrefill', () => {
  it('何もなければ空のトップ画面（auto）', () => {
    expect(resolvePrefill({}, ctx)).toEqual({ rawText: '', fields: {}, manualKeys: [] })
  })

  it('q のみなら parseEventText の結果を auto として返す（manualKeys は空）', () => {
    const q = '懇親会 9/21 19時〜21時 渋谷オフィス'
    const result = resolvePrefill({ q }, ctx)
    const parsed = parseEventText(q, ctx)
    expect(result.rawText).toBe(q)
    expect(result.manualKeys).toEqual([])
    expect(result.fields).toEqual({
      title: parsed.title,
      location: parsed.location,
      memo: parsed.memo,
      start: parsed.start,
      end: parsed.end,
      isAllDay: parsed.isAllDay,
    })
  })

  it('text だけなら title を manual として固定する', () => {
    const result = resolvePrefill({ text: '懇親会' }, ctx)
    expect(result.fields).toEqual({ title: '懇親会' })
    expect(result.manualKeys).toEqual(['title'])
    expect(result.rawText).toBe('懇親会')
  })

  it('location だけでも構造化パラメータとして扱う', () => {
    const result = resolvePrefill({ location: '渋谷オフィス' }, ctx)
    expect(result.fields).toEqual({ location: '渋谷オフィス' })
    expect(result.manualKeys).toEqual(['location'])
  })

  it('details だけでも構造化パラメータとして扱う', () => {
    const result = resolvePrefill({ details: 'メモです' }, ctx)
    expect(result.fields).toEqual({ memo: 'メモです' })
    expect(result.manualKeys).toEqual(['memo'])
  })

  it('text location details をすべて manual として固定する', () => {
    const result = resolvePrefill(
      { text: '懇親会', location: '渋谷オフィス', details: 'メモ' },
      ctx,
    )
    expect(result.fields).toEqual({ title: '懇親会', location: '渋谷オフィス', memo: 'メモ' })
    expect(result.manualKeys).toEqual(['title', 'location', 'memo'])
  })

  describe('dates パラメータ', () => {
    it('時刻ありが正しければ start / end / isAllDay を manual として固定する', () => {
      const result = resolvePrefill(
        { text: '懇親会', dates: '20260920T100000Z/20260920T120000Z' },
        ctx,
      )
      expect(result.fields).toEqual({
        title: '懇親会',
        start: new Date('2026-09-20T10:00:00.000Z'),
        end: new Date('2026-09-20T12:00:00.000Z'),
        isAllDay: false,
      })
      expect(result.manualKeys).toEqual(['title', 'start', 'end', 'isAllDay'])
    })

    it('終日（YYYYMMDD/YYYYMMDD）が正しければ isAllDay = true で固定する', () => {
      const result = resolvePrefill({ dates: '20260920/20260921' }, ctx)
      expect(result.fields).toEqual({
        start: new Date('2026-09-19T15:00:00.000Z'),
        end: new Date('2026-09-20T15:00:00.000Z'),
        isAllDay: true,
      })
      expect(result.manualKeys).toContain('isAllDay')
    })

    it('形式が壊れていれば無視する（issues 相当のものは出さず、他の項目だけ反映する）', () => {
      const result = resolvePrefill({ text: '懇親会', dates: 'invalid' }, ctx)
      expect(result.fields).toEqual({ title: '懇親会' })
      expect(result.manualKeys).toEqual(['title'])
    })

    it('存在しない日付（2 月 30 日）なら無視する', () => {
      const result = resolvePrefill({ text: '懇親会', dates: '20260230/20260301' }, ctx)
      expect(result.fields).toEqual({ title: '懇親会' })
      expect(result.manualKeys).toEqual(['title'])
    })

    it('存在しない時刻（25 時）なら無視する', () => {
      const result = resolvePrefill(
        { text: '懇親会', dates: '20260920T250000Z/20260920T260000Z' },
        ctx,
      )
      expect(result.fields).toEqual({ title: '懇親会' })
    })

    it('終了が開始以前なら無視する', () => {
      const result = resolvePrefill(
        { text: '懇親会', dates: '20260920T120000Z/20260920T100000Z' },
        ctx,
      )
      expect(result.fields).toEqual({ title: '懇親会' })
    })

    it('時刻ありと終日を混在させた形式は無視する', () => {
      const result = resolvePrefill({ text: '懇親会', dates: '20260920/20260921T100000Z' }, ctx)
      expect(result.fields).toEqual({ title: '懇親会' })
    })
  })

  it('構造化パラメータがあれば q は無視する（fields は q から作らない）', () => {
    const result = resolvePrefill({ text: '懇親会', q: '別の予定 9/22 10時' }, ctx)
    expect(result.fields).toEqual({ title: '懇親会' })
    expect(result.manualKeys).toEqual(['title'])
  })

  it('構造化パラメータと q が同時にあれば rawText も q を無視し text から組む', () => {
    const result = resolvePrefill({ text: '懇親会', q: '別の予定 9/22 10時' }, ctx)
    expect(result.rawText).toBe('懇親会')
  })

  it('構造化パラメータのみで text も無ければ rawText は空文字', () => {
    const result = resolvePrefill({ location: '渋谷' }, ctx)
    expect(result.rawText).toBe('')
  })

  describe('空文字・不正な構造化パラメータは無いものとして扱う', () => {
    it('text が空文字なら q の解釈結果を auto で返す', () => {
      const q = '懇親会 9/21 19時'
      const result = resolvePrefill({ text: '', q }, ctx)
      const parsed = parseEventText(q, ctx)
      expect(result.manualKeys).toEqual([])
      expect(result.fields.title).toBe(parsed.title)
    })

    it('location details が空文字なら何も無いのと同じ扱いにする', () => {
      const result = resolvePrefill({ location: '', details: '' }, ctx)
      expect(result).toEqual({ rawText: '', fields: {}, manualKeys: [] })
    })

    it('text が空白のみなら無視する', () => {
      const result = resolvePrefill({ text: '   ' }, ctx)
      expect(result).toEqual({ rawText: '', fields: {}, manualKeys: [] })
    })

    it('dates が壊れていて他の構造化パラメータも無ければ q の解釈結果を auto で返す', () => {
      const q = '懇親会 9/21 19時'
      const result = resolvePrefill({ dates: 'invalid', q }, ctx)
      const parsed = parseEventText(q, ctx)
      expect(result.manualKeys).toEqual([])
      expect(result.fields.title).toBe(parsed.title)
    })

    it('dates が同日終日（start === end）で無効になり他の構造化パラメータも無ければ q にフォールバックする', () => {
      const q = '懇親会 9/21 19時'
      const result = resolvePrefill({ dates: '20260920/20260920', q }, ctx)
      const parsed = parseEventText(q, ctx)
      expect(result.manualKeys).toEqual([])
      expect(result.fields.title).toBe(parsed.title)
    })
  })

  it('text に改行を含む場合は空白に変換して 1 行にする', () => {
    const result = resolvePrefill({ text: '懇親会\nメモ' }, ctx)
    expect(result.fields.title).toBe('懇親会 メモ')
    expect(result.rawText).toBe('懇親会 メモ')
    expect(result.rawText).not.toContain('\n')
  })
})
