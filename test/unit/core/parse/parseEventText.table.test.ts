import { describe, expect, it } from 'vitest'
import { addDays, jstDate } from '../../../../src/core/time/jst'
import { parseEventText } from '../../../../src/core/parse/parseEventText'
import type { ParseIssue } from '../../../../src/core/parse/types'

// 基準時刻: 2026-09-16(水) 10:00 JST（§5.6）
const NOW = jstDate(2026, 9, 16, 10, 0)

function dt(y: number, m: number, d: number, h = 0, mi = 0): Date {
  return jstDate(y, m, d, h, mi)
}

/** 同じ日の開始・終了時刻から { start, end, isAllDay: false } を作る */
function t(
  y: number,
  m: number,
  d: number,
  h1: number,
  mi1: number,
  h2: number,
  mi2: number,
): { start: Date; end: Date; isAllDay: false } {
  return { start: dt(y, m, d, h1, mi1), end: dt(y, m, d, h2, mi2), isAllDay: false }
}

/** 終日（複数日）予定の { start, end, isAllDay: true } を作る（end は開始日の翌日 00:00 JST） */
function allDayRange(
  y1: number,
  m1: number,
  d1: number,
  y2: number,
  m2: number,
  d2: number,
): { start: Date; end: Date; isAllDay: true } {
  return { start: jstDate(y1, m1, d1), end: addDays(jstDate(y2, m2, d2), 1), isAllDay: true }
}

interface Row {
  input: string
  title: string
  start: Date | null
  end: Date | null
  isAllDay: boolean
  location: string | null
  memo: string | null
  issues: ParseIssue[]
  singleTokenTitle: boolean
}

