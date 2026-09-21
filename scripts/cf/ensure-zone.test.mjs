import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createCfApi } from './lib/cfApi.mjs'
import { ensureZone } from './ensure-zone.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./ensure-zone.mjs', import.meta.url))

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

test('既存のゾーンがあれば作成せず状態とネームサーバーを返す', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    body: {
      success: true,
      result: [
        {
          id: 'z1',
          name: 'example.com',
          status: 'active',
          name_servers: ['ns1.example', 'ns2.example'],
        },
      ],
    },
  }))
  const result = await ensureZone({ api: apiFor(fetchImpl), domain: 'example.com' })
  assert.deepEqual(result, {
    domain: 'example.com',
    existed: true,
    id: 'z1',
    status: 'active',
    nameServers: ['ns1.example', 'ns2.example'],
  })
  assert.ok(calls.every((c) => c.init.method === 'GET'))
})

test('無ければ作成し、割り当てられたネームサーバーを返す', async () => {
  const { fetchImpl } = fakeFetch((url, init) => {
    if (init.method === 'GET') return { body: { success: true, result: [] } }
    return {
      body: {
        success: true,
        result: {
          id: 'z2',
          name: 'example.com',
          status: 'pending',
          name_servers: ['ns3.example', 'ns4.example'],
        },
      },
    }
  })
  const result = await ensureZone({ api: apiFor(fetchImpl), domain: 'example.com' })
  assert.deepEqual(result, {
    domain: 'example.com',
    existed: false,
    id: 'z2',
    status: 'pending',
    nameServers: ['ns3.example', 'ns4.example'],
  })
})

test('dry-run では作成 POST を送らない', async () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    assert.equal(init.method, 'GET')
    return { body: { success: true, result: [] } }
  })
  const result = await ensureZone({
    api: apiFor(fetchImpl, { dryRun: true }),
    domain: 'example.com',
  })
  assert.equal(result.dryRun, true)
  assert.equal(calls.length, 1)
})

test('CLI: --domain 無しは分かりやすいエラーで終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /--domain は必須/)
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
