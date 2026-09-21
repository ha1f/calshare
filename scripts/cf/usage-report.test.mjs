import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeUsage,
  currentMonthWindowJst,
  formatMarkdown,
  runReport,
  PLAN_LIMITS,
  DEFAULT_THRESHOLD_RATIO,
} from './usage-report.mjs'

// bodies は呼び出し順に対応するレスポンスボディの配列。runReport は
// メインのクエリ・CPU時間のクエリの順に2回 fetch するため、テストでは
// 呼び出し順に応じて別のレスポンスを返せるようにしてある。
function fakeFetch(...bodies) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = bodies[calls.length] ?? bodies[bodies.length - 1]
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => body }
  }
  return { fetchImpl, calls }
}

test('summarizeUsage は使用量と枠から割合としきい値判定を計算する', () => {
  const usage = {
    workersRequests: 8_000_000, // 10,000,000 の 80%
    workersCpuMs: 15_000_000, // 30,000,000 の 50%
    d1RowsWritten: 49_000_000, // 50,000,000 の 98% -> 超過
    d1RowsRead: 1_000_000_000,
    r2ClassA: 100,
    r2ClassB: 100,
  }
  const result = summarizeUsage(usage, 0.8)
  const byKey = Object.fromEntries(result.map((m) => [m.key, m]))

  assert.equal(byKey.workersRequests.ratio, 0.8)
  assert.equal(byKey.workersRequests.exceeded, true) // ちょうどしきい値は超過扱い
  assert.equal(byKey.workersCpuMs.ratio, 0.5)
  assert.equal(byKey.workersCpuMs.exceeded, false)
  assert.equal(byKey.d1RowsWritten.exceeded, true)
  assert.equal(result.length, Object.keys(PLAN_LIMITS).length)
})

test('summarizeUsage は既定のしきい値 80% を使う', () => {
  const usage = { workersRequests: 7_999_999 }
  const result = summarizeUsage(usage)
  const target = result.find((m) => m.key === 'workersRequests')
  assert.equal(target.exceeded, false)
  assert.equal(DEFAULT_THRESHOLD_RATIO, 0.8)
})

test('summarizeUsage は取得できなかった項目を unavailable として扱い超過と誤認しない', () => {
  const result = summarizeUsage({ workersRequests: null })
  const target = result.find((m) => m.key === 'workersRequests')
  assert.equal(target.unavailable, true)
  assert.equal(target.exceeded, false)
  assert.equal(target.ratio, null)
  assert.equal(target.used, null)

  const missing = summarizeUsage({})
  for (const m of missing) {
    assert.equal(m.unavailable, true)
    assert.equal(m.exceeded, false)
  }
})

test('currentMonthWindowJst は当月1日 JST 0時から現在時刻までを UTC ISO で返す', () => {
  // 2026-09-17T01:23:45Z は JST で 2026-09-17 10:23:45 なので、月初は 2026-09-01T00:00:00 JST
  const now = new Date('2026-09-17T01:23:45.000Z')
  const { startUtc, endUtc } = currentMonthWindowJst(now)
  assert.equal(startUtc, '2026-08-31T15:00:00.000Z') // = 2026-09-01T00:00:00+09:00
  assert.equal(endUtc, now.toISOString())
})

test('currentMonthWindowJst は JST で日付が繰り上がる境界を扱う（UTC 15:00 = JST 翌0時）', () => {
  const now = new Date('2026-01-31T16:00:00.000Z') // JST 2026-02-01 01:00
  const { startUtc } = currentMonthWindowJst(now)
  assert.equal(startUtc, '2026-01-31T15:00:00.000Z') // = 2026-02-01T00:00:00+09:00
})

test('formatMarkdown は表としきい値超過・未検証事項を含む', () => {
  const report = {
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-17T00:00:00.000Z',
    thresholdRatio: 0.8,
    metrics: summarizeUsage({ workersRequests: 9_000_000 }, 0.8),
    exceeded: ['Workers リクエスト数'],
    unverified: ['テスト用の未検証事項'],
  }
  const md = formatMarkdown(report)
  assert.match(md, /Workers リクエスト数/)
  assert.match(md, /超過/)
  assert.match(md, /未検証事項/)
})

