import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCfApi } from './lib/cfApi.mjs'
import {
  addSecretToFile,
  ensureSecret,
  isWorkerAbsent,
  isWorkerDeployed,
  generateSecretValue,
  listSecretsOrEmptyIfWorkerAbsent,
} from './ensure-secret.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./ensure-secret.mjs', import.meta.url))

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const { status = 200, body = { success: true, result: null } } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { fetchImpl, calls }
}

test('登録済みなら何もしない', async () => {
  const putCalls = []
  const result = await ensureSecret({
    name: 'RATE_LIMIT_PEPPER',
    listSecrets: async () => [{ name: 'RATE_LIMIT_PEPPER' }, { name: 'OTHER' }],
    putSecret: async (v) => putCalls.push(v),
  })
  assert.deepEqual(result, { name: 'RATE_LIMIT_PEPPER', action: 'unchanged' })
  assert.equal(putCalls.length, 0)
})

test('未登録なら生成して登録する', async () => {
  const putCalls = []
  const result = await ensureSecret({
    name: 'RATE_LIMIT_PEPPER',
    listSecrets: async () => [],
    putSecret: async (v) => putCalls.push(v),
    generateValue: () => 'generated-value',
  })
  assert.deepEqual(result, { name: 'RATE_LIMIT_PEPPER', action: 'created' })
  assert.deepEqual(putCalls, ['generated-value'])
})

test('--value 相当の value 指定があればそれを登録する（生成しない）', async () => {
  const putCalls = []
  await ensureSecret({
    name: 'REPORT_WEBHOOK_URL',
    value: 'https://example.com/webhook',
    listSecrets: async () => [],
    putSecret: async (v) => putCalls.push(v),
    generateValue: () => {
      throw new Error('呼ばれてはいけない')
    },
  })
  assert.deepEqual(putCalls, ['https://example.com/webhook'])
})

test('force を指定すると登録済みでも value で上書きする', async () => {
  const putCalls = []
  const result = await ensureSecret({
    name: 'REPORT_WEBHOOK_URL',
    value: 'https://example.com/new-webhook',
    force: true,
    listSecrets: async () => [{ name: 'REPORT_WEBHOOK_URL' }],
    putSecret: async (v) => putCalls.push(v),
  })
  assert.deepEqual(result, { name: 'REPORT_WEBHOOK_URL', action: 'updated' })
  assert.deepEqual(putCalls, ['https://example.com/new-webhook'])
})

test('force が無ければ登録済みのときは上書きしない（RATE_LIMIT_PEPPER の既定動作）', async () => {
  const putCalls = []
  const result = await ensureSecret({
    name: 'RATE_LIMIT_PEPPER',
    value: 'should-not-be-used',
    listSecrets: async () => [{ name: 'RATE_LIMIT_PEPPER' }],
    putSecret: async (v) => putCalls.push(v),
  })
  assert.equal(result.action, 'unchanged')
  assert.equal(putCalls.length, 0)
})

test('dry-run は登録を行わず would-create を返す', async () => {
  const putCalls = []
  const result = await ensureSecret({
    name: 'RATE_LIMIT_PEPPER',
    dryRun: true,
    listSecrets: async () => [],
    putSecret: async (v) => putCalls.push(v),
  })
  assert.equal(result.action, 'would-create')
  assert.equal(putCalls.length, 0)
})

test('一覧が配列でなければ登録せず失敗する（既存の値を上書きしないため）', async () => {
  const putCalls = []
  await assert.rejects(
    ensureSecret({
      name: 'RATE_LIMIT_PEPPER',
      listSecrets: async () => ({ error: 'auth failed' }),
      putSecret: async (v) => putCalls.push(v),
    }),
    /判定できません/,
  )
  assert.equal(putCalls.length, 0)
})

test('generateSecretValue は毎回異なるランダムな値を返す', () => {
  const a = generateSecretValue()
  const b = generateSecretValue()
  assert.notEqual(a, b)
  assert.ok(a.length > 0)
})

test('isWorkerDeployed は Workers スクリプト一覧に id が含まれるかで判定する', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: { success: true, result: [{ id: 'calshare' }] } }))
  const api = createCfApi({ token: 't', accountId: 'acc', fetchImpl })
  assert.equal(await isWorkerDeployed({ api, scriptName: 'calshare' }), true)
  assert.equal(await isWorkerDeployed({ api, scriptName: 'other' }), false)
})

test('isWorkerDeployed はスクリプトが1つも無ければ false', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: { success: true, result: [] } }))
  const api = createCfApi({ token: 't', accountId: 'acc', fetchImpl })
  assert.equal(await isWorkerDeployed({ api, scriptName: 'calshare' }), false)
})

test('listSecretsOrEmptyIfWorkerAbsent は一覧が取れれば Worker の有無を確かめずにそれを返す', async () => {
  let absentCalls = 0
  const list = await listSecretsOrEmptyIfWorkerAbsent({
    listSecrets: async () => [{ name: 'RATE_LIMIT_PEPPER' }],
    isWorkerAbsent: async () => {
      absentCalls++
      return true
    },
  })
  assert.deepEqual(list, [{ name: 'RATE_LIMIT_PEPPER' }])
  assert.equal(absentCalls, 0)
})

