import { describe, expect, it } from 'vitest'
import { sanitizeIcsText } from '../../../../src/core/ics/buildIcs'

describe('sanitizeIcsText', () => {
  it('https:// のリンクを [リンク] に置換する', () => {
    expect(sanitizeIcsText('詳細は https://example.com/path を見て')).toBe('詳細は [リンク] を見て')
  })

  it('www. で始まるリンクを置換する', () => {
    expect(sanitizeIcsText('www.example.com にて')).toBe('[リンク] にて')
  })

  it('ベアドメインは / が続くか許可リストの TLD なら置換する', () => {
    expect(sanitizeIcsText('example.com で受付')).toBe('[リンク] で受付')
    expect(sanitizeIcsText('example.co.jp で受付')).toBe('[リンク] で受付')
    expect(sanitizeIcsText('bit.ly で受付')).toBe('[リンク] で受付')
    expect(sanitizeIcsText('example.xyz/path で受付')).toBe('[リンク] で受付')
  })

  it('許可リストに無い TLD で / も続かないベアドメインは置換しない（製品名の誤検出防止）', () => {
    expect(sanitizeIcsText('Node.js 勉強会')).toBe('Node.js 勉強会')
    expect(sanitizeIcsText('Vue.js 入門')).toBe('Vue.js 入門')
  })

  it('数字だけのドメイン風文字列は置換しない', () => {
    expect(sanitizeIcsText('9.20 に集合')).toBe('9.20 に集合')
  })

  it('1 つのテキストに複数の URL があれば全て置換する', () => {
    expect(sanitizeIcsText('https://a.example と https://b.example')).toBe('[リンク] と [リンク]')
  })
})
