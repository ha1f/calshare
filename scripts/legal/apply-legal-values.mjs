#!/usr/bin/env node
// docs/legal/*.md の未記入プレースホルダ（施行日・運営者・管轄裁判所・変更履歴）を
// オーナーが決めた値で一括置換する。3ファイル×複数箇所への手作業を1コマンドにまとめる。
//
// 対象は docs/legal/terms.md / privacy.md / report-policy.md の3つ（決め打ち）。
// 対象ファイルが存在しなければスキップする。依存ゼロ（Node 標準ライブラリのみ）。
//
// 使い方:
//   node scripts/legal/apply-legal-values.mjs --effective-date <date> --operator <text> --court <text> [--dry-run] [--json]
//
// 適用後は `node scripts/legal/checkLegalDocs.mjs --strict` で未記入が無いことを確認する。

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const LEGAL_FILES = [
  'docs/legal/terms.md',
  'docs/legal/privacy.md',
  'docs/legal/report-policy.md',
]

function usage() {
  return [
    '使い方: node scripts/legal/apply-legal-values.mjs --effective-date <date> --operator <text> --court <text> [--dry-run] [--json]',
    '',
    '  --effective-date <date>  施行日（例: 2026-10-01）。変更履歴の日付にも使う',
    '  --operator <text>        運営者の表記（個人名または屋号）',
    '  --court <text>           terms.md 第17条の専属的合意管轄裁判所（例: 東京地方裁判所）',
    '  --root <dir>             リポジトリルート（既定: カレントディレクトリ。主にテスト用）',
    '  --dry-run                書き込みをせず、変更予定の行だけ表示する',
    '  --json                   機械可読な JSON で出力する',
    '',
    '適用後は node scripts/legal/checkLegalDocs.mjs --strict で未記入が無いことを確認する。',
    '',
    '例: node scripts/legal/apply-legal-values.mjs --effective-date 2026-10-01 --operator calshare運営事務局 --court 東京地方裁判所 --dry-run',
  ].join('\n')
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { dryRun: false, json: false, root: '.' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--effective-date') args.effectiveDate = argv[++i]
    else if (a === '--operator') args.operator = argv[++i]
    else if (a === '--court') args.court = argv[++i]
    else if (a === '--root') args.root = argv[++i]
  }
  return args
}

/**
 * 「施行日: 」の行を書き換える。
 * @param {string} content
 * @param {{ effectiveDate: string }} opts
 */
export function transformEffectiveDate(content, { effectiveDate }) {
  const pattern = /^施行日: .*$/m
  if (!pattern.test(content)) return null
  return replaceWithLineLog(content, pattern, `施行日: ${effectiveDate}`)
}

/**
 * 「運営者: 」の行を書き換える。
 * @param {string} content
 * @param {{ operator: string }} opts
 */
export function transformOperator(content, { operator }) {
  const pattern = /^運営者: .*$/m
  if (!pattern.test(content)) return null
  return replaceWithLineLog(content, pattern, `運営者: ${operator}`)
}

/**
 * terms.md 第17条の管轄裁判所プレースホルダを書き換える。他の2文書には無いので null を返す。
 * @param {string} content
 * @param {{ court: string }} opts
 */
export function transformCourt(content, { court }) {
  const pattern = /（オーナーが記入。例: ○○地方裁判所）/
  if (!pattern.test(content)) return null
  return replaceWithLineLog(content, pattern, court)
}

/**
 * 変更履歴表を更新する。未記入の「（記入）」行があればそこを施行日で埋め、
 * 無ければ（初版が記入済みの再実行）末尾に改定行を1行追加する。
 * 追加しようとする日付の行が既にあれば、二重実行として何もしない。
 * @param {string} content
 * @param {{ effectiveDate: string }} opts
 */
