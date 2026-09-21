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

  it('パスが / だけのベアドメインも置換する', () => {
    expect(sanitizeIcsText('example.xyz/ で受付')).toBe('[リンク] で受付')
  })

  it('URL の直後に空白の無い日本語が続いても、URL 以外の部分は残す', () => {
    expect(sanitizeIcsText('会費は https://pay.example/xyzよろしく')).toBe(
      '会費は [リンク]よろしく',
    )
    expect(sanitizeIcsText('www.example.comです')).toBe('[リンク]です')
    expect(sanitizeIcsText('example.com/pathよろしく')).toBe('[リンク]よろしく')
  })

  it('日本語ドメイン（IDN）を含む https:// リンクも置換する', () => {
    expect(sanitizeIcsText('詳細は https://例え.jp/x を見て')).toBe('詳細は [リンク] を見て')
  })

  it('URL の途中に制御文字が挟まっていても、制御文字除去後の文字列を URL として検出する', () => {
    expect(sanitizeIcsText(`https:${String.fromCharCode(0)}//1.2.3.4/x`)).toBe('[リンク]')
    expect(sanitizeIcsText(`evil.${String.fromCharCode(7)}xyz/path`)).toBe('[リンク]')
    expect(sanitizeIcsText(`ww${String.fromCharCode(8)}w.evil.xyz`)).toBe('[リンク]')
    expect(sanitizeIcsText('htt\rps://evil.xyz/a')).toBe('[リンク]')
  })
})
