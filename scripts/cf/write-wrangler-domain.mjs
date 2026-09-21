#!/usr/bin/env node
// wrangler.jsonc の routes・workers_dev を、独自ドメイン割り当て（H3）に合わせて
// コメント入り JSONC のまま最小限の正規表現置換で書き換える。
// docs/runbooks/custom-domain.md の手順 3（雛形を手で書いて PR を作る）を自動化し、
// オーナーに残るのはネームサーバー変更と自動作成された PR の確認だけにする。
//
// vars.PUBLIC_ORIGIN はここでは書き換えない。本番の値は
// `.github/workflows/deploy.yml` の `wrangler deploy --var PUBLIC_ORIGIN:https://...` が
// デプロイのたびに上書きしており（design.md §11.7）、wrangler.jsonc 本体の値を
// localhost から書き換えると、それを既定値として使うローカル開発・CI 統合テスト
// （test/integration/helpers/jsonRequest.ts の TEST_ORIGIN）と食い違う。
//
// routes が既に存在する場合は書き換えない。手動で調整した内容を上書きしないため。
import { parseArgs } from 'node:util'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const USAGE = `使い方: node scripts/cf/write-wrangler-domain.mjs --domain <domain> [--path <file>] [--dry-run] [--json] [--help]

<domain> を Custom Domain として割り当てるため、wrangler.jsonc の workers_dev を false にし、
routes に { "pattern": "<domain>", "custom_domain": true } を追加する。

  --domain <domain>       割り当てるドメイン（必須。ホスト名のみ。パス・ワイルドカード不可）
  --path <file>           対象ファイル（既定: wrangler.jsonc。無ければ何もしない）
  --dry-run               ファイルに書き込まず、書き換え後の内容を表示するだけにする
  --json                  結果を JSON で出力する
  --help                  このヘルプを表示する`

// ラベルは 1〜63 文字・英数字とハイフン・先頭末尾はハイフン不可。2 ラベル以上必須（TLD を要求する）。
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

export function validateDomain(domain) {
  if (typeof domain !== 'string' || !DOMAIN_PATTERN.test(domain)) {
    throw new Error(
      `ドメイン形式が不正です: ${JSON.stringify(domain)}（ホスト名のみ指定できます。パスやワイルドカードは付けられません）`,
    )
  }
  return domain
}

const WORKERS_DEV_PATTERN = /"workers_dev"\s*:\s*(?:true|false)/
const ROUTES_KEY_PATTERN = /"routes"\s*:/

/**
 * wrangler.jsonc の内容に routes・workers_dev の書き換えを適用する純粋関数。
 * @param {string} content
 * @param {string} domain
 * @returns {{ content: string, changed: boolean, reason?: string }}
 */
export function applyDomainToWrangler(content, domain) {
  validateDomain(domain)
  if (ROUTES_KEY_PATTERN.test(content)) {
    return { content, changed: false, reason: 'routes は既に設定されています（上書きしません）' }
  }
  if (!WORKERS_DEV_PATTERN.test(content)) {
    return {
      content,
      changed: false,
      reason: '"workers_dev" が見つかりません（wrangler.jsonc の形式が想定と違います）',
    }
  }
  const replacement = `"workers_dev": false,\n  "routes": [{ "pattern": "${domain}", "custom_domain": true }]`
  return { content: content.replace(WORKERS_DEV_PATTERN, replacement), changed: true }
}

/** @param {{ path: string, domain: string, dryRun: boolean }} args */
export function run({ path, domain, dryRun }) {
  validateDomain(domain)
  if (!existsSync(path)) {
    return { path, applied: false, wouldApply: false, reason: `${path} が存在しません` }
  }
  const before = readFileSync(path, 'utf8')
  const { content, changed, reason } = applyDomainToWrangler(before, domain)
  if (changed && !dryRun) writeFileSync(path, content)
  return { path, applied: changed && !dryRun, wouldApply: changed, reason }
}

function formatText(result, dryRun) {
  if (!result.wouldApply) {
    return `変更しませんでした（${result.reason ?? '既に設定済み'}）: ${result.path}`
  }
  return dryRun
    ? `[dry-run] ${result.path} の routes・workers_dev を書き換える予定です。`
    : `${result.path} の routes・workers_dev を書き換えました。`
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      domain: { type: 'string' },
      path: { type: 'string', default: 'wrangler.jsonc' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log(USAGE)
    return
  }
  if (!values.domain) {
    console.error('--domain は必須です。\n')
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  try {
    const result = run({ path: values.path, domain: values.domain, dryRun: values['dry-run'] })
    console.log(
      values.json ? JSON.stringify(result, null, 2) : formatText(result, values['dry-run']),
    )
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
