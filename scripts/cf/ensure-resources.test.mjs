import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCfApi } from './lib/cfApi.mjs'
import {
  ensureD1Database,
  ensureR2Bucket,
  updateWranglerDatabaseId,
  run,
} from './ensure-resources.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./ensure-resources.mjs', import.meta.url))
const EXISTING_UUID = '11111111-1111-1111-1111-111111111111'
const CREATED_UUID = '22222222-2222-2222-2222-222222222222'

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const { status = 200, body = { success: true, result: null } } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { fetchImpl, calls }
}

function apiFor(fetchImpl, extra = {}) {
  return createCfApi({ token: 't', accountId: 'acc', fetchImpl, log: () => {}, ...extra })
}

test('D1: 既存があれば作成せず流用する', async () => {
  const { fetchImpl, calls } = fakeFetch((url) => {
    if (url.includes('/d1/database'))
      return { body: { success: true, result: [{ name: 'calshare', uuid: EXISTING_UUID }] } }
    throw new Error(`unexpected ${url}`)
  })
  const result = await ensureD1Database({ api: apiFor(fetchImpl) })
  assert.deepEqual(result, { name: 'calshare', uuid: EXISTING_UUID, created: false })
  assert.ok(
    calls.every((c) => c.init.method === 'GET'),
    '作成 POST を呼んではいけない',
  )
})

test('D1: 無ければ作成する', async () => {
  const { fetchImpl } = fakeFetch((url, init) => {
    if (init.method === 'GET') return { body: { success: true, result: [] } }
    return { body: { success: true, result: { uuid: CREATED_UUID, name: 'calshare' } } }
  })
  const result = await ensureD1Database({ api: apiFor(fetchImpl) })
  assert.deepEqual(result, { name: 'calshare', uuid: CREATED_UUID, created: true })
})

test('D1: dry-run では作成 POST を送らず uuid は未確定', async () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    assert.equal(init.method, 'GET', 'dry-run では GET しか実際には送られない')
    return { body: { success: true, result: [] } }
  })
  const result = await ensureD1Database({ api: apiFor(fetchImpl, { dryRun: true }) })
  assert.equal(result.created, true)
  assert.equal(result.uuid, null)
  assert.equal(calls.length, 1)
})

test('R2: 既存があれば作成せず流用する（result.buckets の形）', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    body: { success: true, result: { buckets: [{ name: 'calshare' }] } },
  }))
  const result = await ensureR2Bucket({ api: apiFor(fetchImpl) })
  assert.deepEqual(result, { name: 'calshare', created: false })
})

test('R2: 無ければ作成する', async () => {
  const { fetchImpl } = fakeFetch((url, init) => {
    if (init.method === 'GET') return { body: { success: true, result: { buckets: [] } } }
    return { body: { success: true, result: { name: 'calshare' } } }
  })
  const result = await ensureR2Bucket({ api: apiFor(fetchImpl) })
  assert.deepEqual(result, { name: 'calshare', created: true, dryRun: false })
})

test('updateWranglerDatabaseId: プレースホルダを実 ID に書き換える', () => {
  const before =
    '{\n  "d1_databases": [{ "database_id": "00000000-0000-0000-0000-000000000000" }]\n}'
  const { content, changed, oldId } = updateWranglerDatabaseId(before, CREATED_UUID)
  assert.equal(changed, true)
  assert.equal(oldId, '00000000-0000-0000-0000-000000000000')
  assert.match(content, new RegExp(CREATED_UUID))
})

test('updateWranglerDatabaseId: 既に同じ ID なら変更なし', () => {
  const before = `{ "database_id": "${CREATED_UUID}" }`
  const { changed } = updateWranglerDatabaseId(before, CREATED_UUID)
  assert.equal(changed, false)
})

test('run: --write-wrangler で実ファイルを書き換える（テンポラリファイルを使う）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calshare-ensure-resources-'))
  const wranglerPath = join(dir, 'wrangler.jsonc')
  writeFileSync(
    wranglerPath,
    '{ "d1_databases": [{ "database_id": "00000000-0000-0000-0000-000000000000" }] }',
  )
  try {
    const { fetchImpl } = fakeFetch((url, init) => {
      if (init.method === 'GET' && url.includes('/d1/database'))
        return { body: { success: true, result: [] } }
      if (init.method === 'POST' && url.includes('/d1/database'))
        return { body: { success: true, result: { uuid: CREATED_UUID, name: 'calshare' } } }
      if (init.method === 'GET' && url.includes('/r2/buckets'))
        return { body: { success: true, result: { buckets: [{ name: 'calshare' }] } } }
      throw new Error(`unexpected ${url}`)
    })
    const result = await run({ api: apiFor(fetchImpl), writeWranglerPath: wranglerPath })
    assert.equal(result.wrangler.applied, true)
    assert.equal(result.wrangler.newId, CREATED_UUID)
    assert.match(readFileSync(wranglerPath, 'utf8'), new RegExp(CREATED_UUID))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('run: --write-wrangler のファイルが無ければ何もせず理由を返す', async () => {
  const { fetchImpl } = fakeFetch((url, init) => {
    if (init.method === 'GET' && url.includes('/d1/database'))
      return { body: { success: true, result: [{ name: 'calshare', uuid: EXISTING_UUID }] } }
    if (init.method === 'GET' && url.includes('/r2/buckets'))
      return { body: { success: true, result: { buckets: [{ name: 'calshare' }] } } }
    throw new Error(`unexpected ${url}`)
  })
  const result = await run({
    api: apiFor(fetchImpl),
    writeWranglerPath: '/no/such/path/wrangler.jsonc',
  })
  assert.equal(result.wrangler.applied, false)
  assert.match(result.wrangler.reason, /存在しません/)
})

test('CLI: --help は環境変数無しでも使い方を表示して正常終了する', () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(out, /使い方/)
})

test('CLI: --dry-run のみでも環境変数が無ければ分かりやすいエラーで終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--dry-run'], {
        encoding: 'utf8',
        env: {},
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /CLOUDFLARE_API_TOKEN/)
      return true
    },
  )
})
