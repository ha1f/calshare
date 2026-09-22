// 全角スペース（U+3000）。ソースに直接書くと ESLint の no-irregular-whitespace に引っかかるため char code で持つ
const FULLWIDTH_SPACE = String.fromCharCode(0x3000)

// C0 制御文字（改行は split 済みで含まれない）とゼロ幅文字（ZWSP/ZWNJ/ZWJ/BOM）。
// 見えないままタイトル・場所に残ると DB 上で紛らわしいので空白に変える（空文字にすると
// `9/20<ZWSP>19時` の日付と時刻がくっついて `2019` のような 1 つの数字列に見えてしまうため）。
// ソースに制御文字を直接書くと ESLint の no-control-regex に引っかかるため char code で組み立てる
const INVISIBLE_CHAR_RANGES = [
  [0x00, 0x1f],
  [0x7f, 0x7f],
  [0x200b, 0x200d],
  [0xfeff, 0xfeff],
] as const
const INVISIBLE_CHAR_RE = new RegExp(
  `[${INVISIBLE_CHAR_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join('')}]`,
  'g',
)

/** 全角英数記号（U+FF01〜U+FF5E）を半角に、全角スペースを半角スペースにする（§5.2 手順 2） */
export function normalizeWidth(line: string): string {
  return line
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replaceAll(FULLWIDTH_SPACE, ' ')
    .replace(INVISIBLE_CHAR_RE, ' ')
}

/**
 * 範囲記号（`〜` `～` `−` `–` `~` `-`）の文字クラス。日付・時刻の正規表現に組み込んで使う。
 * 行全体をこの記号で書き換えると URL のパスや電話番号のハイフンまで壊れるため、
 * 範囲記号の統一は文字列の書き換えではなく日付・時刻トークンの検出時にだけ行う
 */
export const RANGE_SYMBOL_SOURCE = String.raw`[〜～−–~-]`
