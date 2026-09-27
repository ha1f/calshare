import { describe, expect, it } from 'vitest'
import { requireDefined } from '../../../../src/core/assert'
import { buildIcs } from '../../../../src/core/ics/buildIcs'
import type { IcsInput } from '../../../../src/core/ics/buildIcs'
import { jstDate } from '../../../../src/core/time/jst'

function baseInput(overrides: Partial<IcsInput> = {}): IcsInput {
  return {
    uid: 'abc123def456@calshare.example',
    title: '懇親会',
    location: '渋谷オフィス',
    memo: 'カジュアルな飲み会です',
    start: jstDate(2026, 9, 20, 19, 0),
    end: jstDate(2026, 9, 20, 21, 0),
    isAllDay: false,
    sequence: 0,
    generatedAt: new Date('2026-09-15T00:00:00.000Z'),
    detailUrl: 'https://calshare.example/abc123def456',
    ...overrides,
  }
}

// CRLF で折り返した行以外に裸の \n が無いことを検証する（改行は \r\n）
function expectNoLoneLineFeed(ics: string): void {
  expect(/(?<!\r)\n/.test(ics)).toBe(false)
}

// DESCRIPTION は折り返されることがあるので、継続行（先頭スペース）を連結して 1 つの値に戻す
function extractDescription(ics: string): string {
  const lines = ics.split('\r\n')
  const start = lines.findIndex((l) => l.startsWith('DESCRIPTION:'))
  if (start < 0) throw new Error('DESCRIPTION line not found')
  let description = requireDefined(lines[start], 'start is a valid index into lines').slice(
    'DESCRIPTION:'.length,
  )
  for (let i = start + 1; i < lines.length; i++) {
    const line = requireDefined(lines[i], 'i is a valid index into lines')
    if (!line.startsWith(' ')) break
    description += line.slice(1)
  }
  return description
}

