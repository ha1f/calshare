import { describe, expect, it } from 'vitest'
import { fromEventFieldsJson, toEventFieldsJson } from '../../../src/core/types'
import type { EventFields, EventFieldsJson } from '../../../src/core/types'

describe('toEventFieldsJson / fromEventFieldsJson', () => {
  it('往復して同じ値に戻る（日時あり）', () => {
    const fields: EventFields = {
      title: '飲み会',
      location: '渋谷',
      memo: '会費5000円',
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
    }
    expect(fromEventFieldsJson(toEventFieldsJson(fields))).toEqual(fields)
  })

  it('往復して同じ値に戻る（日時なし・下書き）', () => {
    const fields: EventFields = {
      title: '飲み会',
      location: null,
      memo: null,
      start: null,
      end: null,
      isAllDay: false,
    }
    expect(fromEventFieldsJson(toEventFieldsJson(fields))).toEqual(fields)
  })

  it('toEventFieldsJson は Date を ISO8601 文字列にする', () => {
    const fields: EventFields = {
      title: '飲み会',
      location: null,
      memo: null,
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: null,
      isAllDay: false,
    }
    expect(toEventFieldsJson(fields).start).toBe('2026-09-20T10:00:00.000Z')
    expect(toEventFieldsJson(fields).end).toBeNull()
  })

  it('fromEventFieldsJson は不正な日時文字列で例外を投げる', () => {
    const json: EventFieldsJson = {
      title: '飲み会',
      location: null,
      memo: null,
      start: 'not-a-date',
      end: null,
      isAllDay: false,
    }
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は ISO8601 の形でない日時文字列（new Date には寛容な形）で例外を投げる', () => {
    const json: EventFieldsJson = {
      title: '飲み会',
      location: null,
      memo: null,
      start: '2026/9/20',
      end: null,
      isAllDay: false,
    }
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は暦に存在しない日付（2/30）で例外を投げる', () => {
    const json: EventFieldsJson = {
      title: '飲み会',
      location: null,
      memo: null,
      start: '2026-02-30T00:00:00Z',
      end: null,
      isAllDay: false,
    }
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は存在しない時刻（24:00）で例外を投げる', () => {
    const json: EventFieldsJson = {
      title: '飲み会',
      location: null,
      memo: null,
      start: '2026-09-20T24:00:00Z',
      end: null,
      isAllDay: false,
    }
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は Z 以外のオフセット付き日時（+09:00）で例外を投げる', () => {
    const json: EventFieldsJson = {
      title: '飲み会',
      location: null,
      memo: null,
      start: '2026-09-20T19:00:00+09:00',
      end: null,
      isAllDay: false,
    }
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は title が文字列でなければ例外を投げる', () => {
    const json = {
      title: 123,
      location: null,
      memo: null,
      start: null,
      end: null,
      isAllDay: false,
    } as unknown as EventFieldsJson
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は title が欠落していれば例外を投げる', () => {
    const json = {
      location: null,
      memo: null,
      start: null,
      end: null,
      isAllDay: false,
    } as unknown as EventFieldsJson
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は location / memo が非文字列（null 以外）なら例外を投げる', () => {
    const json = {
      title: '飲み会',
      location: 42,
      memo: null,
      start: null,
      end: null,
      isAllDay: false,
    } as unknown as EventFieldsJson
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('fromEventFieldsJson は isAllDay が boolean でなければ例外を投げる', () => {
    const json = {
      title: '飲み会',
      location: null,
      memo: null,
      start: null,
      end: null,
      isAllDay: 'false',
    } as unknown as EventFieldsJson
    expect(() => fromEventFieldsJson(json)).toThrow()
  })

  it('型レベル: EventFieldsJson の Date | null フィールドは string | null になる', () => {
    // Jsonified<T> は後続 PR（CreatePageRequest 等、§11.3）が前提にする型なので、
    // 分岐が意図通りかを tsc（tsconfig.server.json に本ファイルが含まれる）で固定する
    const json: EventFieldsJson = {
      title: '飲み会',
      location: null,
      memo: null,
      start: null,
      end: null,
      isAllDay: false,
    }
    const start: string | null = json.start
    const isAllDay: boolean = json.isAllDay
    expect(start).toBeNull()
    expect(isAllDay).toBe(false)

    // @ts-expect-error start は ISO8601 文字列のみを受け付け、Date は受け付けない
    const rejected: EventFieldsJson = { ...json, start: new Date() }
    expect(rejected).toBeDefined()
  })
})
