// URL 判定の正規表現（§5.2）。パーサ・countUrls（§9.2）・ics のサニタイズ（§7.2）で共用する。

// "co" は "com" の前方一致になるため、正規表現の候補順で先に置かれる "com" 側を先に試させる
const ALLOWED_BARE_TLDS = 'com|jp|net|org|io|me|ly|app|dev|link|co'

// ドット区切り語の途中（`a.` の繰り返し等）から拾うと、区切りの数だけ末尾までなめる走査を
// 開始位置ごとに繰り返すことになり O(n^2) になるため、直前が `\w` `.` `-` のいずれでもないことを
// 条件にする（`(?<![\w.-])`）。hxxps:// のような難読化された scheme の直後のドメインも拾わない（`(?<!:\/\/)`）
const NOT_AFTER_SCHEME = String.raw`(?<![\w.-])(?<!:\/\/)`

// ベアドメインは (a) パスが続く、(b) 末尾ラベルが ALLOWED_BARE_TLDS のいずれか、の 2 通りだけを URL とみなす。
// 末尾ラベルが英字というだけでは Node.js / Vue.js のような製品名まで拾ってしまうため。
// (b) は末尾ラベルの直後に英数字・ハイフンが続かないことも確認する（`example.company` の
// 先頭 `example.com` を誤って切り出さないため）
const BARE_DOMAIN_WITH_PATH = `${NOT_AFTER_SCHEME}${String.raw`[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\/[^\s]*`}`
const BARE_DOMAIN_WITH_ALLOWED_TLD = `${NOT_AFTER_SCHEME}${String.raw`[\w-]+(?:\.[\w-]+)*\.(?:${ALLOWED_BARE_TLDS})(?![\w-])(?:\/[^\s]*)?`}`

// `www.` 始まりも他のベアドメイン同様、単語の途中や難読化 scheme の直後からは拾わない。
// ホスト名は ASCII の語・ハイフンに限り、`www.渋谷` のような非対応の文字列は対象にしない
const WWW_DOMAIN = `${NOT_AFTER_SCHEME}${String.raw`www\.[\w-]+(?:\.[\w-]+)*(?:\/[^\s]*)?`}`

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