export function transformChangelog(content, { effectiveDate }) {
  const placeholderRowPattern = /^(\|\s*)（記入）(\s*\|.*)$/m
  if (placeholderRowPattern.test(content)) {
    return replaceWithLineLog(content, placeholderRowPattern, `$1${effectiveDate}$2`)
  }

  const lines = content.split('\n')
  const headingIndex = lines.findIndex((l) => /^## 変更履歴/.test(l))
  if (headingIndex === -1) return null

  let lastRowIndex = -1
  for (let i = headingIndex; i < lines.length; i++) {
    if (/^\|.*\|$/.test(lines[i])) lastRowIndex = i
  }
  if (lastRowIndex === -1) return null

  const dateAlreadyRecorded = new RegExp(`^\\|\\s*${escapeRegExp(effectiveDate)}\\s*\\|`).test(
    lines[lastRowIndex],
  )
  if (dateAlreadyRecorded) return null

  const newRow = `| ${effectiveDate} | 改定 |`
  const newLines = [...lines.slice(0, lastRowIndex + 1), newRow, ...lines.slice(lastRowIndex + 1)]
  return {
    content: newLines.join('\n'),
    lines: [{ line: lastRowIndex + 2, before: '', after: newRow }],
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** pattern（global 可）を replacement に置換し、変わった行番号を集める */
function replaceWithLineLog(content, pattern, replacement) {
  const newContent = content.replace(pattern, replacement)
  return { content: newContent, lines: diffLines(content, newContent) }
}

/** 行単位で before/after を比較し、変化した行だけを返す */
function diffLines(before, after) {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const lines = []
  const max = Math.max(beforeLines.length, afterLines.length)
  for (let i = 0; i < max; i++) {
    if (beforeLines[i] !== afterLines[i]) {
      lines.push({ line: i + 1, before: beforeLines[i] ?? '', after: afterLines[i] ?? '' })
    }
  }
  return lines
}

function transformsFor(file, opts) {
  const list = [
    (c) => transformEffectiveDate(c, opts),
    (c) => transformOperator(c, opts),
    (c) => transformChangelog(c, opts),
  ]
  if (file === 'docs/legal/terms.md') list.push((c) => transformCourt(c, opts))
  return list
}

/**
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.effectiveDate
 * @param {string} opts.operator
 * @param {string} opts.court
 * @param {boolean} opts.dryRun
 * @param {(p: string) => Promise<string>} [opts.readFileImpl]
 * @param {(p: string, c: string) => Promise<void>} [opts.writeFileImpl]
 */
export async function applyLegalValues(opts) {
  const { root, dryRun, readFileImpl = readFile, writeFileImpl = writeFile } = opts
  const results = []
  for (const file of LEGAL_FILES) {
    const filePath = path.join(root, file)
    let content
    try {
      content = await readFileImpl(filePath, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') {
        results.push({ file, status: 'skipped', reason: 'ファイルが存在しない' })
        continue
      }
      throw err
    }

    let current = content
    const allLines = []
    for (const transform of transformsFor(file, opts)) {
      const changed = transform(current)
      if (changed) {
        current = changed.content
        allLines.push(...changed.lines)
      }
    }

    if (allLines.length === 0) {
      results.push({ file, status: 'unchanged', reason: '置き換え対象の文字列が見つからない' })
      continue
    }
    if (!dryRun) await writeFileImpl(filePath, current)
    results.push({ file, status: dryRun ? 'planned' : 'written', lines: allLines })
  }
  return results
}

/** @param {Awaited<ReturnType<typeof applyLegalValues>>} results */
export function formatResults(results, { dryRun }) {
  const out = []
  for (const r of results) {
    if (r.status === 'skipped') out.push(`[skip] ${r.file} — ${r.reason}`)
    else if (r.status === 'unchanged') out.push(`[--] ${r.file} — ${r.reason}`)
    else {
      out.push(`[${dryRun ? 'dry-run' : 'write'}] ${r.file}`)
      for (const l of r.lines) out.push(`  L${l.line}: ${l.before.trim()} -> ${l.after.trim()}`)
    }
  }
  return out.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (process.argv.slice(2).includes('--help')) {
    console.log(usage())
    return
  }
  if (!args.effectiveDate || !args.operator || !args.court) {
    console.error(usage())
    process.exit(1)
    return
  }
  const results = await applyLegalValues(args)
  if (args.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    console.log(formatResults(results, args))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`予期しないエラー: ${err.message}`)
    process.exit(1)
  })
}
