import { formatBasicDateJst, formatBasicUtc } from '../time/jst'

export interface IcsInput {
  /** サーバが生成する `${eventId}@${config.publicHost}`。改行を含めない */
  uid: string
  title: string
  location: string | null
  memo: string | null
  start: Date
  end: Date
  isAllDay: boolean
  sequence: number
  generatedAt: Date
  /** サーバが `config.publicOrigin` から組む絶対 URL。改行を含めない */
  detailUrl: string
}

const PRODID = '-//calshare//calshare//JA'

// \n \t 以外の U+0000-U+001F・U+007F（DEL、RFC 5545 の TSAFE-CHAR は含まない）・NEL（U+0085）・
// LINE SEPARATOR（U+2028）・PARAGRAPH SEPARATOR（U+2029）。\r（U+000D）もここに含まれるので
// \r\n 正規化後の残り \r もまとめて除去できる。python の str.splitlines() 等、寛容な実装が
// NEL 等を行区切りとして扱うため、残すとプロパティ・VEVENT 単位への注入経路になる
// eslint-disable-next-line no-control-regex -- ics の TEXT エスケープ仕様上、制御文字そのものを検出対象にする
const CONTROL_CHARS_EXCEPT_TAB_LF = /[\x00-\x08\x0B-\x1F\x7F\u0085\u2028\u2029]/g

/** `\r\n` を `\n` に正規化し、残った `\r` と制御文字を除く。URL 判定やエスケープの前段として使う */
function normalizeControlChars(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(CONTROL_CHARS_EXCEPT_TAB_LF, '')
}

/**
 * uid / detailUrl のような「改行を含めない」契約の値を守る。呼び出し側の契約違反があっても
 * UID / URL 行から独立したプロパティ行が生まれないよう、制御文字と改行を除去する
 */
function sanitizeIcsIdentifier(text: string): string {
  return normalizeControlChars(text).replace(/\n/g, '')
}

// URL に使う文字のみを許可し、直後の空白や日本語を巻き込まないようにする
const URL_CHARS = String.raw`[\w\-./?=&%#:]`

/**
 * ASCII の英字だけを `[Aa]` のような文字クラスに展開し、`i` フラグ無しで大文字小文字を区別しない
 * 照合にする。`buildIcsUrlPattern` は `\p{}` に必要な `u` フラグを使うため `i` を併用できない
 * （U+017F・U+212A が畳み込みで ASCII 文字扱いになる。同ファイルの `buildIcsUrlPattern` 参照）
 */
