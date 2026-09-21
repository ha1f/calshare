#!/usr/bin/env node
// docs/legal/*.md のフォーマット（施行日・運営者の行、条番号の連番、変更履歴表）と、
// 未記入のプレースホルダ（「（オーナーが記入…）」「（記入）」）の残存を検査する。
// 文言そのものの妥当性・法的な正しさは検査しない。オーナーが確認すべき事項は docs/runbooks/legal.md にまとめる。
// 依存ゼロ（Node 標準ライブラリのみ）。書き込みは一切行わない。

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..')
export const LEGAL_FILES = [
  'docs/legal/terms.md',
  'docs/legal/privacy.md',
  'docs/legal/report-policy.md',
]

/**
 * Markdown 1 本のテキストを検査し、フォーマット上の不備をメッセージの配列で返す。
 * 不備が無ければ空配列を返す。
 * @param {string} text
 * @returns {string[]}
 */
export function checkLegalDocText(text) {
  const errors = []

  if (!/^施行日: /m.test(text)) errors.push('「施行日: 」の行が無い')
  if (!/^運営者: /m.test(text)) errors.push('「運営者: 」の行が無い')

  const articleNumbers = [...text.matchAll(/^## 第(\d+)条/gm)].map((m) => Number(m[1]))
  if (articleNumbers.length === 0) {
    errors.push('「## 第N条」の条文見出しが無い')
  } else {
    articleNumbers.forEach((n, i) => {
      if (n !== i + 1)
        errors.push(`条番号が連番でない（${i + 1} 番目の見出しが第${n}条になっている）`)
    })
  }

  const changelogIndex = text.search(/^## 変更履歴/m)
  if (changelogIndex === -1) {
    errors.push('「## 変更履歴」の見出しが無い')
  } else if (!/\|\s*日付\s*\|\s*変更内容\s*\|/.test(text.slice(changelogIndex))) {
    errors.push('変更履歴の表に「日付」「変更内容」の列が無い')
  }

  return errors
}

const PLACEHOLDER_PATTERN = /（オーナーが記入[^）]*）|（記入）/g

/**
 * 未記入のプレースホルダ（「（オーナーが記入…）」「（記入）」）を行番号付きで返す。
 * 見つからなければ空配列を返す。
 * @param {string} text
 * @returns {string[]}
 */
export function findPlaceholders(text) {
  const found = []
  text.split('\n').forEach((line, i) => {
    const matches = line.match(PLACEHOLDER_PATTERN)
    if (matches) {
      for (const m of matches) found.push(`${i + 1}行目: ${m}`)
    }
  })
  return found
}

/**
 * 対象ファイル群を読み込み、それぞれにcheckLegalDocTextとfindPlaceholdersを適用する。
 * `ok` はフォーマット検査（checkLegalDocText）の結果のみを表し、プレースホルダの残存は含めない。
 * @param {string} [root] リポジトリルート（テストから差し替え可能にするための引数）
 * @param {string[]} [files] root からの相対パスの一覧
 * @returns {Promise<{ file: string, ok: boolean, errors: string[], placeholders: string[] }[]>}
 */
export async function checkAllLegalDocs(root = REPO_ROOT, files = LEGAL_FILES) {
  const results = []
  for (const file of files) {
    let text
    try {
      text = await readFile(path.join(root, file), 'utf8')
    } catch {
      results.push({ file, ok: false, errors: ['ファイルが存在しない'], placeholders: [] })
      continue
    }
    const errors = checkLegalDocText(text)
    const placeholders = findPlaceholders(text)
    results.push({ file, ok: errors.length === 0, errors, placeholders })
  }
  return results
}

/**
 * 掲載前の判定。フォーマットエラーがあれば常に false。
 * strict では、これに加えて未記入のプレースホルダが1件でもあれば false にする（掲載可否のゲート）。
 * @param {{ ok: boolean, placeholders: string[] }[]} results
 * @param {{ strict: boolean }} opts
 * @returns {boolean}
 */
export function isReleaseReady(results, { strict }) {
  const formatOk = results.every((r) => r.ok)
  if (!strict) return formatOk
  return formatOk && results.every((r) => r.placeholders.length === 0)
}

const KNOWN_FLAGS = new Set(['--strict', '--help', '--json'])

/**
 * CLI 引数を検証する。未知の引数（打ち間違い等）を黙って無視すると、掲載前検査が
 * 通ったように見えてしまうため例外にする。
 * @param {string[]} argv
 * @returns {{ strict: boolean, help: boolean, json: boolean }}
 */
export function parseArgs(argv) {
  for (const a of argv) {
    if (!KNOWN_FLAGS.has(a)) throw new Error(`不明な引数です: ${a}`)
  }
  return {
    strict: argv.includes('--strict'),
    help: argv.includes('--help'),
    json: argv.includes('--json'),
  }
}

function printHelp() {
  console.log(`使い方: node scripts/legal/checkLegalDocs.mjs [--strict] [--json]

docs/legal/terms.md / privacy.md / report-policy.md のフォーマットと、未記入のプレースホルダの残存を検査する。
フォーマット検査は「施行日」「運営者」の行、条番号の連番、末尾の変更履歴表の3点のみで、
文言そのものの妥当性・法的な正しさは検査しない（オーナーが確認すべき事項は docs/runbooks/legal.md を参照）。
プレースホルダ（「（オーナーが記入…）」「（記入）」）の残存は、既定では警告として一覧表示するのみで終了コードに影響しない。
引数を何も指定しない場合も検査を実行する（読み取り専用で、書き込みは一切行わない）。

オプション:
  --strict  未記入のプレースホルダが1件でもあれば終了コード1にする（掲載前の最終確認用）
  --help    このヘルプを表示して終了する
  --json    結果を JSON で出力する（CI 等での利用を想定）
`)
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err.message)
    printHelp()
    process.exitCode = 1
    return
  }
  if (args.help) {
    printHelp()
    return
  }
  const { strict } = args

  const results = await checkAllLegalDocs()
  const ok = isReleaseReady(results, { strict })

  if (args.json) {
    console.log(JSON.stringify({ ok, strict, results }, null, 2))
  } else {
    for (const r of results) {
      if (r.ok) {
        console.log(`OK   ${r.file}`)
      } else {
        console.log(`NG   ${r.file}`)
        for (const e of r.errors) console.log(`       - ${e}`)
      }
      if (r.placeholders.length > 0) {
        console.log(`WARN ${r.file} — 未記入のプレースホルダが${r.placeholders.length}件`)
        for (const p of r.placeholders) console.log(`       - ${p}`)
      }
    }
  }
  process.exitCode = ok ? 0 : 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
