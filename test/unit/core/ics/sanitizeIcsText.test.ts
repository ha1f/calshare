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

  it('scheme 付き URL にパスが無くても、直後の日本語や記号を巻き込まない', () => {
    expect(sanitizeIcsText('https://example.comで申込')).toBe('[リンク]で申込')
    expect(sanitizeIcsText('https://example.comよろしく')).toBe('[リンク]よろしく')
    expect(sanitizeIcsText('https://example.com?x=1です')).toBe('[リンク]です')
    expect(sanitizeIcsText('https://example.com。')).toBe('[リンク]。')
  })

  it('www. 分岐でも URL 直後の日本語を巻き込まない', () => {
    expect(sanitizeIcsText('www.example.com、よろしく')).toBe('[リンク]、よろしく')
  })

  it('www. 分岐でも日本語ドメイン（IDN）を置換する', () => {
    expect(sanitizeIcsText('www.日本語.jp')).toBe('[リンク]')
  })

  it('スキームの後に余分な / があっても置換する', () => {
    expect(sanitizeIcsText('https:///evil.xyz')).toBe('[リンク]')
  })

  it('userinfo・ポート・IPv6 リテラルを含む URL も置換する', () => {
    expect(sanitizeIcsText('https://user:pw@evil.com/x')).toBe('[リンク]')
    expect(sanitizeIcsText('https://1.2.3.4:8080/x')).toBe('[リンク]')
    expect(sanitizeIcsText('http://[::1]/a')).toBe('[リンク]')
  })

  it('ホスト直後が句点や読点無しの日本語文でも、句読点をまたいでホストに巻き込まない', () => {
    expect(sanitizeIcsText('https://example.comです。持ち物はNode.js入門')).toBe(
      '[リンク]です。持ち物はNode.js入門',
    )
  })

  it('ホスト直後の日本語文中に @ があっても、userinfo として文をまたいで飲み込まない', () => {
    // 「担当@example.jp」の example.jp 自体は許可 TLD のベアドメインとして別途置換される
    expect(sanitizeIcsText('https://example.comで、担当@example.jpまで')).toBe(
      '[リンク]で、担当@[リンク]まで',
    )
  })

  it('TLD 自体が非 ASCII の IDN（.日本 等）でも置換する', () => {
    expect(sanitizeIcsText('詳細は https://例え.日本/x を見て')).toBe('詳細は [リンク] を見て')
    expect(sanitizeIcsText('www.例え.日本')).toBe('[リンク]')
    expect(sanitizeIcsText('https://例え.コム')).toBe('[リンク]')
    expect(sanitizeIcsText('https://日本.語/x')).toBe('[リンク]')
  })

  it('全角英数字だけで書かれたホストも置換する（ブラウザは IDNA で半角に正規化して開ける）', () => {
    expect(sanitizeIcsText('https://ｅｘａｍｐｌｅ.com')).toBe('[リンク]')
    expect(sanitizeIcsText('www.１２３.jp')).toBe('[リンク]')
  })

  it('IPv4-mapped 形式の IPv6 リテラルを含む URL も置換する', () => {
    expect(sanitizeIcsText('https://[::ffff:1.2.3.4]/x')).toBe('[リンク]')
  })

  it('ホスト直後の中点「・」で区切られた本文を飲み込まない', () => {
    expect(sanitizeIcsText('https://example.com・詳細はNode.js入門')).toBe(
      '[リンク]・詳細はNode.js入門',
    )
  })

  it('非 ASCII ホスト直後の句読点や記号・絵文字で区切られた本文を飲み込まない', () => {
    expect(sanitizeIcsText('https://例え.日本…詳細はNode.js入門')).toBe(
      '[リンク]…詳細はNode.js入門',
    )
    expect(sanitizeIcsText('https://例え.日本→詳細')).toBe('[リンク]→詳細')
    expect(sanitizeIcsText('https://例え.日本※注意')).toBe('[リンク]※注意')
    expect(sanitizeIcsText('https://例え.日本🎉詳細')).toBe('[リンク]🎉詳細')
  })

  it('U+017F・U+212A のような ASCII に畳み込まれる非 ASCII 文字をホストラベルに巻き込まない', () => {
    // U+017F（ſ）・U+212A（Kelvin 記号）は大文字小文字を区別しない照合では s/k に一致するが、
    // ここでは区別するのでホストの一部にならず、本文の文字として残る
    expect(sanitizeIcsText('https://example.comſです')).toBe('[リンク]ſです')
    expect(sanitizeIcsText('https://example.com/pathſです')).toBe('[リンク]ſです')
  })

  it('スキーム・www.・許可リストの TLD が大文字でも置換する', () => {
    expect(sanitizeIcsText('HTTPS://EVIL.COM/x')).toBe('[リンク]')
    expect(sanitizeIcsText('WWW.EVIL.COM')).toBe('[リンク]')
    expect(sanitizeIcsText('EVIL.COM で受付')).toBe('[リンク] で受付')
  })

  it('パスが続くベアドメインの TLD が大文字でも置換する', () => {
    expect(sanitizeIcsText('evil.XYZ/path で受付')).toBe('[リンク] で受付')
  })

  it('ホストが絵文字・記号カテゴリの文字で書かれていても、精密なホスト規則の受け皿として置換する', () => {
    // ⓔⓥⓘⓛ.com は UTS#46 で evil.com に正規化されてブラウザで開けるが、
    // 囲み英数字（Unicode カテゴリ So）は \p{L} に一致せずホスト規則をすり抜ける
    expect(sanitizeIcsText('https://ⓔⓥⓘⓛ.com')).toBe('[リンク]')
    expect(sanitizeIcsText('https://☃.net')).toBe('[リンク]')
    expect(sanitizeIcsText('https://😀.la')).toBe('[リンク]')
    expect(sanitizeIcsText('https://[fe80::1%25eth0]/')).toBe('[リンク]')
  })

  it('難読化された scheme（hxxps://）はスキーム部分を残すが、ホスト部はベアドメインとして置換する', () => {
    expect(sanitizeIcsText('hxxps://evil.com を見て')).toBe('hxxps://[リンク] を見て')
    expect(sanitizeIcsText('hxxp://www.evil.com を見て')).toBe('hxxp://[リンク] を見て')
  })

  it('ftp など http(s) 以外のスキームでも、ホスト部はベアドメインとして置換する', () => {
    expect(sanitizeIcsText('ftp://evil.com/x を見て')).toBe('ftp://[リンク] を見て')
  })

  it('日本語文の直後のドット区切りドメインも置換する', () => {
    expect(sanitizeIcsText('受付終了.evil.com')).toBe('受付終了.[リンク]')
  })

  it('scheme 分岐がポート番号の数字で終わっても、続くドメインを別の URL として取りこぼさない', () => {
    // scheme 分岐は "https://x:1" までしか消費しないため、続く "evil.com/path" を
    // ベアドメイン分岐が拾えないと外部リンクが本文に残る（§7.2 の外部リンク 0 本）
    expect(sanitizeIcsText('https://x:1evil.com/path を見て')).toBe('[リンク][リンク] を見て')
  })

  it('カンマ区切りで並ぶ 2 つの URL は、両方とも置換する', () => {
    expect(sanitizeIcsText('https://evil.com/x,www.evil2.com')).toBe('[リンク],[リンク]')
  })
})

describe('sanitizeIcsText: 長い入力での性能', () => {
  sanitizeIcsText('a.') // JIT ウォームアップ

  it('a. を 10000 回繰り返しても（20,000 文字）50ms 以内に返る', () => {
    const input = 'a.'.repeat(10000)
    const start = performance.now()
    sanitizeIcsText(input)
    expect(performance.now() - start).toBeLessThan(50)
  })
})
