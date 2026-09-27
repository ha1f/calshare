#!/usr/bin/env node
// 独自ドメインのゾーン（type: full）が Cloudflare アカウントに無ければ作成し、
// 割り当てられたネームサーバーを出す。既存なら現在の状態とネームサーバーを出す。
// ゾーン作成そのものは自動化できるが、レジストラ側のネームサーバー変更は
// 本人認証が要るため人間に残る（docs/runbooks/custom-domain.md）。
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'
import { toMarkdownTable } from './lib/format.mjs'

const USAGE = `使い方: node scripts/cf/ensure-zone.mjs --domain <domain> [--dry-run] [--json] [--help]

<domain> のゾーンが無ければ作成し（type: full）、割り当てられたネームサーバーを表示する。
既存なら現在の状態（active / pending）とネームサーバーを表示する。

  --domain <domain>   対象のドメイン名（必須）
  --dry-run           ゾーンの新規作成を行わず、計画だけを表示する
  --json              機械可読な JSON で出力する
  --help              このヘルプを表示する`

/** @param {{ api: ReturnType<typeof createCfApi>, domain: string }} deps */
export async function ensureZone({ api, domain }) {
  const zones = await api.getAll(
    `/zones?name=${encodeURIComponent(domain)}&account.id=${api.accountId}`,
  )
  const existing = zones.find((z) => z.name === domain)
  if (existing) {
    return {
      domain,
      existed: true,
      id: existing.id,
      status: existing.status,
      nameServers: existing.name_servers ?? [],
    }
  }

  const res = await api.post('/zones', {
    name: domain,
    account: { id: api.accountId },
    type: 'full',
  })
  if (res.dryRun)
    return { domain, existed: false, id: null, status: null, nameServers: [], dryRun: true }
  return {
    domain,
    existed: false,
    id: res.result.id,
    status: res.result.status,
    nameServers: res.result.name_servers ?? [],
  }
}

function formatText({ domain, existed, status, nameServers, dryRun }) {
  const rows = [
    ['ドメイン', domain],
    [
      '状態',
      existed ? '既存のゾーンを流用' : dryRun ? '新規作成（dry-run のため未実行）' : '新規作成',
    ],
    ['ステータス', status ?? '(dry-run のため未確定)'],
    [
      'ネームサーバー',
      nameServers.length
        ? nameServers.join(', ')
        : '(dry-run のため未確定。実行後に確認してください)',
    ],
  ]
  const table = toMarkdownTable(['項目', '値'], rows)
  const note = nameServers.length
    ? '\n\n上記のネームサーバーをドメインのレジストラに設定してください（docs/runbooks/custom-domain.md）。'
    : ''
  return `${table}${note}`
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      domain: { type: 'string' },
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

  const { token, accountId } = readCfEnv()
  const api = createCfApi({ token, accountId, dryRun: values['dry-run'] })
  const result = await ensureZone({ api, domain: values.domain })
  console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
