#!/usr/bin/env node
// Noto Sans JP Regular（SIL OFL 1.1）を公式ソースから取得する。
// 取得元は notofonts/noto-cjk の GitHub Release（Sans2.004、Noto Sans JP 単体パッケージ）。
// 依存ゼロ（Node 標準の fetch と zlib のみ）。zip 展開は ./zip.mjs（store/deflate のみ対応）。
//
// 使い方:
//   node scripts/fonts/download-noto-sans-jp.mjs [--out <dir>] [--dry-run] [--json]
//
// URL・SHA-256 は実機で確認済み（docs/runbooks/fonts.md に記録）。
// ダウンロードしたファイル自体はコミットしない（既定の保存先 .claude/tmp は gitignore 済み）。

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { readZipEntry } from './zip.mjs'

// バージョンを固定しているのは再現性のため。更新するときはここと docs/runbooks/fonts.md を両方直す。
const RELEASE_ZIP_URL =
  'https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/16_NotoSansJP.zip'
const REGULAR_ENTRY_NAME = 'NotoSansJP-Regular.otf'
const LICENSE_ENTRY_NAME = 'LICENSE'
const DEFAULT_OUT_DIR = '.claude/tmp/fonts'

function usage() {
  return [
    '使い方: node scripts/fonts/download-noto-sans-jp.mjs [--out <dir>] [--dry-run] [--json]',
    '',
    `取得元: ${RELEASE_ZIP_URL}`,
    `既定の保存先: ${DEFAULT_OUT_DIR}（NotoSansJP-Regular.otf と LICENSE.txt を保存する）`,
    '',
    '--dry-run を付けるとダウンロードも書き込みもせず、取得元と保存予定のパスだけを表示する。',
  ].join('\n')
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { out: DEFAULT_OUT_DIR, dryRun: false, json: false, help: false }
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

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * @param {object} options
 * @param {string} options.out 保存先ディレクトリ
 * @param {boolean} [options.dryRun]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {typeof mkdir} [options.mkdirImpl]
 * @param {typeof writeFile} [options.writeFileImpl]
 */
export async function downloadNotoSansJp(options) {
  const {
    out,
    dryRun = false,
    fetchImpl = fetch,
    mkdirImpl = mkdir,
    writeFileImpl = writeFile,
  } = options
  const regularPath = path.join(out, 'NotoSansJP-Regular.otf')
  const licensePath = path.join(out, 'LICENSE.txt')

  if (dryRun) {
    return { dryRun: true, url: RELEASE_ZIP_URL, plannedFiles: [regularPath, licensePath] }
  }

  const res = await fetchImpl(RELEASE_ZIP_URL)
  if (!res.ok)
    throw new Error(`ダウンロードに失敗しました（HTTP ${res.status}）: ${RELEASE_ZIP_URL}`)
  const zipBuffer = Buffer.from(await res.arrayBuffer())
  const regular = readZipEntry(zipBuffer, REGULAR_ENTRY_NAME)
  const license = readZipEntry(zipBuffer, LICENSE_ENTRY_NAME)

  await mkdirImpl(out, { recursive: true })
  await writeFileImpl(regularPath, regular)
  await writeFileImpl(licensePath, license)

  return {
    dryRun: false,
    url: RELEASE_ZIP_URL,
    files: [
      { path: regularPath, bytes: regular.length, sha256: sha256(regular) },
      { path: licensePath, bytes: license.length, sha256: sha256(license) },
    ],
  }
}

/** @param {Awaited<ReturnType<typeof downloadNotoSansJp>>} result */
export function formatResult(result) {
  if (result.dryRun) {
    return [
      `[dry-run] 取得元: ${result.url}`,
      ...result.plannedFiles.map((f) => `[dry-run] 保存予定: ${f}`),
    ].join('\n')
  }
  return result.files.map((f) => `${f.path}  (${f.bytes} bytes)  sha256=${f.sha256}`).join('\n')
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
  const result = await downloadNotoSansJp(args)
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatResult(result))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`予期しないエラー: ${err.message}`)
    console.error('取得元・保存先の権限・ネットワーク到達性を確認してください。')
    process.exit(1)
  })
}
