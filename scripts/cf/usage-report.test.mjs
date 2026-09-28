import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeUsage,
  currentMonthWindowJst,
  formatMarkdown,
  runReport,
  getPlanLimits,
  PLAN_LIMITS,
  DEFAULT_PLAN,
  DEFAULT_THRESHOLD_RATIO,
} from './usage-report.mjs'

// bodies は呼び出し順に対応するレスポンスボディの配列。runReport は
// メインのクエリ・CPU時間のクエリの順に2回 fetch するため、テストでは
// 呼び出し順に応じて別のレスポンスを返せるようにしてある。
function fakeFetch(...bodies) {
  const calls = []
  const fetchImpl = async (url, init) => {
    if (calls.length >= bodies.length) {
      throw new Error(`想定より多く fetch が呼ばれた（${calls.length + 1} 回目）`)
    }
    const body = bodies[calls.length]
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => body }
  }
  return { fetchImpl, calls }
}

test('getPlanLimits は free/paid の込み枠を返し、不明なプランは例外にする', () => {
  assert.equal(getPlanLimits('free').workersRequests.limit, 100_000)
  assert.equal(getPlanLimits('paid').workersRequests.limit, 10_000_000)
  assert.throws(() => getPlanLimits('enterprise'), /不明なプラン/)
  assert.equal(DEFAULT_PLAN, 'free')
})

test('summarizeUsage は既定で Free プランの込み枠を使う', () => {
  const result = summarizeUsage({ workersRequests: 90_000 })
  const target = result.find((m) => m.key === 'workersRequests')
  assert.equal(target.limit, 100_000)
  assert.equal(target.label, PLAN_LIMITS.free.workersRequests.label)
  assert.equal(result.length, Object.keys(PLAN_LIMITS.free).length)
})

test('summarizeUsage は Paid プランを指定すると月間の込み枠で判定する', () => {
  const usage = {
    workersRequests: 8_000_000, // 10,000,000 の 80%
    workersCpuMs: 15_000_000, // 30,000,000 の 50%
    d1RowsWritten: 49_000_000, // 50,000,000 の 98% -> 超過
    d1RowsRead: 1_000_000_000,
    r2ClassA: 100,
    r2ClassB: 100,
  }
  const result = summarizeUsage(usage, 0.8, 'paid')
  const byKey = Object.fromEntries(result.map((m) => [m.key, m]))

  assert.equal(byKey.workersRequests.ratio, 0.8)
  assert.equal(byKey.workersRequests.exceeded, true) // ちょうどしきい値は超過扱い
  assert.equal(byKey.workersCpuMs.ratio, 0.5)
  assert.equal(byKey.workersCpuMs.exceeded, false)
  assert.equal(byKey.d1RowsWritten.exceeded, true)
  assert.equal(result.length, Object.keys(PLAN_LIMITS.paid).length)
})

test('summarizeUsage は既定のしきい値 80% を使う', () => {
  const usage = { workersRequests: 79_999 }
  const result = summarizeUsage(usage)
  const target = result.find((m) => m.key === 'workersRequests')
  assert.equal(target.exceeded, false)
  assert.equal(DEFAULT_THRESHOLD_RATIO, 0.8)
})

