// URL 判定の正規表現（§5.2）。パーサ・countUrls（§9.2）・ics のサニタイズ（§7.2）で共用する。
// 抽出用の厳密な判定（URL_PATTERN）と、ics のサニタイズ用の広い判定（WIDE_URL_PATTERN）の
// 2 本を持つ。両者の非対称性の理由は WIDE_URL_PATTERN 側のコメントを参照

// "co" は "com" の前方一致になるため、正規表現の候補順で先に置かれる "com" 側を先に試させる
const ALLOWED_BARE_TLD_LIST = [
  'com',
  'jp',
  'net',
  'org',
  'io',
  'me',
  'ly',
  'app',
  'dev',
  'link',
  'co',
]
const ALLOWED_BARE_TLDS = ALLOWED_BARE_TLD_LIST.join('|')

// ドット区切り語の途中（`a.` の繰り返し等）から拾うと、区切りの数だけ末尾までなめる走査を
// 開始位置ごとに繰り返すことになり O(n^2) になるため、直前が `\w` `.` `-` のいずれでもないことを
// 条件にする（`(?<![\w.-])`）。hxxps:// のような難読化された scheme の直後のドメインも拾わない（`(?<!:\/\/)`）
const NOT_AFTER_SCHEME = String.raw`(?<![\w.-])(?<!:\/\/)`

// パス・クエリ・フラグメントの続き。`/` 無しで `?q=1` `#map` から始まる形も途中で切らない
const PATH_TAIL = String.raw`(?:[/?#][^\s]*)?`

