import { describe, expect, it } from 'vitest'
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

  it('複数の URL が区切り文字を挟まず並んでいても、それぞれ本数どおりに一致する', () => {
    expect(matchAllWide('https://evil.com/x,www.evil2.com')).toEqual([
      'https://evil.com/x',
      'www.evil2.com',
    ])
  })
})

describe('WIDE_URL_PATTERN: 長い入力での性能', () => {
  // ベアドメイン分岐は中間ラベルの繰り返し回数に上限を設けて O(n^2) を防いでいる
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
    const inputs = [
      'https://example.com/map です',
      'ftp://evil.com/x を見て',
      'hxxps://evil.com を見て',
      'https://例え.日本/x を見て',
      'www.日本語.jp',
      'https://user:pw@evil.com/x',
      'https://evil.com/x,www.evil2.com',
      'https://exａmple.com/x',
      'https://x:1evil.com/path',
    ]
    for (const input of inputs) {
      expect(matchAll(replaceUrlsWide(input, '[リンク]'))).toEqual([])
    }
  })

  it('非 ASCII ホストや他スキームでは WIDE_URL_PATTERN の方が本数が多くなる（既知の非対称性、§5.2）', () => {
    expect(matchAll('www.日本語.jp')).toHaveLength(0)
    expect(matchAllWide('www.日本語.jp')).toHaveLength(1)

    expect(matchAll('ftp://evil.com/x')).toHaveLength(0)
    expect(matchAllWide('ftp://evil.com/x')).toHaveLength(1)

    // 全角英数字を含むホストは、ASCII 部分だけが URL_PATTERN のベアドメインとして単独一致する
    // ケースがあるため単純な優劣にはならないが、WIDE_URL_PATTERN の合計本数は URL_PATTERN 以上になる
    expect(matchAll('https://evil.com/x,www.evil2.com')).toHaveLength(1)
    expect(matchAllWide('https://evil.com/x,www.evil2.com')).toHaveLength(2)
  })
})
