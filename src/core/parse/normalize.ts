/**
 * 全角英数記号（U+FF01〜U+FF5E）を半角に、全角スペース（U+3000）を半角スペースに正規化する（§5.2 手順 2）。
 * URL 判定より前に適用してよい。範囲記号（〜 等）の統一は normalizeRangeSymbols で別に行う。
 * URL のパスに含まれるハイフンを壊さないよう、URL を取り除いた後に適用する必要があるため
 */
// 全角スペース（U+3000）。ソースに直接書くと ESLint の no-irregular-whitespace に引っかかるため char code で持つ
const FULLWIDTH_SPACE = String.fromCharCode(0x3000)

export function normalizeWidth(line: string): string {
  return line
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replaceAll(FULLWIDTH_SPACE, ' ')
}

const RANGE_SYMBOL_PATTERN = /[〜～−–~-]/g

/** 範囲記号（`～` `〜` `-` `−` `–`）を `〜` に統一する（§5.2 手順 2 の一部） */
export function normalizeRangeSymbols(text: string): string {
  return text.replace(RANGE_SYMBOL_PATTERN, '〜')
}