test('summarizeUsage は Free プランで日次上限・CPU p99 の割合を計算する', () => {
  const usage = {
    workersRequests: 95_000, // 100,000 の 95% -> 超過
    workersCpuP99Ms: 8, // 10ms の 80% -> ちょうどしきい値
    d1RowsWritten: 50_000, // 100,000 の 50%
    d1RowsRead: 4_000_000, // 5,000,000 の 80% -> ちょうどしきい値
    r2ClassA: 10,
    r2ClassB: 10,
  }
  const result = summarizeUsage(usage, 0.8, 'free')
  const byKey = Object.fromEntries(result.map((m) => [m.key, m]))

  assert.equal(byKey.workersRequests.exceeded, true)
  assert.equal(byKey.workersCpuP99Ms.ratio, 0.8)
  assert.equal(byKey.workersCpuP99Ms.exceeded, true)
  assert.equal(byKey.d1RowsWritten.exceeded, false)
  assert.equal(byKey.d1RowsRead.exceeded, true)
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

test('summarizeUsage は日次最大値を記録した日があれば usedOnDate に載せる', () => {
  const result = summarizeUsage(
    { workersRequests: 95_000, workersRequestsDate: '2026-09-15' },
    0.8,
    'free',
  )
  const target = result.find((m) => m.key === 'workersRequests')
  assert.equal(target.usedOnDate, '2026-09-15')

  const withoutDate = summarizeUsage({ workersRequests: 95_000 }, 0.8, 'free')
  assert.equal(withoutDate.find((m) => m.key === 'workersRequests').usedOnDate, null)
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

test('formatMarkdown は Free プランで超過時に停止の説明と切り替え手段を書く', () => {
  const report = {
    plan: 'free',
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-17T00:00:00.000Z',
    thresholdRatio: 0.8,
    metrics: summarizeUsage(
      { workersRequests: 95_000, workersRequestsDate: '2026-09-15' },
      0.8,
      'free',
    ),
    exceeded: ['Workers リクエスト数（日次最大）'],
    unverified: ['テスト用の未検証事項'],
  }
  const md = formatMarkdown(report)
  assert.match(md, /Workers リクエスト数（日次最大）/)
  assert.match(md, /2026-09-15/)
  assert.match(md, /超過/)
  assert.match(md, /1027/)
  assert.match(md, /Paid/)
  assert.match(md, /未検証事項/)
})

test('formatMarkdown は Paid プランで超過時に課金される旨を書く', () => {
  const report = {
    plan: 'paid',
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-17T00:00:00.000Z',
    thresholdRatio: 0.8,
    metrics: summarizeUsage({ workersCpuMs: 29_000_000 }, 0.8, 'paid'),
    exceeded: ['Workers CPU 時間（月間合計, ms）'],
    unverified: [],
  }
  const md = formatMarkdown(report)
  assert.match(md, /課金/)
  assert.doesNotMatch(md, /エラー 1027/)
})

test('formatMarkdown は超過が無ければ対応セクションを書かない', () => {
  const report = {
    plan: 'free',
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-17T00:00:00.000Z',
    thresholdRatio: 0.8,
    metrics: summarizeUsage({ workersRequests: 1_000 }, 0.8, 'free'),
    exceeded: [],
    unverified: [],
  }
  const md = formatMarkdown(report)
  assert.match(md, /しきい値を超えた項目はありません/)
  assert.doesNotMatch(md, /エラー 1027/)
})

test('formatMarkdown は CPU p99（ms）のような小数を丸め潰さずに表示する', () => {
  const report = {
    plan: 'free',
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-17T00:00:00.000Z',
    thresholdRatio: 0.8,
    metrics: summarizeUsage({ workersCpuP99Ms: 9.2 }, 0.8, 'free'),
    exceeded: [],
    unverified: [],
  }
  const md = formatMarkdown(report)
  assert.match(md, /9\.2/)
})

test('formatMarkdown は runReport の出力を JSON 往復させても Free の文言を保つ', () => {
  // usage-report.yml は --json でファイルに書き出してから --markdown-from-json で読み直す。
  // report をそのまま渡すのではなく JSON を経由させて、その経路でも文言が壊れないことを確かめる。
  const report = {
    plan: 'free',
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-17T00:00:00.000Z',
    thresholdRatio: 0.8,
    metrics: summarizeUsage(
      { workersRequests: 95_000, workersRequestsDate: '2026-09-15' },
      0.8,
      'free',
    ),
    exceeded: ['Workers リクエスト数（日次最大）'],
    unverified: [],
  }
  const roundTripped = JSON.parse(JSON.stringify(report))
  const md = formatMarkdown(roundTripped)
  assert.match(md, /Workers Free/)
  assert.match(md, /エラー 1027/)
  assert.match(md, /2026-09-15/)
})

test('runReport は Free プランで日ごとの最大値を上限と比較する（偽 fetch）', async () => {
  const mainBody = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [
              { dimensions: { date: '2026-09-01' }, sum: { requests: 40_000 } },
              { dimensions: { date: '2026-09-02' }, sum: { requests: 95_000 } },
            ],
            d1AnalyticsAdaptiveGroups: [
              { dimensions: { date: '2026-09-01' }, sum: { rowsWritten: 1_000, rowsRead: 10_000 } },
              {
                dimensions: { date: '2026-09-02' },
                sum: { rowsWritten: 2_000, rowsRead: 4_800_000 },
              },
            ],
            r2OperationsAdaptiveGroups: [
              { dimensions: { actionType: 'PutObject' }, sum: { requests: 10 } },
              { dimensions: { actionType: 'GetObject' }, sum: { requests: 20 } },
            ],
          },
        ],
      },
    },
  }
  const cpuBody = {
    data: {
      viewer: {
        accounts: [{ workersInvocationsAdaptive: [{ quantiles: { cpuTimeP99: 9_000 } }] }],
      },
    },
  }
  const { fetchImpl, calls } = fakeFetch(mainBody, cpuBody)
  const report = await runReport({
    plan: 'free',
    env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' },
    fetchImpl,
    now: new Date('2026-09-02T01:00:00.000Z'),
  })

  assert.equal(calls.length, 2)
  const mainSentBody = JSON.parse(calls[0].init.body)
  assert.match(mainSentBody.query, /dimensions \{ date \}/)
  const cpuSentBody = JSON.parse(calls[1].init.body)
  assert.match(cpuSentBody.query, /cpuTimeP99/)
  assert.doesNotMatch(cpuSentBody.query, /cpuTimeUs/)

  assert.equal(report.plan, 'free')
  const byKey = Object.fromEntries(report.metrics.map((m) => [m.key, m]))
  assert.equal(byKey.workersRequests.used, 95_000) // 40,000 と 95,000 のうち大きい方
  assert.equal(byKey.workersRequests.usedOnDate, '2026-09-02')
  assert.equal(byKey.workersRequests.exceeded, true) // 95,000 / 100,000 = 95%
  assert.equal(byKey.d1RowsWritten.used, 2_000)
  assert.equal(byKey.d1RowsRead.used, 4_800_000)
  assert.equal(byKey.d1RowsRead.exceeded, true) // 4,800,000 / 5,000,000 = 96%
  assert.equal(byKey.workersCpuP99Ms.used, 9) // マイクロ秒 -> ミリ秒
  assert.equal(byKey.workersCpuP99Ms.exceeded, true) // 9 / 10 = 90%
  assert.equal(byKey.r2ClassA.used, 10)
  assert.equal(byKey.r2ClassB.used, 20)
})