test('runReport は GraphQL のレスポンスから使用量を抽出しレポートを組み立てる（偽 fetch）', async () => {
  const mainBody = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [{ sum: { requests: 1_000_000 } }],
            d1AnalyticsAdaptiveGroups: [{ sum: { rowsWritten: 500_000, rowsRead: 1_000_000 } }],
            r2OperationsAdaptiveGroups: [
              { dimensions: { actionType: 'PutObject' }, sum: { requests: 10 } },
              { dimensions: { actionType: 'GetObject' }, sum: { requests: 20 } },
            ],
          },
        ],
      },
    },
  }
  const cpuTimeBody = {
    data: {
      viewer: {
        accounts: [{ workersInvocationsAdaptive: [{ sum: { cpuTimeUs: 2_000_000_000 } }] }],
      },
    },
  }
  const { fetchImpl, calls } = fakeFetch(mainBody, cpuTimeBody)
  const report = await runReport({
    env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' },
    fetchImpl,
    now: new Date('2026-09-17T01:00:00.000Z'),
  })

  // CPU 時間は buildCpuTimeQuery のコメントのとおり別リクエストにしてあるため、
  // メインのクエリとあわせて 2 回 fetch する。
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/graphql')
  const sentBody = JSON.parse(calls[0].init.body)
  assert.match(sentBody.query, /workersInvocationsAdaptive/)
  assert.equal(sentBody.variables.accountTag, 'acc')
  // d1AnalyticsAdaptiveGroups は Cloudflare の公開ドキュメントの例で date_geq/date_leq（日付のみ）を
  // 使っており、workersInvocationsAdaptive/r2OperationsAdaptiveGroups の datetime_geq/datetime_leq と
  // 同じ引数名・変数を渡すと Unknown argument で失敗する。
  assert.match(
    sentBody.query,
    /d1AnalyticsAdaptiveGroups\(limit: 1, filter: \{ date_geq: \$startDate, date_leq: \$endDate \}\)/,
  )
  // startDate は windowStart（UTC ISO）の日付部分。JST 0時は UTC 前日 15時なので前日の日付になる
  // （UNVERIFIED_NOTES の「カレンダー月と課金期間の境界が一致しない可能性」の一因）。
  assert.equal(sentBody.variables.startDate, '2026-08-31')
  assert.equal(sentBody.variables.endDate, '2026-09-17')

  const cpuSentBody = JSON.parse(calls[1].init.body)
  assert.match(cpuSentBody.query, /cpuTimeUs/)

  const byKey = Object.fromEntries(report.metrics.map((m) => [m.key, m]))
  assert.equal(byKey.workersRequests.used, 1_000_000)
  assert.equal(byKey.workersCpuMs.used, 2_000_000) // マイクロ秒 -> ミリ秒
  assert.equal(byKey.d1RowsWritten.used, 500_000)
  assert.equal(byKey.r2ClassA.used, 10)
  assert.equal(byKey.r2ClassB.used, 20)
  assert.equal(report.unverified.length > 0, true)
})

test('runReport は CPU 時間だけ取得に失敗しても他の項目は取得できる', async () => {
  const mainBody = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [{ sum: { requests: 1_000_000 } }],
            d1AnalyticsAdaptiveGroups: [{ sum: { rowsWritten: 500_000, rowsRead: 1_000_000 } }],
            r2OperationsAdaptiveGroups: [],
          },
        ],
      },
    },
  }
  const cpuTimeErrorBody = {
    data: null,
    errors: [
      { message: 'Unknown field "cpuTimeUs" on type "AccountWorkersInvocationsAdaptiveSum"' },
    ],
  }
  const { fetchImpl, calls } = fakeFetch(mainBody, cpuTimeErrorBody)
  const report = await runReport({
    env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' },
    fetchImpl,
    now: new Date('2026-09-17T01:00:00.000Z'),
  })

  assert.equal(calls.length, 2)
  const byKey = Object.fromEntries(report.metrics.map((m) => [m.key, m]))
  assert.equal(byKey.workersRequests.used, 1_000_000)
  assert.equal(byKey.workersCpuMs.unavailable, true)
  assert.equal(byKey.workersCpuMs.exceeded, false)
  assert.ok(report.unverified.some((u) => u.includes('cpuTimeUs')))
})

test('runReport は認証情報が無いと分かりやすいメッセージで失敗する', async () => {
  await assert.rejects(runReport({ env: {} }), /CLOUDFLARE_API_TOKEN/)
})

test('runReport は GraphQL がエラーを返すと「超過なし」に丸めず失敗する', async () => {
  // Cloudflare の GraphQL API は HTTP 200 のまま { data: null, errors: [...] } を返すことがある。
  // ここで失敗させないと全項目が unavailable のまま「超過なし」の緑ジョブになり、
  // クエリ形状のズレに誰も気づけなくなる。
  const body = {
    data: null,
    errors: [{ message: 'Unknown argument "datetime_geq" on field "workersInvocationsAdaptive"' }],
  }
  const { fetchImpl } = fakeFetch(body)
  await assert.rejects(
    runReport({ env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' }, fetchImpl }),
    /Unknown argument "datetime_geq"/,
  )
})
