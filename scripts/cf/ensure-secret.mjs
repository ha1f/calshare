#!/usr/bin/env node
// Worker のシークレットが登録済みかどうかを判定し、無ければ生成して登録する。
// design.md H6・H7（RATE_LIMIT_PEPPER・REPORT_WEBHOOK_URL の登録）、
// docs/runbooks/{provisioning,deploy}.md から呼ばれる。
//
// 登録済み判定は `wrangler secret list --format json` の標準出力を JSON.parse して行い、
// grep には頼らない。判定できない場合（配列でない・list コマンド自体が失敗する）は、
// 既存の値を上書きしないよう登録を行わず失敗する
// （誤って新しい値で上書きすると、hide-by-creator が使う creator_ip_hash と
// 新規リクエストの ip_hash が食い違う。どちらも RATE_LIMIT_PEPPER を鍵にした HMAC のため）。
//
// wrangler の呼び出しは main() の外に出し、テストでは listSecrets / putSecret を
// 差し替えて判定ロジックだけを検証する。
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'

const USAGE = `使い方: node scripts/cf/ensure-secret.mjs --name <SECRET_NAME> [--value <値>]
       [--require-deployed --worker-name <name>] [--dry-run] [--json] [--help]

Worker のシークレット <SECRET_NAME> が登録済みかを \`wrangler secret list --format json\` の
出力で判定し、未登録なら登録する（既定はランダムな 32 バイトを base64 で生成。--value を
指定すればその値を使う）。判定できない場合は既存の値を壊さないよう何もせず失敗する。

  --name <NAME>           対象のシークレット名（必須）
  --value <値>            登録する値（省略時はランダム値を生成する）
  --force                 既に登録済みでも --value の内容で上書きする
                          （REPORT_WEBHOOK_URL のように GitHub Secrets の値と常に一致させたい
                          シークレット向け。RATE_LIMIT_PEPPER のように一度登録したら変えては
                          いけない値には付けないこと）
  --require-deployed      先に Cloudflare API で Worker がデプロイ済みかを確認し、
                          未デプロイならシークレット登録をスキップして正常終了する
                          （--worker-name とあわせて指定する。初回デプロイ前の provision 実行向け）
  --worker-name <name>    --require-deployed と併用する Worker 名
  --dry-run               登録判定までを行い、実際の \`wrangler secret put\` は実行しない
  --json                  結果を JSON で出力する
  --help                  このヘルプを表示する

必要な環境変数（--require-deployed 指定時）: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`

export function generateSecretValue() {
  return randomBytes(32).toString('base64')
}

/**
 * シークレットの登録要否を判定し、必要なら登録する純粋なオーケストレーション。
 * @param {object} deps
 * @param {string} deps.name
 * @param {() => Promise<unknown>} deps.listSecrets `wrangler secret list --format json` 相当
 * @param {(value: string) => Promise<void>} deps.putSecret
 * @param {() => string} [deps.generateValue]
 * @param {string} [deps.value] 指定があればランダム生成の代わりにこの値を登録する
 * @param {boolean} [deps.dryRun]
 * @param {boolean} [deps.force] true なら登録済みでも value で上書きする（RATE_LIMIT_PEPPER の
 *   ような、一度登録したら変えてはいけない値には使わないこと）
 * @returns {Promise<{ name: string, action: 'unchanged' | 'created' | 'updated' | 'would-create' | 'would-update' }>}
 */
export async function ensureSecret({
  name,
  listSecrets,
  putSecret,
  generateValue = generateSecretValue,
  value,
  dryRun = false,
  force = false,
}) {
  const list = await listSecrets()
  if (!Array.isArray(list)) {
    throw new Error(
      `シークレット一覧を判定できません（配列ではありません）: ${JSON.stringify(list)}。` +
        '既存の値を壊さないよう登録は行わず中止します。',
    )
  }
  const exists = list.some((s) => s && s.name === name)
  if (exists && !force) {
    return { name, action: 'unchanged' }
  }
  if (dryRun) {
    return { name, action: exists ? 'would-update' : 'would-create' }
  }
  await putSecret(value ?? generateValue())
  return { name, action: exists ? 'updated' : 'created' }
}

/**
 * Worker がデプロイ済みかどうかを Cloudflare REST API（Workers スクリプト一覧）で判定する。
 * `wrangler secret list` の失敗理由をエラー文言の一致で判定しないための代替経路
 * （文言は wrangler のバージョンで変わりうり、要検証のまま運用に使うのは避けたい）。
 * @param {{ api: ReturnType<typeof createCfApi>, scriptName: string }} deps
 */
export async function isWorkerDeployed({ api, scriptName }) {
  const list = await api.get(`/accounts/${api.accountId}/workers/scripts`)
  return (list.result ?? []).some((s) => s.id === scriptName)
}

function wranglerListSecrets() {
  const out = execFileSync('npx', ['wrangler', 'secret', 'list', '--format', 'json'], {
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

function wranglerPutSecret(name, value) {
  execFileSync('npx', ['wrangler', 'secret', 'put', name], { input: value, encoding: 'utf8' })
}

function formatText(result) {
  if (result.action === 'skipped') return `スキップしました: ${result.reason}`
  return {
    unchanged: `${result.name} は既に登録済みです。`,
    created: `${result.name} を新規生成して登録しました。`,
    updated: `${result.name} を指定した値で更新しました。`,
    'would-create': `[dry-run] ${result.name} は未登録です。実行すれば新規生成して登録します。`,
    'would-update': `[dry-run] ${result.name} は登録済みですが --force のため実行すれば上書きします。`,
  }[result.action]
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      name: { type: 'string' },
      value: { type: 'string' },
      force: { type: 'boolean', default: false },
      'require-deployed': { type: 'boolean', default: false },
      'worker-name': { type: 'string' },
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
  if (!values.name) {
    console.error('--name は必須です。\n')
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (values['require-deployed'] && !values['worker-name']) {
    console.error('--require-deployed には --worker-name の指定も必要です。\n')
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  try {
    if (values['require-deployed']) {
      const { token, accountId } = readCfEnv()
      const api = createCfApi({ token, accountId })
      const deployed = await isWorkerDeployed({ api, scriptName: values['worker-name'] })
      if (!deployed) {
        const result = {
          name: values.name,
          action: 'skipped',
          reason: `Worker '${values['worker-name']}' がまだデプロイされていません。初回デプロイ時に deploy workflow が登録します。`,
        }
        console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result))
        return
      }
    }

    const result = await ensureSecret({
      name: values.name,
      value: values.value,
      dryRun: values['dry-run'],
      force: values.force,
      listSecrets: async () => wranglerListSecrets(),
      putSecret: async (value) => wranglerPutSecret(values.name, value),
    })
    console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result))
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