// § 5.6 テストケース表（全 71 件）。基準時刻は 2026-09-16(水) 10:00 JST
const rows: Row[] = [
  {
    input: '9/20 19時 渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19:00-21:00 渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 21, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9月20日(日)19:00〜21:00 渋谷で忘年会',
    title: '忘年会',
    ...t(2026, 9, 20, 19, 0, 21, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20(月) 19時 渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '19時から21時まで 新宿で勉強会 9/25',
    title: '勉強会',
    ...t(2026, 9, 25, 19, 0, 21, 0),
    location: '新宿',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時〜 渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 午後7時 飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 午前7時 集合',
    title: '集合',
    ...t(2026, 9, 20, 7, 0, 8, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 7時 飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 朝7時 集合',
    title: '集合',
    ...t(2026, 9, 20, 7, 0, 8, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 8時 朝礼',
    title: '朝礼',
    ...t(2026, 9, 20, 8, 0, 9, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 12時 ランチ',
    title: 'ランチ',
    ...t(2026, 9, 20, 12, 0, 13, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 午後12時 ランチ',
    title: 'ランチ',
    ...t(2026, 9, 20, 12, 0, 13, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 19時半 飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 30, 20, 30),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20(日) 19時30分〜21時 渋谷で女子会',
    title: '女子会',
    ...t(2026, 9, 20, 19, 30, 21, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 6時〜8時 飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 18, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 飲み会',
    title: '飲み会',
    ...allDayRange(2026, 9, 20, 2026, 9, 20),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20〜9/21 合宿',
    title: '合宿',
    ...allDayRange(2026, 9, 20, 2026, 9, 21),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20〜9/23 文化祭',
    title: '文化祭',
    ...allDayRange(2026, 9, 20, 2026, 9, 23),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '12/30〜1/3 帰省',
    title: '帰省',
    ...allDayRange(2026, 12, 30, 2027, 1, 3),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '明日15時から面談',
    title: '面談',
    ...t(2026, 9, 17, 15, 0, 16, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: 'あさって10時 歯医者',
    title: '歯医者',
    ...t(2026, 9, 18, 10, 0, 11, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '明後日 渋谷で打ち合わせ 10:00',
    title: '打ち合わせ',
    ...t(2026, 9, 18, 10, 0, 11, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '今日19時 反省会',
    title: '反省会',
    ...t(2026, 9, 16, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '来週月曜10時 会議室Aで定例MTG',
    title: '定例MTG',
    ...t(2026, 9, 21, 10, 0, 11, 0),
    location: '会議室A',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '今週金曜 渋谷で飲み会',
    title: '飲み会',
    ...allDayRange(2026, 9, 18, 2026, 9, 18),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '今週水曜19時 飲み会',
    title: '飲み会',
    ...t(2026, 9, 16, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '今週月曜19時 渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 21, 19, 0, 20, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '金曜19時〜 誰でも歓迎',
    title: '誰でも歓迎',
    ...t(2026, 9, 18, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '月曜19時 渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 21, 19, 0, 20, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '水曜19時 飲み会',
    title: '飲み会',
    ...t(2026, 9, 16, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '水曜8時 朝会',
    title: '朝会',
    ...t(2026, 9, 23, 8, 0, 9, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '20時から反省会',
    title: '反省会',
    ...t(2026, 9, 16, 20, 0, 21, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '8時から朝礼',
    title: '朝礼',
    ...t(2026, 9, 17, 8, 0, 9, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '3/1 卒業式',
    title: '卒業式',
    ...allDayRange(2027, 3, 1, 2027, 3, 1),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/15 打ち上げ',
    title: '打ち上げ',
    ...allDayRange(2027, 9, 15, 2027, 9, 15),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/16 8:00 朝会',
    title: '朝会',
    ...t(2026, 9, 16, 8, 0, 9, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/16 10:00〜11:00 本社で定例会議',
    title: '定例会議',
    ...t(2026, 9, 16, 10, 0, 11, 0),
    location: '本社',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '2024/3/1 卒業式',
    title: '卒業式',
    start: null,
    end: null,
    isAllDay: false,
    location: null,
    memo: null,
    issues: ['past_date'],
    singleTokenTitle: true,
  },
  {
    input: '2027年10月16日 総会',
    title: '総会',
    ...allDayRange(2027, 10, 16, 2027, 10, 16),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '2027/10/17 総会',
    title: '総会',
    start: null,
    end: null,
    isAllDay: false,
    location: null,
    memo: null,
    issues: ['beyond_max_lead_time'],
    singleTokenTitle: true,
  },
  {
    input: '12/31 23:00 忘年会',
    title: '忘年会',
    start: dt(2026, 12, 31, 23, 0),
    end: dt(2027, 1, 1, 0, 0),
    isAllDay: false,
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 23:00〜1:00 カラオケで打ち上げ',
    title: '打ち上げ',
    start: dt(2026, 9, 20, 23, 0),
    end: dt(2026, 9, 21, 1, 0),
    isAllDay: false,
    location: 'カラオケ',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '2/30 変な日付',
    title: '2/30 変な日付',
    start: null,
    end: null,
    isAllDay: false,
    location: null,
    memo: null,
    issues: ['invalid_date', 'no_datetime'],
    singleTokenTitle: false,
  },
  {
    input: '9/20 25時 集合',
    title: '25時 集合',
    ...allDayRange(2026, 9, 20, 2026, 9, 20),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '９／２０　１９時　渋谷で飲み会',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '渋谷',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時 渋谷',
    title: '渋谷',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 19時',
    title: '9月20日(日) 19:00〜20:00',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20',
    title: '9月20日(日)',
    ...allDayRange(2026, 9, 20, 2026, 9, 20),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '渋谷で忘年会',
    title: '忘年会',
    start: null,
    end: null,
    isAllDay: false,
    location: '渋谷',
    memo: null,
    issues: ['no_datetime'],
    singleTokenTitle: false,
  },
  {
    input: '飲み会やります',
    title: '飲み会やります',
    start: null,
    end: null,
    isAllDay: false,
    location: null,
    memo: null,
    issues: ['no_datetime'],
    singleTokenTitle: true,
  },
  {
    input: '9/20 19時〜21時 みんなで飲み会',
    title: 'みんなで飲み会',
    ...t(2026, 9, 20, 19, 0, 21, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 19時 オンラインで勉強会',
    title: '勉強会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: 'オンライン',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19:00〜21:00 渋谷区役所で飲み会 会費5000円、遅れる人は連絡',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 21, 0),
    location: '渋谷区役所',
    memo: '会費5000円、遅れる人は連絡',
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '会費5000円 19時から 渋谷区役所で説明会',
    title: '説明会',
    ...t(2026, 9, 16, 19, 0, 20, 0),
    location: '渋谷区役所',
    memo: '会費5000円',
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時 渋谷 忘年会',
    title: '渋谷 忘年会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時 忘年会、会費5000円',
    title: '忘年会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: '会費5000円',
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時 渋谷で飲み会 https://example.com/map',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '渋谷',
    memo: 'https://example.com/map',
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時 渋谷で飲み会\n会費5000円\n遅れる人は連絡',
    title: '飲み会',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '渋谷',
    memo: '会費5000円\n遅れる人は連絡',
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20と10/5どちらか 渋谷で検討会',
    title: '検討会',
    ...allDayRange(2026, 9, 20, 2026, 9, 20),
    location: '渋谷',
    memo: 'と10/5どちらか',
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9.20 19:00 飲み会',
    title: '9.20 飲み会',
    ...t(2026, 9, 16, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '',
    title: '',
    start: null,
    end: null,
    isAllDay: false,
    location: null,
    memo: null,
    issues: ['no_datetime'],
    singleTokenTitle: false,
  },
  {
    input: '9/20 7:00 集合',
    title: '集合',
    ...t(2026, 9, 20, 7, 0, 8, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 10時〜2時 作業',
    title: '作業',
    ...t(2026, 9, 20, 10, 0, 14, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 19時〜7時 徹夜作業',
    title: '徹夜作業',
    start: dt(2026, 9, 20, 19, 0),
    end: dt(2026, 9, 21, 7, 0),
    isAllDay: false,
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 23時〜1時 打ち上げ',
    title: '打ち上げ',
    start: dt(2026, 9, 20, 23, 0),
    end: dt(2026, 9, 21, 1, 0),
    isAllDay: false,
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '9/20 6:00〜8:00 早朝ラン',
    title: '早朝ラン',
    ...t(2026, 9, 20, 6, 0, 8, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '今週水曜8時 朝会',
    title: '朝会',
    ...t(2026, 9, 23, 8, 0, 9, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
  {
    input: '2/29 うるう日',
    title: '2/29 うるう日',
    start: null,
    end: null,
    isAllDay: false,
    location: null,
    memo: null,
    issues: ['invalid_date', 'no_datetime'],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時 車で移動',
    title: '移動',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: '車',
    memo: null,
    issues: [],
    singleTokenTitle: false,
  },
  {
    input: '9/20 19時〜8時 夜勤',
    title: '夜勤',
    ...t(2026, 9, 20, 19, 0, 20, 0),
    location: null,
    memo: null,
    issues: [],
    singleTokenTitle: true,
  },
]

describe.each(rows)('parseEventText: $input', (row) => {
  it('§5.6 の期待値どおりに解釈する', () => {
    const result = parseEventText(row.input, { now: NOW })
    expect(result.title).toBe(row.title)
    expect(result.start).toEqual(row.start)
    expect(result.end).toEqual(row.end)
    expect(result.isAllDay).toBe(row.isAllDay)
    expect(result.location).toBe(row.location)
    expect(result.memo).toBe(row.memo)
    expect(result.issues).toEqual(row.issues)
    expect(result.singleTokenTitle).toBe(row.singleTokenTitle)
  })
})

describe('URL のハイフンを壊さない（§5.2 手順 2・3 の順序）', () => {
  it('範囲記号への統一より前に URL を取り除くので、パス中のハイフンはそのまま残る', () => {
    const result = parseEventText('9/20 19時 渋谷で飲み会 https://example.com/a-b', { now: NOW })
    expect(result.memo).toBe('https://example.com/a-b')
  })
})

describe('範囲記号の統一は日付・時刻の検出時にだけ行う（§5.2 手順 2）', () => {
  it('タイトル中のハイフンは書き換えない（電話番号）', () => {
    const result = parseEventText('9/20 19時 渋谷で飲み会 連絡先03-1234-5678', { now: NOW })
    expect(result.memo).toBe('連絡先03-1234-5678')
  })

  it('タイトル中のハイフンは書き換えない（英語表記）', () => {
    const result = parseEventText('9/20 19時 Re-union', { now: NOW })
    expect(result.title).toBe('Re-union')
  })
})

describe('レビュー指摘の反例（T2）', () => {
  it('D1: うるう年の翌年繰り上げ先にも 2/29 が無ければ invalid_date', () => {
    const now2028 = jstDate(2028, 3, 1, 1, 0)
    const result = parseEventText('2/29 うるう日', { now: now2028 })
    expect(result.start).toBeNull()
    expect(result.issues).toEqual(['invalid_date', 'no_datetime'])
  })

  it('曜日カッコの中身は曜日・祝に限るので、カッコ内の時刻表記まで飲み込まない', () => {
    const result = parseEventText('9/20(19時〜) 渋谷で飲み会', { now: NOW })
    expect(result.title).toBe('飲み会')
    expect(result.location).toBe('渋谷')
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
    // カッコ自体は日付・時刻のどちらでもないため文字として残る
    expect(result.memo).toBe('( )')
  })

  it('曜日カッコの中身が曜日でなければカッコごと残す（データは失わない）', () => {
    const result = parseEventText('9/20(渋谷駅集合 19時) 飲み会', { now: NOW })
    expect(result.title).toBe('(渋谷駅集合 ) 飲み会')
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
  })

  it('数字列の途中の invalid_date に惑わされず、後続の正しい日付・時刻を採用する', () => {
    const result = parseEventText('会費3000/5000円 9/20 19時 飲み会', { now: NOW })
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
    expect(result.issues).toEqual([])
  })

  it('D6/D7: 最初の日付が invalid でも後続に有効な日付があれば採用する', () => {
    const result = parseEventText('2/30 or 3/1 飲み会', { now: NOW })
    expect(result.isAllDay).toBe(true)
    expect(result.start).toEqual(jstDate(2027, 3, 1))
    expect(result.issues).toEqual([])
  })

  it('T6: 最初の時刻が不正でも後続に有効な時刻があれば採用する', () => {
    const result = parseEventText('9/20 25時ではなく 19時 集合', { now: NOW })
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
  })

  it('`年/月` だけの不完全な表記は日付として検出しない', () => {
    const result = parseEventText('2026/9 総会', { now: NOW })
    expect(result.title).toBe('2026/9 総会')
    expect(result.issues).toEqual(['no_datetime'])
  })

  it('L1: 「19時まで」単独でも「まで」を時刻側で消費し、場所として誤検出しない', () => {
    const result = parseEventText('9/20 19時まで 受付', { now: NOW })
    expect(result.title).toBe('受付')
    expect(result.location).toBeNull()
  })

  it('L1: 「から」の後に空白があっても範囲として解決し、場所を誤検出しない', () => {
    const result = parseEventText('9/20 19時から 21時まで 飲み会', { now: NOW })
    expect(result.title).toBe('飲み会')
    expect(result.location).toBeNull()
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
    expect(result.end).toEqual(dt(2026, 9, 20, 21, 0))
  })

  it.each([
    ['9/20 19時 飲み会です', '飲み会です'],
    ['9/20 19時 参加できる人だけ', '参加できる人だけ'],
    ['9/20 19時 渋谷では飲み会', '渋谷では飲み会'],
  ])('L1: 「%s」の「で」は「です・でき・では」の一部で区切りにしない', (input, title) => {
    const result = parseEventText(input, { now: NOW })
    expect(result.title).toBe(title)
    expect(result.location).toBeNull()
  })

  it('L2: ストップワードを除いた直後から次の場所候補を探す', () => {
    const result = parseEventText('9/20 19時 みんなで渋谷で飲み会', { now: NOW })
    expect(result.location).toBe('渋谷')
    expect(result.title).toBe('飲み会')
    expect(result.memo).toBe('みんなで')
  })

  it('T6: 範囲の終了だけが不正なら、開始も含めてトークンごと消費しない（既知の挙動）', () => {
    const result = parseEventText('9/20 19時〜25時 飲み会', { now: NOW })
    expect(result.title).toBe('19時〜25時 飲み会')
    expect(result.isAllDay).toBe(true)
    expect(result.start).toEqual(jstDate(2026, 9, 20))
  })

  it('「2時間」は所要時間であって時刻ではないので終日扱いになる', () => {
    const result = parseEventText('9/20 飲み会 2時間くらい', { now: NOW })
    expect(result.title).toBe('飲み会 2時間くらい')
    expect(result.isAllDay).toBe(true)
  })

  it('「19:00:00」の秒は読み飛ばす', () => {
    const result = parseEventText('9/20 19:00:00 飲み会', { now: NOW })
    expect(result.title).toBe('飲み会')
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
  })

  it('ゼロ幅スペースは空白として扱い、日付と時刻がくっつかない', () => {
    const zwsp = String.fromCharCode(0x200b)
    const result = parseEventText(`9/20${zwsp}19時 飲み会`, { now: NOW })
    expect(result.title).toBe('飲み会')
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
  })
})

describe('改行の正規化と先頭の空行（§5.2 手順 1）', () => {
  it('CRLF は LF と同様に扱い、\\r を残さない', () => {
    const result = parseEventText('9/20 19時 渋谷で飲み会\r\n会費5000円\r\n遅れる人は連絡', {
      now: NOW,
    })
    expect(result.memo).toBe('会費5000円\n遅れる人は連絡')
  })

  it('先頭が空行でも、最初の空でない行をパース対象にする', () => {
    const result = parseEventText('\n9/20 19時 飲み会', { now: NOW })
    expect(result.title).toBe('飲み会')
    expect(result.start).toEqual(dt(2026, 9, 20, 19, 0))
  })
})
