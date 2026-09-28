#!/usr/bin/env node
// Worker のシークレットが登録済みかどうかを判定し、無ければ生成して登録する。
// RATE_LIMIT_PEPPER・REPORT_WEBHOOK_URL の登録に使い、
// docs/runbooks/{provisioning,deploy}.md から呼ばれる。
// --secrets-file を付けると `wrangler secret put` の代わりに JSON ファイルへ書き出し、
// `wrangler deploy --secrets-file` で新しいバージョンと同時に登録させる。
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { CfApiError, createCfApi, readCfEnv } from './lib/cfApi.mjs'

// Workers API が「スクリプトが無い」ときに返すエラーコード。wrangler の secret list も同じ値で判定する
const WORKER_NOT_FOUND_CODE = 10007

const USAGE = `使い方: node scripts/cf/ensure-secret.mjs --name <SECRET_NAME> [--value <値>]
       [--require-deployed --worker-name <name>] [--secrets-file <path> --worker-name <name>]
       [--dry-run] [--json] [--help]

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
  --secrets-file <path>   \`wrangler secret put\` の代わりに、値を <path> の JSON に書き足す
                          （\`wrangler deploy --secrets-file <path>\` に渡し、デプロイと同時に登録する。
                          deploy workflow 向け）。一覧を取れないときは Cloudflare API で Worker の
                          有無を確かめ、まだ無いと確認できたときだけ未登録として扱う
                          （--worker-name とあわせて指定する）
  --worker-name <name>    --require-deployed・--secrets-file と併用する Worker 名
  --dry-run               登録判定までを行い、実際の登録（\`wrangler secret put\`、--secrets-file への
                          書き出し）は行わない
  --json                  結果を JSON で出力する
  --help                  このヘルプを表示する

必要な環境変数（--require-deployed・--secrets-file 指定時）: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`

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

/**
 * Worker がまだ作られていないことを Cloudflare API で確かめる。`wrangler secret list` と同じ
 * エンドポイントが「スクリプトが無い」で失敗したときだけ true を返し、それ以外の失敗は投げる。
 * @param {{ api: ReturnType<typeof createCfApi>, scriptName: string }} deps
 */
export async function isWorkerAbsent({ api, scriptName }) {
  try {
    await api.get(`/accounts/${api.accountId}/workers/scripts/${scriptName}/secrets`)
    return false
  } catch (e) {
    if (e instanceof CfApiError && e.errors.some((err) => err.code === WORKER_NOT_FOUND_CODE)) {
      return true
    }
    throw e
  }
}

/**
 * 登録済みシークレットの一覧を返す。一覧を取れず、Worker がまだ無いと確認できたときだけ空配列を返す。
 * 取れない理由が Worker の不在だと確認できなければ一覧の失敗をそのまま投げる（未登録と誤って
 * 判定すると、新しい値が `wrangler deploy --secrets-file` で既存の値を上書きするため）。
 * @param {{ listSecrets: () => Promise<unknown>, isWorkerAbsent: () => Promise<boolean> }} deps
 */
export async function listSecretsOrEmptyIfWorkerAbsent({ listSecrets, isWorkerAbsent }) {
  try {
    return await listSecrets()
  } catch (listError) {
    if (await isWorkerAbsent()) return []
    throw listError
  }
}

/**
 * `wrangler deploy --secrets-file` に渡す JSON に 1 件書き足す。値を含むので所有者だけが読める
 * パーミッションで作る。
 * @param {string} path
 * @param {string} name
 * @param {string} value
 */
export function addSecretToFile(path, name, value) {
  const secrets = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  secrets[name] = value
  writeFileSync(path, JSON.stringify(secrets), { mode: 0o600 })
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

function formatText(result, secretsFile) {
  if (result.action === 'skipped') return `スキップしました: ${result.reason}`
  if (secretsFile && (result.action === 'created' || result.action === 'updated')) {
    return `${result.name} を ${secretsFile} に書き出しました（wrangler deploy --secrets-file で登録されます）。`
  }
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
      'secrets-file': { type: 'string' },
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
  const secretsFile = values['secrets-file']
  if (secretsFile && !values['worker-name']) {
    console.error('--secrets-file には --worker-name の指定も必要です。\n')
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  try {
    const cfApi = () => {
      const { token, accountId } = readCfEnv()
      return createCfApi({ token, accountId })
    }
    if (values['require-deployed']) {
      const api = cfApi()
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

    // Worker が無いと wrangler secret list がエラーを出すので、ログを読む人向けにその理由を添える
    const checkWorkerAbsent = async () => {
      const absent = await isWorkerAbsent({ api: cfApi(), scriptName: values['worker-name'] })
      if (absent) {
        console.error(
          `Worker '${values['worker-name']}' はまだ無いため、登録済みのシークレットは無いものとして扱います。`,
        )
      }
      return absent
    }
    const result = await ensureSecret({
      name: values.name,
      value: values.value,
      dryRun: values['dry-run'],
      force: values.force,
      listSecrets: secretsFile
        ? () =>
            listSecretsOrEmptyIfWorkerAbsent({
              listSecrets: async () => wranglerListSecrets(),
              isWorkerAbsent: checkWorkerAbsent,
            })
        : async () => wranglerListSecrets(),
      putSecret: secretsFile
        ? async (value) => addSecretToFile(secretsFile, values.name, value)
        : async (value) => wranglerPutSecret(values.name, value),
    })
    console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result, secretsFile))
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
