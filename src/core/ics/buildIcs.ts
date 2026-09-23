import { formatBasicDateJst, formatBasicUtc } from '../time/jst'
import { replaceUrlsWide } from '../text/urlPattern'

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

/**
 * URL（core/text/urlPattern.ts の WIDE_URL_PATTERN、§5.2・§7.2）を「[リンク]」に置換する。
 * 制御文字の除去を URL 判定より先に行う。順序を入れ替えると、URL の途中に制御文字を挟むことで判定を
 * すり抜けられる。SUMMARY / LOCATION / DESCRIPTION の 3 つに同じ関数を通す。
 */
export function sanitizeIcsText(text: string): string {
  return replaceUrlsWide(normalizeControlChars(text), '[リンク]')
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
