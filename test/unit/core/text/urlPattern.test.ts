import { describe, expect, it } from 'vitest'
import { replaceUrls, URL_PATTERN } from '../../../../src/core/text/urlPattern'

function matchAll(text: string): string[] {
  return Array.from(text.matchAll(new RegExp(URL_PATTERN.source, URL_PATTERN.flags)), (m) => m[0])
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
