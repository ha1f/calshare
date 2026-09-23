import { describe, expect, it } from 'vitest'
import { buildChangeSnapshot } from '../../../../src/core/change/buildChangeSnapshot'
import type { EventFields } from '../../../../src/core/types'
import { jstDate } from '../../../../src/core/time/jst'

function baseFields(overrides: Partial<EventFields> = {}): EventFields {
  return {
    title: '懇親会',
    location: '渋谷オフィス',
    memo: 'メモ',
    start: jstDate(2026, 9, 21, 19, 0),
    end: jstDate(2026, 9, 21, 21, 0),
    isAllDay: false,
    ...overrides,
  }
}

describe('buildChangeSnapshot', () => {
  it('メモだけの変更は null', () => {
    const previous = baseFields()
    const next = baseFields({ memo: '変更後のメモ' })
    expect(buildChangeSnapshot(previous, next)).toBeNull()
  })

  it('何も変わっていなければ null', () => {
    const previous = baseFields()
    const next = baseFields()
    expect(buildChangeSnapshot(previous, next)).toBeNull()
  })

  it('日時だけの変更は変更前の日時 + titleChanged = locationChanged = false', () => {
    const previous = baseFields()
    const next = baseFields({
      start: jstDate(2026, 9, 22, 19, 0),
      end: jstDate(2026, 9, 22, 21, 0),
    })
    expect(buildChangeSnapshot(previous, next)).toEqual({
      start: previous.start,
      end: previous.end,
      isAllDay: previous.isAllDay,
      titleChanged: false,
      locationChanged: false,
    })
  })

  it('タイトルだけの変更は titleChanged = true で日時は変更前の値', () => {
    const previous = baseFields()
    const next = baseFields({ title: '変更後のタイトル' })
    expect(buildChangeSnapshot(previous, next)).toEqual({
      start: previous.start,
      end: previous.end,
      isAllDay: previous.isAllDay,
      titleChanged: true,
      locationChanged: false,
    })
  })

  it('場所だけの変更は locationChanged = true', () => {
    const previous = baseFields()
    const next = baseFields({ location: '別会場' })
    const snapshot = buildChangeSnapshot(previous, next)
    expect(snapshot?.locationChanged).toBe(true)
    expect(snapshot?.titleChanged).toBe(false)
  })

  it('isAllDay だけの変更も日時の変更として扱う', () => {
    const previous = baseFields({
      isAllDay: true,
      start: jstDate(2026, 9, 21, 0, 0),
      end: jstDate(2026, 9, 22, 0, 0),
    })
    const next = { ...previous, isAllDay: false }
    const snapshot = buildChangeSnapshot(previous, next)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.isAllDay).toBe(true)
  })

  it('タイトル・日時・場所すべてが変わっても previous の日時を保持する', () => {
    const previous = baseFields()
    const next = baseFields({
      title: '新タイトル',
      location: '新会場',
      start: jstDate(2026, 9, 22, 19, 0),
      end: jstDate(2026, 9, 22, 21, 0),
    })
    expect(buildChangeSnapshot(previous, next)).toEqual({
      start: previous.start,
      end: previous.end,
      isAllDay: previous.isAllDay,
      titleChanged: true,
      locationChanged: true,
    })
  })

  it('location が null から値ありに変わっても locationChanged = true', () => {
    const previous = baseFields({ location: null })
    const next = baseFields({ location: '会場' })
    expect(buildChangeSnapshot(previous, next)?.locationChanged).toBe(true)
  })

  it('location が null から空文字に変わっても変更とみなさない', () => {
    const previous = baseFields({ location: null })
    const next = baseFields({ location: '' })
    expect(buildChangeSnapshot(previous, next)).toBeNull()
  })

  it('title の前後に空白が付いても変更とみなさない', () => {
    const previous = baseFields({ title: '懇親会' })
    const next = baseFields({ title: '懇親会 ' })
    expect(buildChangeSnapshot(previous, next)).toBeNull()
  })
})
