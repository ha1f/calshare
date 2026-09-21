#!/usr/bin/env node
// JIS X 0208 第1水準漢字（区点 16〜47 区）の一覧を生成する。
// 依存ゼロ（Node の TextDecoder のみ）。EUC-JP はバイト = 区/点 + 0xA0 の単純な変換で済み、
// Shift_JIS のような区の奇偶による分岐が要らないため EUC-JP を使う。
// 未割り当ての区点は U+FFFD（置換文字）に変換されるので除外する。
//
// 使い方:
//   node scripts/fonts/generate-jis-level1.mjs [--out <file>] [--dry-run] [--json] [--help]
//
// --out を指定しない場合、生成した文字をそのまま連結して標準出力に書く
// （scripts/fonts/subset.sh が pyftsubset の --text-file 用に読み取る想定）。

import { writeFile } from 'node:fs/promises'

const KU_START = 16
const KU_END = 47
const TEN_START = 1
const TEN_END = 94
const REPLACEMENT_CHAR = '�'

function usage() {
  return [
    '使い方: node scripts/fonts/generate-jis-level1.mjs [--out <file>] [--dry-run] [--json] [--help]',
    '',
    'JIS X 0208 第1水準漢字（区点 16〜47 区、2965 文字）を EUC-JP 変換で復元して出力する。',
    '--out を省略すると、文字をそのまま連結して標準出力に書く。',
    '--dry-run を付けると --out で指定した書き込みを行わず、件数と書き込み予定パスだけ表示する。',
  ].join('\n')
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { out: null, dryRun: false, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--help') args.help = true
    else throw new Error(`不明な引数です: ${a}`)
  }
  return args
}

/**
 * 区点 16〜47 区を EUC-JP として復号し、第1水準漢字の一覧を返す。
 * @param {object} [options]
 * @param {(bytes: Uint8Array) => string} [options.decode] テスト用に差し替え可能
 */
export function generateJisLevel1Kanji(options = {}) {
  const { decode = (bytes) => new TextDecoder('euc-jp').decode(bytes) } = options
  const chars = []
  for (let ku = KU_START; ku <= KU_END; ku++) {
    for (let ten = TEN_START; ten <= TEN_END; ten++) {
      const bytes = Uint8Array.of(ku + 0xa0, ten + 0xa0)
      const decoded = decode(bytes)
      if (decoded.length === 1 && decoded !== REPLACEMENT_CHAR) chars.push(decoded)
    }
  }
  return chars
}

/** @param {{ out: string | null, dryRun: boolean, chars: string[] }} result */
export function formatResult({ out, dryRun, chars }) {
  if (dryRun) {
    return out
      ? `[dry-run] 件数: ${chars.length} / 書き込み予定: ${out}`
      : `[dry-run] 件数: ${chars.length}`
  }
  return out ? `${out} に ${chars.length} 文字を書き込みました` : chars.join('')
}

/**
 * @param {object} opts
 * @param {(p: string, c: string) => Promise<void>} [opts.writeFileImpl]
 */
export async function run(opts) {
  const { out, dryRun, json, writeFileImpl = writeFile } = opts
  const chars = generateJisLevel1Kanji()
  if (!dryRun && out) await writeFileImpl(out, chars.join(''))
  if (json)
    return JSON.stringify(
      { out, dryRun, count: chars.length, chars: dryRun || out ? undefined : chars },
      null,
      2,
    )
  return formatResult({ out, dryRun, chars })
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    console.error(usage())
    process.exit(1)
    return
  }
  if (args.help) {
    console.log(usage())
    return
  }
  console.log(await run(args))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`予期しないエラー: ${err.message}`)
    process.exit(1)
  })
}