test('listSecretsOrEmptyIfWorkerAbsent は一覧が取れず Worker が無いと確認できたときだけ空配列を返す', async () => {
  const list = await listSecretsOrEmptyIfWorkerAbsent({
    listSecrets: async () => {
      throw new Error('Worker "calshare" not found.')
    },
    isWorkerAbsent: async () => true,
  })
  assert.deepEqual(list, [])
})

test('listSecretsOrEmptyIfWorkerAbsent は一覧が取れず Worker があるなら一覧の失敗をそのまま投げる', async () => {
  await assert.rejects(
    listSecretsOrEmptyIfWorkerAbsent({
      listSecrets: async () => {
        throw new Error('Unexpected token in JSON')
      },
      isWorkerAbsent: async () => false,
    }),
    /Unexpected token in JSON/,
  )
})

test('isWorkerAbsent は secrets の取得が 10007（スクリプトが無い）で失敗したときだけ true', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    status: 404,
    body: {
      success: false,
      errors: [{ code: 10007, message: 'workers.api.error.script_not_found' }],
    },
  }))
  const api = createCfApi({ token: 't', accountId: 'acc', fetchImpl })
  assert.equal(await isWorkerAbsent({ api, scriptName: 'calshare' }), true)
  assert.match(calls[0].url, /\/accounts\/acc\/workers\/scripts\/calshare\/secrets$/)
})

test('isWorkerAbsent は secrets が取れれば false', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: { success: true, result: [] } }))
  const api = createCfApi({ token: 't', accountId: 'acc', fetchImpl })
  assert.equal(await isWorkerAbsent({ api, scriptName: 'calshare' }), false)
})

test('isWorkerAbsent は 10007 以外の失敗を投げる（Worker が無いとは言い切れないため）', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 403,
    body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
  }))
  const api = createCfApi({ token: 't', accountId: 'acc', fetchImpl })
  await assert.rejects(isWorkerAbsent({ api, scriptName: 'calshare' }), /Authentication error/)
})

test('addSecretToFile は所有者だけが読める JSON を作り、2 件目以降を書き足す', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ensure-secret-')), 'worker-secrets.json')
  addSecretToFile(path, 'RATE_LIMIT_PEPPER', 'pepper-value')
  addSecretToFile(path, 'REPORT_WEBHOOK_URL', 'https://example.com/webhook')
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    RATE_LIMIT_PEPPER: 'pepper-value',
    REPORT_WEBHOOK_URL: 'https://example.com/webhook',
  })
  assert.equal(statSync(path).mode & 0o777, 0o600)
})

test('Worker が無ければ生成した値をファイルに書き、結果には値を含めない', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ensure-secret-')), 'worker-secrets.json')
  const result = await ensureSecret({
    name: 'RATE_LIMIT_PEPPER',
    listSecrets: () =>
      listSecretsOrEmptyIfWorkerAbsent({
        listSecrets: async () => {
          throw new Error('Worker "calshare" not found.')
        },
        isWorkerAbsent: async () => true,
      }),
    putSecret: async (value) => addSecretToFile(path, 'RATE_LIMIT_PEPPER', value),
    generateValue: () => 'generated-pepper',
  })
  assert.deepEqual(result, { name: 'RATE_LIMIT_PEPPER', action: 'created' })
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    RATE_LIMIT_PEPPER: 'generated-pepper',
  })
})

test('一覧が取れず Worker があるなら、ファイルを作らずに失敗する', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ensure-secret-')), 'worker-secrets.json')
  await assert.rejects(
    ensureSecret({
      name: 'RATE_LIMIT_PEPPER',
      listSecrets: () =>
        listSecretsOrEmptyIfWorkerAbsent({
          listSecrets: async () => {
            throw new Error('wrangler secret list failed')
          },
          isWorkerAbsent: async () => false,
        }),
      putSecret: async (value) => addSecretToFile(path, 'RATE_LIMIT_PEPPER', value),
    }),
    /wrangler secret list failed/,
  )
  assert.throws(() => statSync(path), { code: 'ENOENT' })
})

test('CLI: --name 無しは分かりやすいエラーで終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /--name は必須/)
      return true
    },
  )
})

test('CLI: --require-deployed には --worker-name も必要', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--name', 'X', '--require-deployed'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /--worker-name/)
      return true
    },
  )
})

test('CLI: --secrets-file には --worker-name も必要', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [SCRIPT_PATH, '--name', 'X', '--secrets-file', join(tmpdir(), 'unused.json')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    (err) => {
      assert.match(err.stderr, /--secrets-file には --worker-name/)
      return true
    },
  )
})

test('CLI: --help は環境変数無しでも使い方を表示して正常終了する', () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(out, /使い方/)
})
