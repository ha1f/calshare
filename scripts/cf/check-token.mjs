#!/usr/bin/env node
// Cloudflare API トークンが provisioning に必要な権限を持っているか検証する。
// GET /user/tokens/verify に加え、実際に使う各エンドポイントへの読み取りを試すことで、
// 「トークンは有効だが特定の権限が無い」ケースも検出する（読み取り権限は編集権限に含まれる）。
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'
import { toMarkdownTable } from './lib/format.mjs'

const USAGE = `使い方: node scripts/cf/check-token.mjs [--json] [--dry-run] [--help]

CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID（環境変数）が
provisioning に必要な権限を持っているかを確認する（読み取りのみ）。

  --json      機械可読な JSON で出力する
  --dry-run   このスクリプトは読み取りのみなので指定しても動作は変わらない
  --help      このヘルプを表示する

権限が不足している場合は docs/runbooks/cloudflare-api-token.md の権限テンプレートを
参照してトークンを発行し直してください。`

/** 確認する項目。permission は失敗時に「このあたりの権限を見直せばよい」という手がかり */
function buildChecks(accountId) {
  return [
    {
      name: 'D1 データベース一覧',
      path: `/accounts/${accountId}/d1/database?per_page=1`,
      permission: 'Account > D1:Edit',
    },
    {
      name: 'R2 バケット一覧',
      path: `/accounts/${accountId}/r2/buckets`,
      permission: 'Account > Workers R2 Storage:Edit',
    },
    {
      name: 'Workers スクリプト一覧',
      path: `/accounts/${accountId}/workers/scripts`,
      permission: 'Account > Workers Scripts:Edit',
    },
    {
      name: 'ゾーン一覧',
      path: `/zones?account.id=${accountId}&per_page=1`,
      permission: 'Zone > Zone:Edit（ゾーン作成用）',
    },
  ]
}

/**
 * scripts/cf/usage-report.mjs（H12）が使う GraphQL Analytics API の疎通確認。
 * 通常の REST エンドポイントとは別の権限（Account Analytics:Read）が要るため、
 * 上の buildChecks とは別に POST /graphql で最小のクエリを投げて確認する。
 */
async function checkAnalytics({ api, accountId }) {
  const query =
    'query CheckAnalytics($accountTag: string!) { viewer { accounts(filter: { accountTag: $accountTag }) { accountTag } } }'
  const json = await api.post('/graphql', { query, variables: { accountTag: accountId } })
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
}

/**
 * @param {{ api: ReturnType<typeof createCfApi>, accountId: string }} deps
 * @returns {Promise<{ checks: Array<{name: string, ok: boolean, error?: string, permission?: string}>, allOk: boolean }>}
 */
export async function checkToken({ api, accountId }) {
  const checks = []

  try {
    const res = await api.get('/user/tokens/verify')
    const status = res.result?.status
    if (status === 'active') {
      checks.push({ name: 'トークンの有効性', ok: true })
    } else {
      checks.push({
        name: 'トークンの有効性',
        ok: false,
        error: `トークンの status が active ではありません: ${status}`,
        permission: 'トークンを再発行するか、Cloudflare ダッシュボードで有効化してください',
      })
    }
  } catch (err) {
    checks.push({
      name: 'トークンの有効性',
      ok: false,
      error: err.message,
      permission: '（トークン自体が無効か失効しています）',
    })
  }

  for (const check of buildChecks(accountId)) {
    try {
      await api.get(check.path)
      checks.push({ name: check.name, ok: true })
    } catch (err) {
      checks.push({ name: check.name, ok: false, error: err.message, permission: check.permission })
    }
  }

  try {
    await checkAnalytics({ api, accountId })
    checks.push({ name: 'Analytics (GraphQL) 疎通確認', ok: true })
  } catch (err) {
    checks.push({
      name: 'Analytics (GraphQL) 疎通確認',
      ok: false,
      error: err.message,
      permission: 'Account > Account Analytics:Read',
    })
  }

  return { checks, allOk: checks.every((c) => c.ok) }
}

function formatText({ checks, allOk }) {
  const rows = checks.map((c) => [
    c.ok ? 'OK' : 'NG',
    c.name,
    c.ok ? '-' : c.permission,
    c.ok ? '-' : c.error,
  ])
  const table = toMarkdownTable(
    ['状態', '確認内容', '不足している可能性のある権限', 'エラー'],
    rows,
  )
  const conclusion = allOk
    ? '全チェック OK です。'
    : '一部のチェックが失敗しました。上表の「不足している可能性のある権限」をトークンに追加し、再実行してください。'
  return `${table}\n\n${conclusion}`
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log(USAGE)
    return
  }
  if (values['dry-run']) {
    console.error('[check-token] 読み取りのみのスクリプトなので --dry-run は結果に影響しません。')
  }

  const { token, accountId } = readCfEnv()
  const api = createCfApi({ token, accountId })
  const result = await checkToken({ api, accountId })
  console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result))
  if (!result.allOk) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