test('runReport は Paid プランで日ごとの値を合計して月間の込み枠と比較する（偽 fetch）', async () => {
  const mainBody = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [
              { dimensions: { date: '2026-09-01' }, sum: { requests: 400_000 } },
              { dimensions: { date: '2026-09-02' }, sum: { requests: 600_000 } },
            ],
            d1AnalyticsAdaptiveGroups: [
              {
                dimensions: { date: '2026-09-01' },
                sum: { rowsWritten: 200_000, rowsRead: 400_000 },
              },
              {
                dimensions: { date: '2026-09-02' },
                sum: { rowsWritten: 300_000, rowsRead: 600_000 },
              },
            ],
            r2OperationsAdaptiveGroups: [
              { dimensions: { actionType: 'PutObject' }, sum: { requests: 10 } },
              { dimensions: { actionType: 'GetObject' }, sum: { requests: 20 } },
            ],
          },
        ],
      },
    },
  }
  const cpuBody = {
    data: {
      viewer: {
        accounts: [{ workersInvocationsAdaptive: [{ sum: { cpuTimeUs: 2_000_000_000 } }] }],
      },
    },
  }
  const { fetchImpl, calls } = fakeFetch(mainBody, cpuBody)
  const report = await runReport({
    plan: 'paid',
    env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' },
    fetchImpl,
    now: new Date('2026-09-02T01:00:00.000Z'),
  })

  assert.equal(calls.length, 2)
  const cpuSentBody = JSON.parse(calls[1].init.body)
  assert.match(cpuSentBody.query, /cpuTimeUs/)

  const byKey = Object.fromEntries(report.metrics.map((m) => [m.key, m]))
  assert.equal(byKey.workersRequests.used, 1_000_000) // 400,000 + 600,000 の合計
  assert.equal(byKey.workersRequests.usedOnDate, null) // Paid は日付を出さない
  assert.equal(byKey.d1RowsWritten.used, 500_000)
  assert.equal(byKey.d1RowsRead.used, 1_000_000)
  assert.equal(byKey.workersCpuMs.used, 2_000_000) // マイクロ秒 -> ミリ秒
})

