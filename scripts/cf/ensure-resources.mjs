#!/usr/bin/env node
// D1 データベースと R2 バケット（どちらも名前は calshare）を、無ければ作り、あれば流用する。
// 何度実行しても同じ結果になる（冪等）。--write-wrangler を指定すると、生成/流用した
// D1 の database_id を wrangler.jsonc に書き戻す（プレースホルダの置換作業を自動化する）。
import { parseArgs } from 'node:util'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'
import { toMarkdownTable } from './lib/format.mjs'

const RESOURCE_NAME = 'calshare'

const USAGE = `使い方: node scripts/cf/ensure-resources.mjs [--write-wrangler <path>] [--dry-run] [--json] [--help]

D1 データベースと R2 バケット（名前は ${RESOURCE_NAME} 固定）を、無ければ作り、あれば流用する。

  --write-wrangler <path>   指定したファイルの d1_databases[0].database_id を実 ID に書き換える
                            （ファイルが無ければ何もしない。wrangler.jsonc が main に無い間は
                            このフラグを付けない）
  --dry-run                 API への書き込み（作成）を行わず、計画だけを表示する
  --json                    機械可読な JSON で出力する
  --help                    このヘルプを表示する`

/** @param {{ api: ReturnType<typeof createCfApi> }} deps */
export async function ensureD1Database({ api, name = RESOURCE_NAME }) {
  const existing = await api.getAll(
    `/accounts/${api.accountId}/d1/database?name=${encodeURIComponent(name)}`,
  )
  const found = existing.find((db) => db.name === name)
  if (found) return { name, uuid: found.uuid, created: false }

  const res = await api.post(`/accounts/${api.accountId}/d1/database`, { name })
  if (res.dryRun) return { name, uuid: null, created: true, dryRun: true }
  return { name, uuid: res.result.uuid, created: true }
}

/** @param {{ api: ReturnType<typeof createCfApi> }} deps */
export async function ensureR2Bucket({ api, name = RESOURCE_NAME }) {
  const list = await api.get(`/accounts/${api.accountId}/r2/buckets`)
  const found = (list.result?.buckets ?? []).find((b) => b.name === name)
  if (found) return { name, created: false }

  const res = await api.post(`/accounts/${api.accountId}/r2/buckets`, { name })
  return { name, created: true, dryRun: !!res.dryRun }
}

const DATABASE_ID_PATTERN = /"database_id"\s*:\s*"([0-9a-fA-F-]+)"/

/**
 * wrangler.jsonc の内容の中の database_id を書き換える。コメント入り JSONC を
 * パースせずに正規表現で 1 箇所だけ置換する（§11.7 の雛形は該当行が 1 つだけの前提）。
 * @param {string} content
 * @param {string} newUuid
 * @returns {{ content: string, changed: boolean, oldId: string | null }}
 */
export function updateWranglerDatabaseId(content, newUuid) {
  const match = content.match(DATABASE_ID_PATTERN)
  if (!match) return { content, changed: false, oldId: null }
  const oldId = match[1]
  if (oldId === newUuid) return { content, changed: false, oldId }
  return {
    content: content.replace(DATABASE_ID_PATTERN, `"database_id": "${newUuid}"`),
    changed: true,
    oldId,
  }
}

/** @param {{ api: ReturnType<typeof createCfApi>, writeWranglerPath?: string }} deps */
export async function run({ api, writeWranglerPath }) {
  const d1 = await ensureD1Database({ api })
  const r2 = await ensureR2Bucket({ api })

  let wrangler = null
  if (writeWranglerPath) {
    if (!existsSync(writeWranglerPath)) {
      wrangler = { path: writeWranglerPath, applied: false, reason: 'ファイルが存在しません' }
    } else if (!d1.uuid) {
      wrangler = {
        path: writeWranglerPath,
        applied: false,
        reason: 'dry-run のため D1 の ID が未確定です',
      }
    } else {
      const before = readFileSync(writeWranglerPath, 'utf8')
      const { content, changed, oldId } = updateWranglerDatabaseId(before, d1.uuid)
      if (changed) writeFileSync(writeWranglerPath, content)
      wrangler = { path: writeWranglerPath, applied: changed, oldId, newId: d1.uuid }
    }
  }

  return { d1, r2, wrangler }
}

function formatText({ d1, r2, wrangler }) {
  const rows = [
    [
      'D1 データベース',
      d1.name,
      d1.created ? '新規作成' : '既存を流用',
      d1.uuid ?? '(dry-run のため未確定)',
    ],
    ['R2 バケット', r2.name, r2.created ? '新規作成' : '既存を流用', '-'],
  ]
  const table = toMarkdownTable(['リソース', '名前', '状態', 'ID'], rows)
  if (!wrangler) return table
  const wranglerLine = wrangler.applied
    ? `wrangler.jsonc の database_id を ${wrangler.oldId} → ${wrangler.newId} に書き換えました（${wrangler.path}）。`
    : `wrangler.jsonc は更新しませんでした（${wrangler.reason ?? '変更不要'}）。`
  return `${table}\n\n${wranglerLine}`
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'write-wrangler': { type: 'string' },
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

  const { token, accountId } = readCfEnv()
  const api = createCfApi({ token, accountId, dryRun: values['dry-run'] })
  const result = await run({ api, writeWranglerPath: values['write-wrangler'] })
  console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