describe('buildIcs', () => {
  it('固定プロパティ（VERSION / PRODID / CALSCALE / METHOD / STATUS）を出力する', () => {
    const ics = buildIcs(baseInput())
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('PRODID:-//calshare//calshare//JA')
    expect(ics).toContain('CALSCALE:GREGORIAN')
    expect(ics).toContain('METHOD:PUBLISH')
    expect(ics).toContain('STATUS:CONFIRMED')
    expectNoLoneLineFeed(ics)
  })

  it('UID / DTSTAMP / URL / SEQUENCE を入力からそのまま出す', () => {
    const ics = buildIcs(baseInput({ sequence: 3 }))
    expect(ics).toContain('UID:abc123def456@calshare.example')
    expect(ics).toContain('DTSTAMP:20260915T000000Z')
    expect(ics).toContain('URL:https://calshare.example/abc123def456')
    expect(ics).toContain('SEQUENCE:3')
  })

  it('時刻ありイベントは DTSTART / DTEND を UTC の Z 表記で出す', () => {
    const ics = buildIcs(baseInput())
    // JST 19:00 = UTC 10:00
    expect(ics).toContain('DTSTART:20260920T100000Z')
    expect(ics).toContain('DTEND:20260920T120000Z')
    expect(ics).not.toContain('VALUE=DATE')
  })

  it('終日イベントは DTSTART;VALUE=DATE / DTEND;VALUE=DATE を排他的翌日で出す', () => {
    const ics = buildIcs(
      baseInput({
        isAllDay: true,
        start: jstDate(2026, 9, 20),
        end: jstDate(2026, 9, 21), // 排他的翌日
      }),
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20260920')
    expect(ics).toContain('DTEND;VALUE=DATE:20260921')
    expect(ics).not.toContain('DTSTART:2026')
  })

  it('年をまたぐ終日イベントでも日付がずれない', () => {
    const ics = buildIcs(
      baseInput({
        isAllDay: true,
        start: jstDate(2026, 12, 31),
        end: jstDate(2027, 1, 2), // 12/31, 1/1 の 2 日間（排他的翌日）
      }),
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231')
    expect(ics).toContain('DTEND;VALUE=DATE:20270102')
  })

  it('時刻ありイベントは JST の年始でも UTC 表記では前年になる', () => {
    const ics = buildIcs(
      baseInput({
        start: jstDate(2027, 1, 1, 0, 30),
        end: jstDate(2027, 1, 1, 1, 30),
      }),
    )
    expect(ics).toContain('DTSTART:20261231T153000Z')
    expect(ics).toContain('DTEND:20261231T163000Z')
  })

  it('SUMMARY / LOCATION は sanitizeIcsText → escapeIcsText を経由する', () => {
    const ics = buildIcs(
      baseInput({
        title: '案内 https://spam.example/x のお知らせ;注意',
        location: '会場 https://spam2.example/y',
      }),
    )
    expect(ics).toContain('SUMMARY:案内 [リンク] のお知らせ\\;注意')
    expect(ics).toContain('LOCATION:会場 [リンク]')
    expect(ics).not.toContain('spam.example')
    expect(ics).not.toContain('spam2.example')
  })

  it('location が null なら LOCATION 行を出さない', () => {
    const ics = buildIcs(baseInput({ location: null }))
    expect(ics).not.toMatch(/^LOCATION:/m)
  })

  it('location が空文字でも LOCATION 行を出さない（null と同じ扱い）', () => {
    const ics = buildIcs(baseInput({ location: '' }))
    expect(ics).not.toMatch(/^LOCATION:/m)
  })

  it('memo が空文字なら DESCRIPTION は詳細 URL の行だけになる（null と同じ扱い）', () => {
    const ics = buildIcs(baseInput({ memo: '', detailUrl: 'https://calshare.example/xyz' }))
    expect(ics).toContain('DESCRIPTION:詳細はこちら: https://calshare.example/xyz')
  })

  it('title 中の URL に制御文字が挟まっていても、制御文字除去後の文字列を URL として検出し置換する', () => {
    const ics = buildIcs(baseInput({ title: `FREE http:${String.fromCharCode(1)}//evil.xyz` }))
    expect(ics).toContain('SUMMARY:FREE [リンク]')
    expect(ics).not.toContain('evil.xyz')
  })

  it('スキーム直後に余分な / があるリンクや www. 始まりの IDN リンクも DESCRIPTION から除かれ、自ドメインの URL だけが残る', () => {
    const ics = buildIcs(
      baseInput({
        memo: '怪しいリンク https:///evil.xyz と www.日本語.jp',
        detailUrl: 'https://calshare.example/abc123def456',
      }),
    )
    const description = extractDescription(ics)
    expect(description).not.toContain('evil.xyz')
    expect(description).not.toContain('日本語')
    expect(description.match(/calshare\.example/g)).toHaveLength(1)
  })

  it('DESCRIPTION はメモを sanitize した後に詳細 URL を連結し、自ドメインの URL は 1 本だけ残る', () => {
    const ics = buildIcs(
      baseInput({
        memo: '会費は https://pay.example/xyz から支払ってください',
        detailUrl: 'https://calshare.example/abc123def456',
      }),
    )
    const description = extractDescription(ics)
    expect(description).toContain('[リンク]')
    expect(description).toContain('詳細はこちら: https://calshare.example/abc123def456')
    expect(description.match(/pay\.example/g)).toBeNull()
    expect(description.match(/calshare\.example/g)).toHaveLength(1)
  })

  it('メモに自ドメインと同じ URL が含まれていても、メモ側は置換され詳細行だけが残る（連結してから sanitize していないことの確認）', () => {
    // メモを連結後にまとめて sanitize する誤実装だと、詳細行の URL も含めて自ドメインが 2 本とも残ってしまう
    const ics = buildIcs(
      baseInput({
        memo: '前回はこちら https://calshare.example/previous-page でした',
        detailUrl: 'https://calshare.example/abc123def456',
      }),
    )
    const description = extractDescription(ics)
    expect(description.match(/\[リンク\]/g)).toHaveLength(1)
    expect(description.match(/calshare\.example/g)).toHaveLength(1)
    expect(description).toContain('詳細はこちら: https://calshare.example/abc123def456')
  })

  it('memo が null なら DESCRIPTION は詳細 URL の行だけになる', () => {
    const ics = buildIcs(baseInput({ memo: null, detailUrl: 'https://calshare.example/xyz' }))
    expect(ics).toContain('DESCRIPTION:詳細はこちら: https://calshare.example/xyz')
  })

  it('生成しないプロパティ（ORGANIZER / ATTENDEE / ATTACH / X-ALT-DESC）を含まない', () => {
    const ics = buildIcs(baseInput())
    expect(ics).not.toMatch(/^(ORGANIZER|ATTENDEE|ATTACH|X-ALT-DESC)[:;]/m)
  })

  it('title / location に \\rATTACH: 等が混ざっても寛容なパーサへのプロパティ注入にならない', () => {
    const ics = buildIcs(
      baseInput({ title: '懇親会\rATTACH:evil', location: '会場\r\nATTENDEE:evil' }),
    )
    expect(ics).not.toMatch(/^(ORGANIZER|ATTENDEE|ATTACH|X-ALT-DESC)[:;]/m)
    expectNoLoneLineFeed(ics)
  })

  it('title / memo に U+0085・U+2028・U+2029 が混ざっても、それらを行区切りとする分割で行頭にプロパティ名が現れない', () => {
    const nel = String.fromCharCode(0x85)
    const lineSeparator = String.fromCharCode(0x2028)
    const paragraphSeparator = String.fromCharCode(0x2029)
    const ics = buildIcs(
      baseInput({
        title: ['懇親会', 'END:VEVENT', 'BEGIN:VEVENT', 'SUMMARY:spam'].join(lineSeparator),
        memo: ['x', 'ATTACH:y'].join(nel) + paragraphSeparator + 'ORGANIZER:z',
      }),
    )
    const lineBreakPattern = new RegExp(`[\\r\\n${nel}${lineSeparator}${paragraphSeparator}]`)
    const splitLines = ics.split(lineBreakPattern)
    const countStartingWith = (prefix: string) =>
      splitLines.filter((line) => line.startsWith(prefix)).length
    // BEGIN:VCALENDAR/VEVENT・END:VEVENT/VCALENDAR は buildIcs 自身が出す分でちょうど 2 行ずつ、
    // SUMMARY は 1 行のみのはず。U+0085・U+2028・U+2029 を行区切りとする分割でこれより増えていれば
    // 別イベントの追加が成立している。ORGANIZER / ATTACH は 1 行も現れてはならない
    expect(countStartingWith('BEGIN:')).toBe(2)
    expect(countStartingWith('END:')).toBe(2)
    expect(countStartingWith('SUMMARY:')).toBe(1)
    expect(countStartingWith('ORGANIZER:')).toBe(0)
    expect(countStartingWith('ATTACH:')).toBe(0)
  })

  it('uid / detailUrl に改行が混ざっていても、UID / URL 行から独立したプロパティ行を作らない', () => {
    const ics = buildIcs(
      baseInput({
        uid: 'x\r\nATTACH:y@h',
        detailUrl: 'https://h/\r\nATTACH:y',
      }),
    )
    expect(ics).toContain('UID:xATTACH:y@h')
    expect(ics).toContain('URL:https://h/ATTACH:y')
    expect(ics).not.toMatch(/^ATTACH[:;]/m)
    expectNoLoneLineFeed(ics)
  })

  it('改行は \\r\\n のみで、裸の \\n を含まない', () => {
    const ics = buildIcs(baseInput({ memo: '1行目\n2行目' }))
    expectNoLoneLineFeed(ics)
    // メモの改行はエスケープされた \n (バックスラッシュ + n) として残る
    expect(ics).toContain('1行目\\n2行目')
  })

  it('URL が長くなっても 75 オクテットで折り返す（マルチバイトの境界は切らない）', () => {
    const longDetailUrl = `https://calshare.example/${'a'.repeat(80)}`
    const ics = buildIcs(baseInput({ detailUrl: longDetailUrl }))
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(ics.replace(/\r\n /g, '')).toContain(`URL:${longDetailUrl}`)
  })

  it('75 オクテットを超える SUMMARY はマルチバイト境界で切らずに折り返す', () => {
    const title = '懇親会のご案内'.repeat(10)
    const ics = buildIcs(baseInput({ title }))
    const summaryLineIndex = ics.split('\r\n').findIndex((l) => l.startsWith('SUMMARY:'))
    expect(summaryLineIndex).toBeGreaterThanOrEqual(0)
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      const bytes = new TextEncoder().encode(line.startsWith(' ') ? line.slice(1) : line)
      expect(() =>
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
      ).not.toThrow()
    }
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`)
  })

  it('絵文字（4 オクテット文字）を含む SUMMARY も文字の途中で切らずに折り返す', () => {
    const title = '😀'.repeat(40)
    const ics = buildIcs(baseInput({ title }))
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`)
  })

  it('75 オクテットを超える LOCATION も折り返され、unfold すると元の値に戻る', () => {
    const location = '渋谷区道玄坂の貸し会議室'.repeat(5)
    const ics = buildIcs(baseInput({ location }))
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(ics.replace(/\r\n /g, '')).toContain(`LOCATION:${location}`)
  })
})