test('runReport は使用量ゼロの日を「取得できず」と誤認しない', async () => {
  const mainBody = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [],
            d1AnalyticsAdaptiveGroups: [],
            r2OperationsAdaptiveGroups: [],
          },
        ],
      },
    },
  }
  const cpuBody = {
    data: {
      viewer: { accounts: [{ workersInvocationsAdaptive: [{ quantiles: { cpuTimeP99: 0 } }] }] },
    },
  }
  const { fetchImpl } = fakeFetch(mainBody, cpuBody)
  const report = await runReport({
    plan: 'free',
    env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' },
    fetchImpl,
    now: new Date('2026-09-02T01:00:00.000Z'),
  })

  const byKey = Object.fromEntries(report.metrics.map((m) => [m.key, m]))
  assert.equal(byKey.workersRequests.used, 0)
  assert.equal(byKey.workersRequests.unavailable, false)
  assert.equal(byKey.workersRequests.exceeded, false)
  assert.equal(byKey.d1RowsWritten.used, 0)
  assert.equal(byKey.d1RowsWritten.unavailable, false)
})

test('runReport は CPU 時間だけ取得に失敗しても他の項目は取得できる', async () => {
  const mainBody = {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [
              { dimensions: { date: '2026-09-17' }, sum: { requests: 1_000_000 } },
            ],
            d1AnalyticsAdaptiveGroups: [
              {
                dimensions: { date: '2026-09-17' },
                sum: { rowsWritten: 500_000, rowsRead: 1_000_000 },
              },
            ],
            r2OperationsAdaptiveGroups: [],
          },
        ],
      },
    },
  }
  const cpuTimeErrorBody = {
    data: null,
    errors: [
      {
        message: 'Unknown field "cpuTimeP99" on type "AccountWorkersInvocationsAdaptiveQuantiles"',
      },
    ],
  }
  const { fetchImpl, calls } = fakeFetch(mainBody, cpuTimeErrorBody)
  const report = await runReport({
    plan: 'free',
    env: { CLOUDFLARE_API_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: 'acc' },
    fetchImpl,
    now: new Date('2026-09-17T01:00:00.000Z'),
  })

  assert.equal(calls.length, 2)
  const byKey = Object.fromEntries(report.metrics.map((m) => [m.key, m]))
  assert.equal(byKey.workersRequests.used, 1_000_000)
  assert.equal(byKey.workersCpuP99Ms.unavailable, true)
  assert.equal(byKey.workersCpuP99Ms.exceeded, false)
  assert.ok(report.unverified.some((u) => u.includes('cpuTimeP99')))
})

test('runReport は認証情報が無いと分かりやすいメッセージで失敗する', async () => {
  await assert.rejects(runReport({ env: {} }), /CLOUDFLARE_API_TOKEN/)
})

test('runReport は不明なプランを指定すると Cloudflare を呼ばずに失敗する', async () => {
  await assert.rejects(runReport({ plan: 'enterprise', env: {} }), /不明なプラン/)
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
