#!/usr/bin/env node
// ローカルの wrangler dev（`--local`）が使う R2 エミュレーションに OGP 用フォントを投入する。
// wrangler dev はローカル D1 と違い R2 の内容を自動では用意しないため、
// npm run dev と playwright.config.ts の webServer.command が、wrangler dev の起動前にこれを実行する。
//
// 使い方:
//   node scripts/seed-local-r2.mjs [--font <path>] [--dry-run] [--json] [--help]
//
// フォントはリポジトリ同梱のサブセット済みフィクスチャ（test/fixtures/fonts/）を使う。
// ダウンロード・サブセット化（scripts/fonts/download-noto-sans-jp.mjs・subset.sh）は
// provisioning 用の別経路で、ローカル開発・e2e ではネットワークも Python も要らないここを使う。
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const BUCKET_NAME = 'calshare'
// server/deps.ts の OGP_FONT_KEY と一致させる
const FONT_KEY = 'fonts/NotoSansJP-Regular.subset.otf'
const DEFAULT_FONT_PATH = 'test/fixtures/fonts/NotoSansJP-Regular.subset.otf'

function usage() {
  return [
    '使い方: node scripts/seed-local-r2.mjs [--font <path>] [--dry-run] [--json] [--help]',
    '',
    `投入先: ${BUCKET_NAME}/${FONT_KEY}（--local。wrangler dev のローカル R2 エミュレーション）`,
    `既定のフォント: ${DEFAULT_FONT_PATH}`,
  ].join('\n')
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { font: DEFAULT_FONT_PATH, dryRun: false, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--font') args.font = argv[++i]
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--help') args.help = true
    else throw new Error(`不明な引数です: ${a}`)
  }
  return args
}

/** wrangler の標準出力・標準エラーをそのまま端末に流す。既定の pipe だと失敗時に
 * wrangler 側のエラーメッセージ（ログイン要求や設定不備など）が呼び出し元から見えなくなる */
function execFileInherit(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

/**
 * @param {object} options
 * @param {string} options.font
 * @param {boolean} [options.dryRun]
 * @param {(cmd: string, args: string[]) => void} [options.execFileImpl]
 * @param {(path: string) => boolean} [options.existsImpl]
 */
export function seedLocalR2(options) {
  const { font, dryRun = false, execFileImpl = execFileInherit, existsImpl = existsSync } = options

  if (!existsImpl(font)) {
    throw new Error(
      `フォントが見つかりません: ${font}\n` +
        'test/fixtures/fonts/ にサブセット済みフォントが同梱されているか確認してください。',
    )
  }

  const putArgs = [
    'wrangler',
    'r2',
    'object',
    'put',
    `${BUCKET_NAME}/${FONT_KEY}`,
    '--local',
    '--file',
    font,
  ]

  if (dryRun) return { dryRun: true, bucket: BUCKET_NAME, key: FONT_KEY, font }

  execFileImpl('npx', putArgs)
  return { dryRun: false, bucket: BUCKET_NAME, key: FONT_KEY, font }
}

/** @param {ReturnType<typeof seedLocalR2>} result */
export function formatResult(result) {
  const target = `${result.bucket}/${result.key}`
  if (result.dryRun) return `[dry-run] ${result.font} を ${target}（--local）に投入予定`
  return `${result.font} を ${target}（--local）に投入しました`
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
  const result = seedLocalR2(args)
  if (args.json) console.log(JSON.stringify(result, null, 2))
  else console.log(formatResult(result))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`予期しないエラー: ${err.message}`)
    process.exit(1)
  })
}
