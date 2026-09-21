import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createCfApi } from './lib/cfApi.mjs'
import { checkToken } from './check-token.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./check-token.mjs', import.meta.url))

function fakeFetch(handler) {
  return async (url, init) => {
    const { status = 200, body = { success: true, result: null } } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
}

test('全チェックが成功すれば allOk: true', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/user/tokens/verify'))
      return { body: { success: true, result: { status: 'active' } } }
    return { body: { success: true, result: [] } }
  })
  const api = createCfApi({ token: 't', accountId: 'a', fetchImpl })
  const result = await checkToken({ api, accountId: 'a' })
  assert.equal(result.allOk, true)
  assert.ok(result.checks.every((c) => c.ok))
})

test('R2 の権限が無いと、その項目だけ NG になり不足している権限名を含む', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/user/tokens/verify'))
      return { body: { success: true, result: { status: 'active' } } }
    if (url.includes('/r2/buckets'))
      return {
        status: 403,
        body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
      }
    return { body: { success: true, result: [] } }
  })
  const api = createCfApi({ token: 't', accountId: 'a', fetchImpl })
  const result = await checkToken({ api, accountId: 'a' })
  assert.equal(result.allOk, false)
  const r2Check = result.checks.find((c) => c.name === 'R2 バケット一覧')
  assert.equal(r2Check.ok, false)
  assert.match(r2Check.permission, /Workers R2 Storage:Edit/)
  assert.match(r2Check.error, /Authentication error/)
})

test('GraphQL Analytics が権限不足で errors を返すと、その項目だけ NG になる', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/user/tokens/verify'))
      return { body: { success: true, result: { status: 'active' } } }
    if (url.includes('/graphql'))
      return { body: { data: null, errors: [{ message: 'authentication error' }] } }
    return { body: { success: true, result: [] } }
  })
  const api = createCfApi({ token: 't', accountId: 'a', fetchImpl })
  const result = await checkToken({ api, accountId: 'a' })
  assert.equal(result.allOk, false)
  const analyticsCheck = result.checks.find((c) => c.name === 'Analytics (GraphQL) 疎通確認')
  assert.equal(analyticsCheck.ok, false)
  assert.match(analyticsCheck.permission, /Account Analytics:Read/)
  assert.match(analyticsCheck.error, /authentication error/)
})

test('トークンが expired だと有効性チェックが NG になる', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes('/user/tokens/verify'))
      return { body: { success: true, result: { status: 'expired' } } }
    return { body: { success: true, result: [] } }
  })
  const api = createCfApi({ token: 't', accountId: 'a', fetchImpl })
  const result = await checkToken({ api, accountId: 'a' })
  const tokenCheck = result.checks.find((c) => c.name === 'トークンの有効性')
  assert.equal(tokenCheck.ok, false)
  assert.match(tokenCheck.error, /expired/)
})

test('CLI: --help は環境変数無しでも使い方を表示して正常終了する', () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(out, /使い方/)
})

test('CLI: 環境変数が無ければ分かりやすいエラーで終了する', () => {
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
