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

// \n \t 以外の U+0000-U+001F。\r（U+000D）もここに含まれるので \r\n 正規化後の残り \r もまとめて除去できる
// eslint-disable-next-line no-control-regex -- ics の TEXT エスケープ仕様上、制御文字そのものを検出対象にする
const CONTROL_CHARS_EXCEPT_TAB_LF = /[\x00-\x08\x0B-\x1F]/g

/** `\r\n` を `\n` に正規化し、残った `\r` と制御文字を除く。URL 判定やエスケープの前段として使う */
function normalizeControlChars(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(CONTROL_CHARS_EXCEPT_TAB_LF, '')
}

// URL に使う文字のみを許可し、直後の空白や日本語を巻き込まないようにする
const URL_CHARS = String.raw`[\w\-./?=&%#:]`
const ALLOWED_BARE_DOMAIN_TLDS = 'co|com|jp|net|org|io|me|ly|app|dev|link'

/**
 * URL 判定用の正規表現を毎回生成する。`core/text/urlPattern.ts`（別タスクで実装中）が着地するまでの
 * 暫定実装で、スキーム付き・`www.` 始まり・許可 TLD かパス付きのベアドメインの 3 形式を対象にする。
 * TLD の前方一致（`co` が `com` の一部になる等）を防ぐため TLD の直後に単語文字が続かないことを確認する
 */
function buildIcsUrlPattern(): RegExp {
  return new RegExp(
    // ホスト部は IDN（日本語ドメイン等）も拾えるよう空白と `/` 以外を許可し、パス部だけ URL_CHARS で絞る
    String.raw`https?:\/\/[^\s/]+(?:\/${URL_CHARS}*)?` +
      String.raw`|www\.${URL_CHARS}+` +
      String.raw`|[\w-]+(?:\.[\w-]+)*\.(?:(?:${ALLOWED_BARE_DOMAIN_TLDS})(?!\w)(?:\/${URL_CHARS}*)?|[a-z]{2,}\/${URL_CHARS}*)`,
    'gi',
  )
}

/** URL を「[リンク]」に置換する。SUMMARY / LOCATION / DESCRIPTION の 3 つに同じ関数を通す */
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
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    foldIcsLine(`UID:${input.uid}`),
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
  lines.push(textPropertyLine('DESCRIPTION', buildDescriptionText(input.memo, input.detailUrl)))
  lines.push(foldIcsLine(`URL:${input.detailUrl}`))
  lines.push(`SEQUENCE:${input.sequence}`)
  lines.push('STATUS:CONFIRMED')
  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n') + '\r\n'
}
