import { describe, expect, it } from 'vitest'
import { MAX_MEMO_LENGTH } from '../../../../src/core/config/limits'
import {
  replaceUrls,
  replaceUrlsWide,
  URL_PATTERN,
  WIDE_URL_PATTERN,
} from '../../../../src/core/text/urlPattern'

function matchAll(text: string): string[] {
  return Array.from(text.matchAll(new RegExp(URL_PATTERN.source, URL_PATTERN.flags)), (m) => m[0])
}

function matchAllWide(text: string): string[] {
  return Array.from(
    text.matchAll(new RegExp(WIDE_URL_PATTERN.source, WIDE_URL_PATTERN.flags)),
    (m) => m[0],
  )
}

describe('URL_PATTERN', () => {
  it('scheme 付き（https?://）に一致する', () => {
    expect(matchAll('見て https://example.com/map です')).toEqual(['https://example.com/map'])
    expect(matchAll('http://example.com')).toEqual(['http://example.com'])
  })

  it('www. 始まりに一致する', () => {
    expect(matchAll('www.example.com を見て')).toEqual(['www.example.com'])
  })

  it('ベアドメイン: パスが続く形に一致する', () => {
    expect(matchAll('example.xyz/path を見て')).toEqual(['example.xyz/path'])
  })

  it('ベアドメイン: 末尾ラベルが許可 TLD の形に一致する', () => {
    expect(matchAll('example.com を見て')).toEqual(['example.com'])
    expect(matchAll('example.co.jp を見て')).toEqual(['example.co.jp'])
    expect(matchAll('bit.ly のリンク')).toEqual(['bit.ly'])
  })

  it('末尾ラベルが英字 2 文字以上というだけでは一致しない（製品名の誤検出を避ける）', () => {
    expect(matchAll('Node.js 勉強会')).toEqual([])
    expect(matchAll('Vue.js Next.js の話')).toEqual([])
  })

  it('数字だけの区切りはドメインにしない', () => {
    expect(matchAll('9.20 に集合')).toEqual([])
  })

  it('hxxps:// のような難読化表記には一致しない', () => {
    expect(matchAll('hxxps://example.com を見て')).toEqual([])
  })

  it('難読化された scheme の直後の www. も一致しない', () => {
    expect(matchAll('hxxp://www.evil.com を見て')).toEqual([])
  })

  it('www. のホスト名は ASCII の語に限る（日本語には一致しない）', () => {
    expect(matchAll('www.渋谷 の話')).toEqual([])
  })

  it('許可 TLD の直後に英数字が続く場合は一致しない（example.company の company を誤って切らない）', () => {
    expect(matchAll('example.company の話')).toEqual([])
  })

  it('`/` 無しのクエリ・フラグメントも含めて一致する（パスが無いと途中で切れてしまうため）', () => {
    expect(matchAll('www.example.com?q=1 集合')).toEqual(['www.example.com?q=1'])
    expect(matchAll('www.example.com#map です')).toEqual(['www.example.com#map'])
    expect(matchAll('example.com?q=1 集合')).toEqual(['example.com?q=1'])
  })

  it('1 行に複数の URL があればすべて一致する', () => {
    expect(matchAll('https://a.example.com と https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })

  it('ftp:// のような http(s) 以外のスキームには一致しない', () => {
    expect(matchAll('ftp://evil.com/x を見て')).toEqual([])
  })
})

describe('URL_PATTERN: 長い入力での性能', () => {
  // ドットや `-` が連続する入力は、開始位置ごとに末尾までなめる走査になると O(n^2) になる（§5.1）
  matchAll('a.') // 正規表現の JIT コンパイルをウォームアップしておく

  it.each([
    ['a. を 1000 回繰り返す', 'a.'.repeat(1000)],
    ['-. を 1000 回繰り返す', '-.'.repeat(1000)],
  ])('%s（2,000 文字）が 50ms 以内に返る', (_label, input) => {
    const start = performance.now()
    matchAll(input)
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('a. を 10000 回繰り返しても（20,000 文字）50ms 以内に返る', () => {
    const input = 'a.'.repeat(10000)
    const start = performance.now()
    matchAll(input)
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('replaceUrls', () => {
  it('一致した URL をすべて置換する', () => {
    expect(replaceUrls('https://example.com/map で待ち合わせ', '[リンク]')).toBe(
      '[リンク] で待ち合わせ',
    )
  })

  it('URL が無ければそのまま返す', () => {
    expect(replaceUrls('渋谷で飲み会', '[リンク]')).toBe('渋谷で飲み会')
  })

  it('繰り返し呼んでも lastIndex の状態を引きずらない', () => {
    expect(replaceUrls('https://a.example.com', '[リンク]')).toBe('[リンク]')
    expect(replaceUrls('https://b.example.com', '[リンク]')).toBe('[リンク]')
  })
})

describe('WIDE_URL_PATTERN', () => {
  it('URL_PATTERN の 3 形式にも一致する', () => {
    expect(matchAllWide('https://example.com/map です')).toEqual(['https://example.com/map'])
    expect(matchAllWide('www.example.com を見て')).toEqual(['www.example.com'])
    expect(matchAllWide('example.com を見て')).toEqual(['example.com'])
  })

  it('難読化された scheme（hxxps://）はスキームとして扱わないが、ホスト部はベアドメインとして一致する', () => {
    expect(matchAllWide('hxxps://evil.com を見て')).toEqual(['evil.com'])
  })

  it('ftp などの http(s) 以外のスキームでも、ホスト部はベアドメインとして一致する', () => {
    expect(matchAllWide('ftp://evil.com/x を見て')).toEqual(['evil.com/x'])
  })

  it('IDN（日本語ドメイン）を含む https:// リンクに一致する', () => {
    expect(matchAllWide('https://例え.日本/x を見て')).toEqual(['https://例え.日本/x'])
  })

  it('userinfo・ポート・IPv6 リテラルを含む URL に一致する', () => {
    expect(matchAllWide('https://user:pw@evil.com/x')).toEqual(['https://user:pw@evil.com/x'])
    expect(matchAllWide('http://[::1]/a')).toEqual(['http://[::1]/a'])
  })

  it('ホストが記号カテゴリの文字で書かれていても、受け皿としてスキーム以降全体に一致する', () => {
    expect(matchAllWide('https://ⓔⓥⓘⓛ.com')).toEqual(['https://ⓔⓥⓘⓛ.com'])
  })

  it('日本語文の直後のドット区切りドメインにも一致する', () => {
    expect(matchAllWide('受付終了.evil.com')).toEqual(['evil.com'])
  })

  it('`//` から始まる scheme 省略の URL は、ホスト部だけベアドメインとして一致する', () => {
    expect(matchAllWide('//evil.xyz/a を見て')).toEqual(['evil.xyz/a'])
  })

  it('別の分岐がホストの途中（ポート番号の数字）で終わっても、続く文字列を別のベアドメインとして取りこぼさない', () => {
    // scheme 分岐は URL_TAIL のポートで `https://x:1` までしか消費しないため、続く `evil.com/path` を
    // ベアドメイン分岐が拾えないと外部リンクが本文に残る（§7.2 の外部リンク 0 本が崩れる）
    expect(matchAllWide('https://x:1evil.com/path を見て')).toEqual([
      'https://x:1',
      'evil.com/path',
    ])
  })

  it('カンマ区切りで並ぶ 2 つの URL は、それぞれ別の URL として一致する', () => {
    // scheme 分岐のパス文字（WIDE_URL_CHARS）はカンマを含まないため、1 つ目はカンマの手前で終わる
    expect(matchAllWide('https://evil.com/x,www.evil2.com')).toEqual([
      'https://evil.com/x',
      'www.evil2.com',
    ])
  })

  it('許可 TLD のベアドメイン直後に scheme 付き URL が続いても、ベアドメイン部分を取りこぼさない', () => {
    // TLD 直後が単語文字だとベアドメイン分岐は失敗するが、続く文字列が scheme か www. なら
    // そこで区切って良い（TLD の一部を装った別ホストではないため）。ここを塞がないと、
    // 置換後に残ったベアドメインが URL_PATTERN に再一致してしまう（§7.2 の外部リンク 0 本が崩れる）
    expect(matchAllWide('evil.comhttps://x')).toEqual(['evil.com', 'https://x'])
    expect(matchAllWide('evil.jphttp://x.com')).toEqual(['evil.jp', 'http://x.com'])
  })
})

describe('WIDE_URL_PATTERN: 長い入力での性能', () => {
  // ベアドメイン分岐は中間ラベルの繰り返し回数に上限を設け、ドット区切りの繰り返しでの
  // O(n^2) を防いでいる（ドットを含まない単語文字の連続には別途下の性能テストで固定する）
  matchAllWide('a.') // JIT ウォームアップ

  it.each([
    ['a. を 1000 回繰り返す', 'a.'.repeat(1000)],
    ['-. を 1000 回繰り返す', '-.'.repeat(1000)],
  ])('%s（2,000 文字）が 50ms 以内に返る', (_label, input) => {
    const start = performance.now()
    matchAllWide(input)
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('a. を 10000 回繰り返しても（20,000 文字）50ms 以内に返る', () => {
    const input = 'a.'.repeat(10000)
    const start = performance.now()
    matchAllWide(input)
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('中間ラベルが上限を超えるホストは末尾側だけ一致し、残りに URL_PATTERN の一致は無い', () => {
    // WIDE_BARE_DOMAIN_MAX_LABELS（20）を超える中間ラベルは先頭側が本文に残るが、TLD を
    // 含まないため URL_PATTERN には再一致しない
    const input = `${'a.'.repeat(25)}com`
    expect(matchAllWide(input)).toEqual([`${'a.'.repeat(21)}com`])
    expect(matchAll(replaceUrlsWide(input, '[リンク]'))).toEqual([])
  })

  it('ドットを含まない単語文字の繰り返し（MAX_MEMO_LENGTH 相当の文字数）も 50ms 以内に返る', () => {
    // 中間ラベルの繰り返し回数の上限はドット区切りの入力にしか効かない。ドットを含まない
    // 単語文字の連続（`[\w-]+` 単体）は依然として開始位置ごとに O(n) の走査になり得るため、
    // MAX_MEMO_LENGTH の範囲に収まることをここで固定する
    const input = 'a'.repeat(MAX_MEMO_LENGTH)
    const start = performance.now()
    matchAllWide(input)
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('replaceUrlsWide', () => {
  it('一致した URL をすべて置換する', () => {
    expect(replaceUrlsWide('https://example.com/map で待ち合わせ', '[リンク]')).toBe(
      '[リンク] で待ち合わせ',
    )
  })

  it('URL が無ければそのまま返す', () => {
    expect(replaceUrlsWide('渋谷で飲み会', '[リンク]')).toBe('渋谷で飲み会')
  })

  it('繰り返し呼んでも lastIndex の状態を引きずらない', () => {
    expect(replaceUrlsWide('https://a.example.com', '[リンク]')).toBe('[リンク]')
    expect(replaceUrlsWide('https://b.example.com', '[リンク]')).toBe('[リンク]')
  })
})

describe('URL_PATTERN と WIDE_URL_PATTERN の本数の一致', () => {
  // ASCII の scheme 付き／www./ベアドメインだけの通常入力では、抽出用（URL_PATTERN）と
  // 置換用（WIDE_URL_PATTERN）の一致本数は一致する。作成時に数える URL 本数（MAX_MEMO_URLS、§9.2）と
  // ics で置換される本数がずれない範囲はここまでで、IDN 等の非対称ケースは別に固定する
  it.each([
    ['https://example.com/map です', 1],
    ['www.example.com を見て', 1],
    ['example.com bit.ly example.xyz/path', 3],
    ['https://a.example.com と https://b.example.com', 2],
    ['渋谷で飲み会', 0],
  ])('%s の一致本数が一致する', (input, expectedCount) => {
    expect(matchAll(input)).toHaveLength(expectedCount)
    expect(matchAllWide(input)).toHaveLength(expectedCount)
  })

  it('WIDE_URL_PATTERN は URL_PATTERN の上位集合で、置換後の文字列に URL_PATTERN の一致は残らない', () => {
    // ここでの入力は「作成時に URL_PATTERN が数えた URL が、ics 上では必ず消える」ことを固定する
    // ためのものなので、置換前から URL_PATTERN に一致しない入力（ftp:// や hxxps:// 等の非対称
    // ケース）を混ぜると、置換しなくても通ってしまう空のアサーションになる。前提として置換前に
    // 一致が 1 件以上あることを確認する
    const inputs = [
      'https://example.com/map です',
      'https://例え.日本/x を見て',
      'https://user:pw@evil.com/x',
      'https://evil.com/x,www.evil2.com',
      'https://exａmple.com/x',
      'https://x:1evil.com/path',
      'evil.comhttps://x',
      'evil.jphttp://x.com',
      'a.comWWW.evil.com',
      'example.com?q=1',
      `${'l.'.repeat(25)}com`,
    ]
    for (const input of inputs) {
      expect(matchAll(input).length).toBeGreaterThan(0)
      expect(matchAll(replaceUrlsWide(input, '[リンク]'))).toEqual([])
    }
  })

  it('非 ASCII ホストや他スキームでは WIDE_URL_PATTERN の方が本数が多くなる（既知の非対称性、§5.2）', () => {
    expect(matchAll('www.日本語.jp')).toHaveLength(0)
    expect(matchAllWide('www.日本語.jp')).toHaveLength(1)

    expect(matchAll('ftp://evil.com/x')).toHaveLength(0)
    expect(matchAllWide('ftp://evil.com/x')).toHaveLength(1)

    // URL_PATTERN の scheme 分岐（`https?:\/\/[^\s]+`）はカンマも拾って 1 本にまとめて一致するが、
    // WIDE_URL_PATTERN の scheme 分岐はパス文字にカンマを含まないためカンマの手前で終わり、
    // 残りが別のベアドメインとしてもう 1 本一致する
    expect(matchAll('https://evil.com/x,www.evil2.com')).toHaveLength(1)
    expect(matchAllWide('https://evil.com/x,www.evil2.com')).toHaveLength(2)

    // 全角英数字を含むホストは、ASCII 部分だけが URL_PATTERN のベアドメインとして単独一致するため
    expect(matchAll('https://exａmple.com/x')).toHaveLength(1)
    expect(matchAllWide('https://exａmple.com/x')).toHaveLength(2)
  })
})