function toCaseInsensitiveAscii(literal: string): string {
  return literal.replace(/[a-zA-Z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
}

const ALLOWED_BARE_DOMAIN_TLDS = [
  'co',
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
]
  .map(toCaseInsensitiveAscii)
  .join('|')

// ホストのラベルは「ASCII のみ」と「非 ASCII のみ（IDN や全角英数字。ブラウザは IDNA で半角に正規化して
// 解釈する）」を別の選択肢にし、ASCII の `.` のみをラベルの区切りとして両者を跨がせない。1 つの文字クラス
// にまとめると `example.comです` のような「ASCII ドメイン + 区切り無しの日本語文」まで 1 ラベルとして飲み込む
const ASCII_HOST_LABEL = String.raw`[\w-]+`
// 非 ASCII ラベルは文字・数字・結合文字（\p{L} \p{N} \p{M}）のみを許可する。区切り記号を列挙する方式だと、
// 列挙から漏れた記号（絵文字等）までラベルに巻き込み、本文の一部を欠落させる
const NON_ASCII_HOST_LABEL = String.raw`(?:(?![\x00-\x7F])[\p{L}\p{N}\p{M}])+`
const HOST_LABEL = String.raw`(?:${ASCII_HOST_LABEL}|${NON_ASCII_HOST_LABEL})`
// 末尾ラベル（TLD 相当）も HOST_LABEL と同じ規則にし、非 ASCII TLD（`.日本` 等）を拾えるようにする。
// IPv6 リテラルは IPv4-mapped 形式（`::ffff:1.2.3.4` 等）を拾えるよう `.` も許可する
const HOST = String.raw`(?:\[[0-9a-fA-F:.]+\]|(?:${HOST_LABEL}\.)*${HOST_LABEL})`
// RFC 3986 の userinfo に相当する ASCII のみの文字クラス。日本語を許すと `で、担当@example.jp` のように
// 文中の `@` まで userinfo として飲み込んでしまう
const USERINFO = String.raw`[\w.~%!$&'()*+,;=:-]+`
// スキーム付き・www. 付き共通のホスト以降（ポート・パス）。ホストの定義を共有し、パス部は URL_CHARS で絞る
const URL_TAIL = String.raw`${HOST}(?::\d+)?(?:[/?#]${URL_CHARS}*)?`

/**
 * URL 判定用の正規表現を毎回生成する。スキーム付き・`www.` 始まり・許可 TLD かパス付きのベアドメインの
 * 3 形式に加え、ホストが精密な規則に一致しない場合の受け皿としてスキーム付き URL 全体も対象にする。
 * TLD の前方一致（`co` が `com` の一部になる等）を防ぐため直後に単語文字が続かないことを確認する
 * （`core/text/urlPattern.ts` への統合は Issue #19）。
 */
function buildIcsUrlPattern(): RegExp {
  const httpsScheme = `${toCaseInsensitiveAscii('http')}${toCaseInsensitiveAscii('s')}?`
  const wwwLiteral = toCaseInsensitiveAscii('www')
  return new RegExp(
    // スキームの直後に `/` が連続しても許容する（`https:///evil.xyz` のような表記もリンクとして検出するため）
    String.raw`${httpsScheme}:\/\/\/*(?:${USERINFO}@)?${URL_TAIL}` +
      String.raw`|${wwwLiteral}\.${URL_TAIL}` +
      String.raw`|[\w-]+(?:\.[\w-]+)*\.(?:(?:${ALLOWED_BARE_DOMAIN_TLDS})(?!\w)(?:\/${URL_CHARS}*)?|[a-zA-Z]{2,}\/${URL_CHARS}*)` +
      // 上の選択肢は左から順に試すので、精密なホスト規則に一致する通常の URL はここまでで消費し尽くす。
      // ここまで一致しなかった場合だけ受け皿としてスキーム以降を丸ごと拾う。囲み英数字（Unicode カテゴリ
      // So）や IPv6 の zone id 等、精密なホスト規則をすり抜ける非 ASCII ホストを取りこぼさないため
      String.raw`|${httpsScheme}:\/\/\S+`,
    // 'i' は付けない。\p{} に必要な 'u' と 'i' を組み合わせると、大文字小文字の畳み込みで
    // U+017F（ſ）・U+212A（Kelvin 記号）が ASCII の s/k として \w や [a-z] に一致してしまい、
    // ホスト名やパスの一部として本文の文字を巻き込む。スキーム・www.・TLD の大文字表記は
    // toCaseInsensitiveAscii と [a-zA-Z] で個別に対応する
    'gu',
  )
}

/**
 * URL（暫定判定。`core/text/urlPattern.ts` の共有定義への統合は Issue #19）を「[リンク]」に置換する。
 * 制御文字の除去を URL 判定より先に行う。順序を入れ替えると、URL の途中に制御文字を挟むことで判定を
 * すり抜けられる。SUMMARY / LOCATION / DESCRIPTION の 3 つに同じ関数を通す。
 */
export function sanitizeIcsText(text: string): string {
  return normalizeControlChars(text).replace(buildIcsUrlPattern(), '[リンク]')
}

/**
 * RFC 5545 の TEXT エスケープ。`\r\n` を `\n` に正規化し、残った `\r` と制御文字を除去した上で
 * `\` `;` `,` `\n` をエスケープする。lone `\r` を行区切りとして扱う寛容なパーサへのプロパティ注入を防ぐ
 */
export function escapeIcsText(text: string): string {
  const normalized = normalizeControlChars(text)
  return normalized
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * RFC 5545 の 75 オクテット折り返し。継続行は先頭の半角スペース 1 個を含めて 75 オクテットで数える。
 * 1 文字ずつオクテット数を積み上げるので、マルチバイト文字の途中では切らない
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  const segments: string[] = []
  let current = ''
  let currentOctets = 0
  let limit = 75 // 継続行に入ると先頭スペース 1 個分を差し引いて 74 になる

  for (const ch of line) {
    const chOctets = encoder.encode(ch).length
    if (current !== '' && currentOctets + chOctets > limit) {
      segments.push(current)
      current = ''
      currentOctets = 0
      limit = 74
    }
    current += ch
    currentOctets += chOctets
  }
  segments.push(current)

  return segments.map((segment, i) => (i === 0 ? segment : ` ${segment}`)).join('\r\n')
}

function textPropertyLine(name: string, sanitizedValue: string): string {
  return foldIcsLine(`${name}:${escapeIcsText(sanitizedValue)}`)
}

function buildDescriptionText(memo: string | null, detailUrl: string): string {
  const detailLine = `詳細はこちら: ${detailUrl}`
  return memo ? `${sanitizeIcsText(memo)}\n${detailLine}` : detailLine
}

export function buildIcs(input: IcsInput): string {
  const uid = sanitizeIcsIdentifier(input.uid)
  const detailUrl = sanitizeIcsIdentifier(input.detailUrl)

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldIcsLine(`UID:${uid}`),
    `DTSTAMP:${formatBasicUtc(input.generatedAt)}`,
  ]

  if (input.isAllDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatBasicDateJst(input.start)}`)
    lines.push(`DTEND;VALUE=DATE:${formatBasicDateJst(input.end)}`)
  } else {
    lines.push(`DTSTART:${formatBasicUtc(input.start)}`)
    lines.push(`DTEND:${formatBasicUtc(input.end)}`)
  }

  lines.push(textPropertyLine('SUMMARY', sanitizeIcsText(input.title)))
  if (input.location) {
    lines.push(textPropertyLine('LOCATION', sanitizeIcsText(input.location)))
  }
  lines.push(textPropertyLine('DESCRIPTION', buildDescriptionText(input.memo, detailUrl)))
  lines.push(foldIcsLine(`URL:${detailUrl}`))
  lines.push(`SEQUENCE:${input.sequence}`)
  lines.push('STATUS:CONFIRMED')
  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n') + '\r\n'
}
