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

  it('1 行に複数の URL があればすべて一致する', () => {
    expect(matchAll('https://a.example.com と https://b.example.com')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
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