// ベアドメインは (a) パスが続く、(b) 末尾ラベルが ALLOWED_BARE_TLDS のいずれか、の 2 通りだけを URL とみなす。
// 末尾ラベルが英字というだけでは Node.js / Vue.js のような製品名まで拾ってしまうため。
// (b) は末尾ラベルの直後に英数字・ハイフンが続かないことも確認する（`example.company` の
// 先頭 `example.com` を誤って切り出さないため）
const BARE_DOMAIN_WITH_PATH = `${NOT_AFTER_SCHEME}${String.raw`[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\/[^\s]*`}`
const BARE_DOMAIN_WITH_ALLOWED_TLD = `${NOT_AFTER_SCHEME}${String.raw`[\w-]+(?:\.[\w-]+)*\.(?:${ALLOWED_BARE_TLDS})(?![\w-])`}${PATH_TAIL}`

// `www.` 始まりも他のベアドメイン同様、単語の途中や難読化 scheme の直後からは拾わない。
// ホスト名は ASCII の語・ハイフンに限り、`www.渋谷` のような非対応の文字列は対象にしない
const WWW_DOMAIN = `${NOT_AFTER_SCHEME}${String.raw`www\.[\w-]+(?:\.[\w-]+)*`}${PATH_TAIL}`

const URL_SOURCE = [
  String.raw`https?:\/\/[^\s]+`,
  WWW_DOMAIN,
  BARE_DOMAIN_WITH_PATH,
  BARE_DOMAIN_WITH_ALLOWED_TLD,
].join('|')

/**
 * URL 判定の正規表現（scheme 付き／`www.` 始まり／条件付きベアドメインの 3 形式、§5.2）。
 * g フラグ付きのインスタンスを直接使い回すと lastIndex が残るため、使う側は
 * `new RegExp(URL_PATTERN.source, URL_PATTERN.flags)` で毎回新しいインスタンスを作る
 */
export const URL_PATTERN = new RegExp(URL_SOURCE, 'gi')

function freshUrlPattern(): RegExp {
  return new RegExp(URL_PATTERN.source, URL_PATTERN.flags)
}

/** text 中の URL_PATTERN に一致する箇所をすべて replacement に置き換える */
export function replaceUrls(text: string, replacement: string): string {
  return text.replace(freshUrlPattern(), replacement)
}

/**
 * ASCII の英字だけを `[Aa]` のような文字クラスに展開し、`i` フラグ無しで大文字小文字を区別しない
 * 照合にする。WIDE_URL_PATTERN は `\p{}` に必要な `u` フラグを使うため `i` を併用できない
 * （U+017F・U+212A が畳み込みで ASCII 文字扱いになり、\w がホスト名以外の文字まで拾ってしまう）
 */
function toCaseInsensitiveAscii(literal: string): string {
  return literal.replace(/[a-zA-Z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
}

const ALLOWED_BARE_TLDS_CASE_INSENSITIVE =
  ALLOWED_BARE_TLD_LIST.map(toCaseInsensitiveAscii).join('|')

// ホストのラベルは「ASCII のみ」と「非 ASCII のみ（IDN や全角英数字。ブラウザは IDNA で半角に正規化して
// 解釈する）」を別の選択肢にし、ASCII の `.` のみをラベルの区切りとして両者を跨がせない。1 つの文字クラス
// にまとめると `example.comです` のような「ASCII ドメイン + 区切り無しの日本語文」まで 1 ラベルとして飲み込む
const ASCII_HOST_LABEL = String.raw`[\w-]+`
// 非 ASCII ラベルは文字・数字・結合文字（\p{L} \p{N} \p{M}）のみを許可する。区切り記号を列挙する方式だと、
// 列挙から漏れた記号（絵文字等）までラベルに巻き込み、本文の一部を欠落させる
const NON_ASCII_HOST_LABEL = String.raw`(?:(?![\x00-\x7F])[\p{L}\p{N}\p{M}])+`
const WIDE_HOST_LABEL = String.raw`(?:${ASCII_HOST_LABEL}|${NON_ASCII_HOST_LABEL})`
// 末尾ラベル（TLD 相当）も HOST_LABEL と同じ規則にし、非 ASCII TLD（`.日本` 等）を拾えるようにする。
// IPv6 リテラルは IPv4-mapped 形式（`::ffff:1.2.3.4` 等）を拾えるよう `.` も許可する
const WIDE_HOST = String.raw`(?:\[[0-9a-fA-F:.]+\]|(?:${WIDE_HOST_LABEL}\.)*${WIDE_HOST_LABEL})`
// RFC 3986 の userinfo に相当する ASCII のみの文字クラス。日本語を許すと `で、担当@example.jp` のように
// 文中の `@` まで userinfo として飲み込んでしまう
const USERINFO = String.raw`[\w.~%!$&'()*+,;=:-]+`
// URL に使う文字のみを許可し、直後の空白や日本語を巻き込まないようにする
const WIDE_URL_CHARS = String.raw`[\w\-./?=&%#:]`
// スキーム付き・www. 付き共通のホスト以降（ポート・パス）
const WIDE_URL_TAIL = String.raw`${WIDE_HOST}(?::\d+)?(?:[/?#]${WIDE_URL_CHARS}*)?`

// ベアドメイン規則の中間ラベル（`(?:\.[\w-]+)*`）は無制限だと、ドット区切りが連続する入力
// （`a.a.a...`）で開始位置ごとに末尾までなめるバックトラックになり O(n^2) になる。実在のホスト名で
// ここまでのラベル数はまず無いので、繰り返し回数の上限で個々の開始位置のバックトラックを打ち切る。
// 後読みで開始位置そのものを絞る方式と違い、直前の文字を見ないので他の分岐が直前で終わる
// ケース（`https://x:1evil.com` 等）を誤ってブロックしない
const WIDE_BARE_DOMAIN_MAX_LABELS = 20

/**
 * URL 判定の正規表現を毎回生成する。スキーム付き・`www.` 始まり・許可 TLD かパス付きのベアドメインの
 * 3 形式に加え、ホストが精密な規則に一致しない場合の受け皿としてスキーム付き URL 全体も対象にする。
 * TLD の前方一致（`co` が `com` の一部になる等）を防ぐため直後に単語文字が続かないことを確認する。
 * スキーム・www. 分岐には URL_PATTERN の NOT_AFTER_SCHEME に相当する後読みを持たせない。ics の
 * サニタイズは obfuscated scheme（`hxxps://evil.com`）や http(s) 以外のスキーム（`ftp://evil.com`）の
 * 直後でもホスト部だけは「[リンク]」に置換したいため（§7.2 の外部リンク 0 本の対象を広げる）
 */
function freshWideUrlPattern(): RegExp {
  const httpsScheme = `${toCaseInsensitiveAscii('http')}${toCaseInsensitiveAscii('s')}?`
  const wwwLiteral = toCaseInsensitiveAscii('www')
  const source =
    // スキームの直後に `/` が連続しても許容する（`https:///evil.xyz` のような表記もリンクとして検出するため）
    String.raw`${httpsScheme}:\/\/\/*(?:${USERINFO}@)?${WIDE_URL_TAIL}` +
    String.raw`|${wwwLiteral}\.${WIDE_URL_TAIL}` +
    String.raw`|[\w-]+(?:\.[\w-]+){0,${WIDE_BARE_DOMAIN_MAX_LABELS}}\.(?:(?:${ALLOWED_BARE_TLDS_CASE_INSENSITIVE})(?!\w)(?:\/${WIDE_URL_CHARS}*)?|[a-zA-Z]{2,}\/${WIDE_URL_CHARS}*)` +
    // 上の選択肢は左から順に試すので、精密なホスト規則に一致する通常の URL はここまでで消費し尽くす。
    // ここまで一致しなかった場合だけ受け皿としてスキーム以降を丸ごと拾う。囲み英数字（Unicode カテゴリ
    // So）や IPv6 の zone id 等、精密なホスト規則をすり抜ける非 ASCII ホストを取りこぼさないため
    String.raw`|${httpsScheme}:\/\/\S+`
  // 'i' は付けない。\p{} に必要な 'u' と 'i' を組み合わせると、大文字小文字の畳み込みで
  // U+017F（ſ）・U+212A（Kelvin 記号）が ASCII の s/k として \w や [a-z] に一致してしまい、
  // ホスト名やパスの一部として本文の文字を巻き込む。スキーム・www.・TLD の大文字表記は
  // toCaseInsensitiveAscii と [a-zA-Z] で個別に対応する
  return new RegExp(source, 'gu')
}

/**
 * ics のサニタイズ（§7.2）専用の広い判定。URL_PATTERN の 3 形式に加え、非 ASCII ホスト（IDN・全角
 * 英数字）・IPv6 リテラル・userinfo・記号カテゴリのホストの受け皿を持つ。ics は「外部リンクを常に
 * 0 本にする」ことが目的で、過剰一致は「[リンク]」への置換が増えるだけでリンクは増えないため、誤検出を
 * 避けたい URL_PATTERN より広く一致してよい（§5.2）。抽出用途にはこちらを使わない
 */
export const WIDE_URL_PATTERN = freshWideUrlPattern()

/** text 中の WIDE_URL_PATTERN に一致する箇所をすべて replacement に置き換える */
export function replaceUrlsWide(text: string, replacement: string): string {
  return text.replace(freshWideUrlPattern(), replacement)
}
