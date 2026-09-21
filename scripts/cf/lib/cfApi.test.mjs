import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCfApi, readCfEnv, CfApiError } from './cfApi.mjs'

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const { status = 200, body = { success: true, result: null } } = handler(url, init)
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  }
  return { fetchImpl, calls }
}

test('readCfEnv は不足している変数名を含むメッセージで失敗する', () => {
  assert.throws(() => readCfEnv({}), /CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID/)
  assert.deepEqual(readCfEnv({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' }), {
    token: 't',
    accountId: 'a',
  })
})

test('Bearer トークンと JSON ボディを付けて呼ぶ', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: { success: true, result: { id: 'x' } } }))
  const api = createCfApi({ token: 'tok', accountId: 'acc', fetchImpl })
  const res = await api.post('/accounts/acc/d1/database', { name: 'calshare' })
  assert.equal(res.result.id, 'x')
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc/d1/database')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok')
  assert.equal(calls[0].init.body, '{"name":"calshare"}')
})

test('API のエラーは CfApiError としてコードとメッセージを含む', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    status: 403,
    body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
  }))
  const api = createCfApi({ token: 'tok', accountId: 'acc', fetchImpl })
  await assert.rejects(
    api.get('/accounts/acc/d1/database'),
    (e) =>
      e instanceof CfApiError && /10000: Authentication error/.test(e.message) && e.status === 403,
  )
})

test('dryRun では書き込み系を実行せずログに出す', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({}))
  const lines = []
  const api = createCfApi({
    token: 'tok',
    accountId: 'acc',
    fetchImpl,
    dryRun: true,
    log: (l) => lines.push(l),
  })
  const res = await api.post('/x', { a: 1 })
  assert.equal(res.dryRun, true)
  assert.equal(calls.length, 0)
  assert.match(lines[0], /\[dry-run\] POST \/x \{"a":1\}/)
  await api.get('/y')
  assert.equal(calls.length, 1)
})

test('getAll は total_pages に従って全ページを集める', async () => {
  const { fetchImpl, calls } = fakeFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page'))
    return { body: { success: true, result: [page], result_info: { total_pages: 3 } } }
  })
  const api = createCfApi({ token: 'tok', accountId: 'acc', fetchImpl })
  assert.deepEqual(await api.getAll('/accounts/acc/r2/buckets'), [1, 2, 3])
  assert.equal(calls.length, 3)
  assert.match(calls[0].url, /\?page=1&per_page=50$/)
})
