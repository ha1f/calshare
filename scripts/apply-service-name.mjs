#!/usr/bin/env node
// サービス名とドメインが決まったあとに、リポジトリ内の仮値を一括で書き換える。
// 対象は次の3箇所のみ（決め打ち。それ以外の "calshare" 表記は意図的に変えない。
// design.md 本文中の FPI・localStorage キー等はコード実装時に SERVICE_NAME から
// 導出される値なので、実装側の変更で追従する）。
//
//   - wrangler.jsonc: name / vars.SERVICE_NAME、および routes 配下のドメイン
//   - README.md: 先頭見出し（# calshare）
//   - docs/design.md: 未決ドメインの仮値（既定 "calshare.example"）
//
// 対象ファイルが存在しなければスキップする（アプリ本体の実装がまだ無い場合など）。
// 依存ゼロ（Node 標準ライブラリのみ）。node:test で検証。
//
// 使い方:
//   node scripts/apply-service-name.mjs --name <slug> --domain <domain> [--dry-run] [--json]
//
// 例:
//   node scripts/apply-service-name.mjs --name yoteitte --domain yoteitte.com --dry-run

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_OLD_NAME = 'calshare'
const DEFAULT_OLD_DOMAIN = 'calshare.example'

function usage() {
  return [
    '使い方: node scripts/apply-service-name.mjs --name <slug> --domain <domain> [--dry-run] [--json]',
    '',
    '  --name <slug>      新しいサービス名（wrangler.jsonc の name / SERVICE_NAME・README.md の見出しに使う。英数字とハイフン推奨）',
    '  --domain <domain>  新しい本番ドメイン（docs/design.md の仮値 calshare.example・wrangler.jsonc の routes を置き換える）',
    '  --old-name <slug>  置き換え対象の現在値（既定: calshare）',
    '  --old-domain <d>   置き換え対象の現在の仮ドメイン（既定: calshare.example）',
    '  --root <dir>       リポジトリルート（既定: カレントディレクトリ。主にテスト用）',
    '  --dry-run          書き込みをせず、変更予定の行だけ表示する',
    '  --json             機械可読な JSON で出力する',
    '',
    '例: node scripts/apply-service-name.mjs --name yoteitte --domain yoteitte.com --dry-run',
  ].join('\n')
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = {
    dryRun: false,
    json: false,
    oldName: DEFAULT_OLD_NAME,
    oldDomain: DEFAULT_OLD_DOMAIN,
    root: '.',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--name') args.name = argv[++i]
    else if (a === '--domain') args.domain = argv[++i]
    else if (a === '--old-name') args.oldName = argv[++i]
    else if (a === '--old-domain') args.oldDomain = argv[++i]
    else if (a === '--root') args.root = argv[++i]
    else if (a === '--help') args.help = true
    else throw new Error(`不明な引数です: ${a}`)
  }
  return args
}

/**
 * README.md の先頭見出しを書き換える。
 * @param {string} content
 * @param {{ oldName: string, name: string }} opts
 */
export function transformReadme(content, { oldName, name }) {
  const pattern = new RegExp(`^# ${escapeRegExp(oldName)}[ \\t]*$`, 'm')
  if (!pattern.test(content)) return null
  return replaceWithLineLog(content, pattern, `# ${name}`)
}

/**
 * docs/design.md の未決ドメイン仮値を書き換える。
 * @param {string} content
 * @param {{ oldDomain: string, domain: string }} opts
 */
export function transformDesignDoc(content, { oldDomain, domain }) {
  const pattern = new RegExp(escapeRegExp(oldDomain), 'g')
  if (!pattern.test(content)) return null
  return replaceWithLineLog(content, pattern, domain)
}

/**
 * wrangler.jsonc の name / vars.SERVICE_NAME / routes 中のドメインを書き換える。
 * JSONC（コメント付き JSON）なので JSON.parse はせず正規表現で局所置換する。
 * @param {string} content
 * @param {{ oldName: string, name: string, oldDomain: string, domain: string }} opts
 */
export function transformWranglerJsonc(content, { oldName, name, oldDomain, domain }) {
  let result = content
  let changed = false
  const namePattern = new RegExp(`("name"\\s*:\\s*")${escapeRegExp(oldName)}(")`)
  if (namePattern.test(result)) {
    result = result.replace(namePattern, `$1${name}$2`)
    changed = true
  }
  const serviceNamePattern = new RegExp(`("SERVICE_NAME"\\s*:\\s*")${escapeRegExp(oldName)}(")`)
  if (serviceNamePattern.test(result)) {
    result = result.replace(serviceNamePattern, `$1${name}$2`)
    changed = true
  }
  const domainPattern = new RegExp(escapeRegExp(oldDomain), 'g')
  if (domainPattern.test(result)) {
    result = result.replace(domainPattern, domain)
    changed = true
  }
  if (!changed) return null
  return { content: result, lines: diffLines(content, result) }
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

const TARGETS = [
  { file: 'README.md', transform: transformReadme },
  { file: 'docs/design.md', transform: transformDesignDoc },
  { file: 'wrangler.jsonc', transform: transformWranglerJsonc },
]

/**
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.name
 * @param {string} opts.domain
 * @param {string} opts.oldName
 * @param {string} opts.oldDomain
 * @param {boolean} opts.dryRun
 * @param {(p: string) => Promise<string>} [opts.readFileImpl]
 * @param {(p: string, c: string) => Promise<void>} [opts.writeFileImpl]
 */
export async function applyServiceName(opts) {
  const {
    root,
    name,
    domain,
    oldName,
    oldDomain,
    dryRun,
    readFileImpl = readFile,
    writeFileImpl = writeFile,
  } = opts
  const results = []
  for (const target of TARGETS) {
    const filePath = path.join(root, target.file)
    let content
    try {
      content = await readFileImpl(filePath, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') {
        results.push({ file: target.file, status: 'skipped', reason: 'ファイルが存在しない' })
        continue
      }
      throw err
    }
    const changed = target.transform(content, { oldName, name, oldDomain, domain })
    if (!changed) {
      results.push({
        file: target.file,
        status: 'unchanged',
        reason: '置き換え対象の文字列が見つからない',
      })
      continue
    }
    if (!dryRun) await writeFileImpl(filePath, changed.content)
    results.push({
      file: target.file,
      status: dryRun ? 'planned' : 'written',
      lines: changed.lines,
    })
  }
  return results
}

/** @param {Awaited<ReturnType<typeof applyServiceName>>} results */
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
  if (!args.name || !args.domain) {
    console.error(usage())
    process.exit(1)
    return
  }
  const results = await applyServiceName(args)
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
