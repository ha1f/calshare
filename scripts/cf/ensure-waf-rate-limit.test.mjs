import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createCfApi } from './lib/cfApi.mjs'
import { ensureWafRateLimit, RULE_DESCRIPTION } from './ensure-waf-rate-limit.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./ensure-waf-rate-limit.mjs', import.meta.url))
const ZONE = { id: 'z1', name: 'example.com' }

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

function zoneListHandler(url) {
  if (url.startsWith('https://api.cloudflare.com/client/v4/zones?')) {
    return { body: { success: true, result: [ZONE] } }
  }
  return null
}

test('ルールセット未設定（404）なら新規作成として PUT する', async () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const zoneRes = zoneListHandler(url)
    if (zoneRes) return zoneRes
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'GET') {
      return {
        status: 404,
        body: { success: false, errors: [{ code: 9209, message: 'not found' }] },
      }
    }
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'PUT') {
      return { body: { success: true, result: { rules: JSON.parse(init.body).rules } } }
    }
    throw new Error(`unexpected ${url}`)
  })
  const result = await ensureWafRateLimit({ api: apiFor(fetchImpl), domain: 'example.com' })
  assert.equal(result.action, 'created')
  const putCall = calls.find((c) => c.init.method === 'PUT')
  assert.ok(putCall, 'PUT が呼ばれるべき')
  const sentRules = JSON.parse(putCall.init.body).rules
  assert.equal(sentRules.length, 1)
  assert.equal(sentRules[0].description, RULE_DESCRIPTION)
})

test('同じ description のルールが既にあり内容も同じなら unchanged で PUT しない', async () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const zoneRes = zoneListHandler(url)
    if (zoneRes) return zoneRes
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'GET') {
      return {
        body: {
          success: true,
          result: {
            rules: [
              {
                id: 'r1',
                description: RULE_DESCRIPTION,
                expression: 'starts_with(http.request.uri.path, "/api/")',
                action: 'block',
                ratelimit: {
                  characteristics: ['ip.src'],
                  period: 10,
                  requests_per_period: 10,
                  mitigation_timeout: 10,
                },
              },
            ],
          },
        },
      }
    }
    throw new Error(`unexpected PUT ${url}`)
  })
  const result = await ensureWafRateLimit({ api: apiFor(fetchImpl), domain: 'example.com' })
  assert.equal(result.action, 'unchanged')
  assert.ok(!calls.some((c) => c.init.method === 'PUT'), 'unchanged なら PUT してはいけない')
})

test('同じ description でも内容が違えば updated として PUT し、他のルールは残す', async () => {
  const otherRule = {
    id: 'r0',
    description: '別のルール',
    expression: 'true',
    action: 'log',
    ratelimit: {},
  }
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const zoneRes = zoneListHandler(url)
    if (zoneRes) return zoneRes
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'GET') {
      return {
        body: {
          success: true,
          result: {
            rules: [
              otherRule,
              {
                id: 'r1',
                description: RULE_DESCRIPTION,
                expression: 'starts_with(http.request.uri.path, "/api/")',
                action: 'block',
                ratelimit: {
                  characteristics: ['ip.src'],
                  period: 10,
                  requests_per_period: 5,
                  mitigation_timeout: 10,
                },
              },
            ],
          },
        },
      }
    }
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'PUT') {
      return { body: { success: true, result: { rules: JSON.parse(init.body).rules } } }
    }
    throw new Error(`unexpected ${url}`)
  })
  const result = await ensureWafRateLimit({ api: apiFor(fetchImpl), domain: 'example.com' })
  assert.equal(result.action, 'updated')
  const putCall = calls.find((c) => c.init.method === 'PUT')
  const sentRules = JSON.parse(putCall.init.body).rules
  assert.equal(sentRules.length, 2)
  assert.deepEqual(sentRules[0], otherRule)
  assert.equal(sentRules[1].ratelimit.requests_per_period, 10)
})

test('API が ratelimit に既定値のフィールドを補って返しても unchanged と判定する', async () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const zoneRes = zoneListHandler(url)
    if (zoneRes) return zoneRes
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'GET') {
      return {
        body: {
          success: true,
          result: {
            rules: [
              {
                id: 'r1',
                description: RULE_DESCRIPTION,
                expression: 'starts_with(http.request.uri.path, "/api/")',
                action: 'block',
                // 実際の値は同じだが、API が補って返す読み取り専用フィールドが混ざっている想定。
                ratelimit: {
                  characteristics: ['ip.src'],
                  period: 10,
                  requests_per_period: 10,
                  mitigation_timeout: 10,
                  requests_to_origin: false,
                  counting_expression: '',
                },
                version: '3',
                last_updated: '2026-01-01T00:00:00Z',
              },
            ],
          },
        },
      }
    }
    throw new Error(`unexpected PUT ${url}`)
  })
  const result = await ensureWafRateLimit({ api: apiFor(fetchImpl), domain: 'example.com' })
  assert.equal(result.action, 'unchanged')
  assert.ok(
    !calls.some((c) => c.init.method === 'PUT'),
    '自分が設定していないフィールドの差だけで更新してはいけない',
  )
})

test('dry-run では PUT を実際には送らない', async () => {
  const { fetchImpl, calls } = fakeFetch((url, init) => {
    const zoneRes = zoneListHandler(url)
    if (zoneRes) return zoneRes
    if (url.includes('/rulesets/phases/http_ratelimit/entrypoint') && init.method === 'GET') {
      return { status: 404, body: { success: false, errors: [] } }
    }
    throw new Error(`unexpected write in dry-run: ${url}`)
  })
  const result = await ensureWafRateLimit({
    api: apiFor(fetchImpl, { dryRun: true }),
    domain: 'example.com',
  })
  assert.equal(result.action, 'created')
  assert.equal(result.dryRun, true)
  assert.ok(!calls.some((c) => c.init.method === 'PUT'))
})

test('ゾーンが存在しなければ分かりやすいエラーを投げる', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: { success: true, result: [] } }))
  await assert.rejects(
    ensureWafRateLimit({ api: apiFor(fetchImpl), domain: 'example.com' }),
    /ensure-zone\.mjs/,
  )
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
