import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseArgs,
  isJpDomain,
  classifyHttpStatus,
  checkDomain,
  checkDomains,
  formatTable,
} from './check-domain.mjs'

test('parseArgs は --json とドメイン一覧を分ける', () => {
  assert.deepEqual(parseArgs(['calshare.com', 'calshare.app', '--json']), {
    domains: ['calshare.com', 'calshare.app'],
    json: true,
  })
  assert.deepEqual(parseArgs(['calshare.com']), { domains: ['calshare.com'], json: false })
})

test('isJpDomain は .jp と co.jp などのサブドメインを判定する', () => {
  assert.equal(isJpDomain('calshare.jp'), true)
  assert.equal(isJpDomain('calshare.co.jp'), true)
  assert.equal(isJpDomain('calshare.com'), false)
  assert.equal(isJpDomain('calshare.jpx'), false)
})

test('classifyHttpStatus は 200/404/それ以外を判定する', () => {
  assert.equal(classifyHttpStatus(200), '登録済み')
  assert.equal(classifyHttpStatus(404), '未登録')
  assert.equal(classifyHttpStatus(500), '不明')
})

test('checkDomain は .jp を RDAP に問い合わせず手動確認にする', async () => {
  let called = false
  const fetchImpl = async () => {
    called = true
    return { status: 200 }
  }
  const result = await checkDomain('calshare.jp', { fetchImpl })
  assert.equal(called, false)
  assert.equal(result.status, '手動確認')
  assert.match(result.note, /JPRS/)
})

test('checkDomain は 200 を登録済みとして返す', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://rdap.org/domain/calshare.com')
    return { status: 200 }
  }
  const result = await checkDomain('calshare.com', { fetchImpl })
  assert.equal(result.status, '登録済み')
  assert.equal(result.httpStatus, 200)
})

test('checkDomain は 404 を未登録として返す', async () => {
  const fetchImpl = async () => ({ status: 404 })
  const result = await checkDomain('calshare-unregistered-xyz.com', { fetchImpl })
  assert.equal(result.status, '未登録')
})

test('checkDomain は 429 を Retry-After に従って待機しリトライする', async () => {
  const waits = []
  let attempt = 0
  const fetchImpl = async () => {
    attempt++
    if (attempt === 1)
      return { status: 429, headers: { get: (name) => (name === 'retry-after' ? '2' : null) } }
    return { status: 200 }
  }
  const wait = async (ms) => {
    waits.push(ms)
  }
  const result = await checkDomain('calshare.com', { fetchImpl, wait })
  assert.equal(result.status, '登録済み')
  assert.deepEqual(waits, [2000])
})

test('checkDomain は maxRetries を超えた 429 を不明として返す', async () => {
  const fetchImpl = async () => ({ status: 429, headers: { get: () => null } })
  const result = await checkDomain('calshare.com', {
    fetchImpl,
    wait: async () => {},
    maxRetries: 1,
  })
  assert.equal(result.status, '不明')
  assert.equal(result.httpStatus, 429)
})

test('checkDomain はネットワークエラーを不明として返す', async () => {
  const fetchImpl = async () => {
    throw new Error('network down')
  }
  const result = await checkDomain('calshare.com', { fetchImpl })
  assert.equal(result.status, '不明')
  assert.match(result.note, /network down/)
})

test('checkDomains は .jp 以外の間だけ待機を挟む', async () => {
  const waits = []
  const fetchImpl = async () => ({ status: 200 })
  const wait = async (ms) => {
    waits.push(ms)
  }
  const results = await checkDomains(['calshare.com', 'calshare.jp', 'calshare.app'], {
    fetchImpl,
    wait,
    betweenDelayMs: 500,
  })
  assert.equal(results.length, 3)
  // jp は照会しないので待機を挟むのは com→jp の遷移前の1回のみ（jp→app 前は待機しない）
  assert.deepEqual(waits, [500])
})

test('formatTable は列を揃えた表を返す', () => {
  const table = formatTable([
    { domain: 'calshare.com', status: '未登録', httpStatus: 404, note: '' },
  ])
  const lines = table.split('\n')
  assert.equal(lines.length, 2)
  assert.match(lines[0], /ドメイン/)
  assert.match(lines[1], /calshare\.com/)
})
