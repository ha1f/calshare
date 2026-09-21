// Cloudflare の当月使用量を GraphQL Analytics API で取得し、
// Workers Paid の込み枠に対する割合をしきい値と比較するレポートを出す。
// design.md §1.2（コストとの整合）・§14.1（CPU-ms が込み枠上限近傍）・H12 に対応する。
//
// 割合計算としきい値判定（summarizeUsage）は GraphQL のレスポンス形に依存しない純粋関数にし、
// 実測値の取得（fetchUsage）と分離してある。GraphQL のデータセット名・フィールド名は
// Cloudflare の公開ドキュメントに基づく最善の推測であり、実アカウントでの疎通確認はできていない
// （UNVERIFIED_NOTES に列挙し、レポートにも含める）。

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'

// Workers Paid の込み枠（design.md §1.2、2026年時点の Cloudflare 公開情報に基づく）。
// 値が変わったらここだけ直す。
export const PLAN_LIMITS = {
  workersRequests: { label: 'Workers リクエスト数', limit: 10_000_000 },
  workersCpuMs: { label: 'Workers CPU 時間 (ms)', limit: 30_000_000 },
  d1RowsWritten: { label: 'D1 書き込み行数', limit: 50_000_000 },
  d1RowsRead: { label: 'D1 読み取り行数', limit: 25_000_000_000 },
  r2ClassA: { label: 'R2 Class A オペレーション数', limit: 1_000_000 },
  r2ClassB: { label: 'R2 Class B オペレーション数', limit: 10_000_000 },
}

export const DEFAULT_THRESHOLD_RATIO = 0.8

/**
 * 使用量の実測値としきい値から、項目ごとの割合・超過判定を返す純粋関数。
 * usage に無い（または null の）項目は「取得できず」として unavailable = true にし、
 * ratio は null、exceeded は false にする（取得失敗を「超過なし」と混同させないため）。
 */
export function summarizeUsage(usage, thresholdRatio = DEFAULT_THRESHOLD_RATIO) {
  return Object.entries(PLAN_LIMITS).map(([key, { label, limit }]) => {
    const raw = usage?.[key]
    const unavailable = raw === null || raw === undefined
    const ratio = unavailable ? null : raw / limit
    return {
      key,
      label,
      limit,
      used: unavailable ? null : raw,
      ratio,
      exceeded: !unavailable && ratio >= thresholdRatio,
      unavailable,
    }
  })
}

/** 当月（JST）の開始・終了を UTC ISO8601 で返す純粋関数。境界は JST 0 時（design.md の日時は JST 基準） */
export function currentMonthWindowJst(now = new Date()) {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS)
  const startUtcMs =
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), 1, 0, 0, 0) - JST_OFFSET_MS
  return { startUtc: new Date(startUtcMs).toISOString(), endUtc: now.toISOString() }
}

// R2 の操作種別ごとの Class 分類（Cloudflare の課金ドキュメントに基づく推測。unverified）
const R2_CLASS_A_ACTIONS = new Set([
  'PutObject',
  'ListObjects',
  'PutBucket',
  'ListBuckets',
  'CopyObject',
  'CreateMultipartUpload',
  'UploadPart',
  'CompleteMultipartUpload',
])
const R2_CLASS_B_ACTIONS = new Set(['GetObject', 'HeadObject', 'HeadBucket'])

export const UNVERIFIED_NOTES = [
  'workersInvocationsAdaptive の sum に CPU 時間の合計を返すフィールド（cpuTimeUs）が' +
    '存在するかは未確認。Cloudflare の公開チュートリアル（querying-workers-metrics）の例は' +
    'quantiles.cpuTimeP50/cpuTimeP99（中央値・99 パーセンタイル）のみを示しており、' +
    '合計値を返すフィールドの例が見つかっていない（2026-09-21 時点で公開ドキュメントを確認）。' +
    'このフィールドだけ別の GraphQL リクエストに分けているため、名前が違っていても' +
    'Workers CPU 時間の項目だけが「取得できず」になり、他の項目のレポートは失敗しない',
  'd1AnalyticsAdaptiveGroups の rowsWritten/rowsRead、r2OperationsAdaptiveGroups の actionType/requests は' +
    'Cloudflare の公開ドキュメント（d1/observability・r2/platform の metrics-analytics）のクエリ例で確認済み',
  'r2OperationsAdaptiveGroups は datetime_geq/datetime_leq（変数型は公開ドキュメントの例では Time）、' +
    'd1AnalyticsAdaptiveGroups は date_geq/date_leq（変数型は Date、日付のみで時刻を含まない）で、' +
    'workersInvocationsAdaptive の例（datetime_geq/datetime_leq、変数型は string）と統一されていない。' +
    'このスクリプトはデータセットごとに公開ドキュメントの例と同じ引数名・変数を使うようにしている',
  'R2 の Class A/B へのオペレーション種別（actionType）の割り振りは Cloudflare の課金ドキュメントに基づく' +
    '推測で、網羅性は未確認',
  'カレンダー月（JST）と Cloudflare の課金期間（UTC 基準の可能性）が一致しない可能性がある',
]

function buildQuery(accountTag, startUtc, endUtc) {
  // d1AnalyticsAdaptiveGroups の date_geq/date_leq は日付（YYYY-MM-DD）を渡す例になっているため、
  // workersInvocationsAdaptive/r2OperationsAdaptiveGroups の datetime_geq/datetime_leq とは
  // 別の変数にする（時刻を含む ISO8601 をそのまま渡すと型が合わない可能性が高い）。
  const startDate = startUtc.slice(0, 10)
  const endDate = endUtc.slice(0, 10)
  const query = `
    query UsageReport($accountTag: string!, $start: string!, $end: string!, $startDate: Date, $endDate: Date) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) {
            sum { requests }
          }
          d1AnalyticsAdaptiveGroups(limit: 1, filter: { date_geq: $startDate, date_leq: $endDate }) {
            sum { rowsWritten, rowsRead }
          }
          r2OperationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end }) {
            dimensions { actionType }
            sum { requests }
          }
        }
      }
    }
  `
  return { query, variables: { accountTag, start: startUtc, end: endUtc, startDate, endDate } }
}

// CPU 時間だけ別リクエストにする。sum のフィールド名（cpuTimeUs）が実際の API と
// 違っていて GraphQL のバリデーションエラーになっても、このクエリだけが失敗するようにし、
// 他の項目（リクエスト数・D1・R2）まで巻き込んで全項目 unavailable にしないため。
function buildCpuTimeQuery(accountTag, startUtc, endUtc) {
  const query = `
    query UsageReportCpuTime($accountTag: string!, $start: string!, $end: string!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) {
            sum { cpuTimeUs }
          }
        }
      }
    }
  `
  return { query, variables: { accountTag, start: startUtc, end: endUtc } }
}

function extractUsage(graphqlJson, cpuTimeJson) {
  const account = graphqlJson?.data?.viewer?.accounts?.[0]
  if (!account) return {}
  const workers = account.workersInvocationsAdaptive?.[0]?.sum
  const d1 = account.d1AnalyticsAdaptiveGroups?.[0]?.sum
  const r2Groups = account.r2OperationsAdaptiveGroups ?? []
  const cpuTimeUs =
    cpuTimeJson?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.cpuTimeUs

  let r2ClassA = 0
  let r2ClassB = 0
  let r2Known = false
  for (const g of r2Groups) {
    const action = g?.dimensions?.actionType
    const count = g?.sum?.requests ?? 0
    if (R2_CLASS_A_ACTIONS.has(action)) {
      r2ClassA += count
      r2Known = true
    } else if (R2_CLASS_B_ACTIONS.has(action)) {
      r2ClassB += count
      r2Known = true
    }
  }

  return {
    workersRequests: workers?.requests ?? null,
    workersCpuMs: cpuTimeUs != null ? cpuTimeUs / 1000 : null,
    d1RowsWritten: d1?.rowsWritten ?? null,
    d1RowsRead: d1?.rowsRead ?? null,
    r2ClassA: r2Known ? r2ClassA : null,
    r2ClassB: r2Known ? r2ClassB : null,
  }
}

/**
 * Cloudflare GraphQL Analytics API から当月の使用量を取得しレポートを組み立てる。
 * GraphQL は POST なので、`createCfApi` の dryRun は使わない（dryRun は書き込み系を
 * 実行しない仕組みで、読み取り専用のこの呼び出しに使うと結果が常に null になってしまうため）。
 */
export async function runReport({
  thresholdRatio = DEFAULT_THRESHOLD_RATIO,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const { token, accountId } = readCfEnv(env)
  const api = createCfApi({ token, accountId, fetchImpl })
  const { startUtc, endUtc } = currentMonthWindowJst(now)
  const { query, variables } = buildQuery(accountId, startUtc, endUtc)
  const json = await api.post('/graphql', { query, variables })
  // GraphQL は HTTP 200 のまま { data: null, errors: [...] } を返すことがあり、
  // createCfApi は success フィールドを見ないのでこれを例外にできない。
  // ここで弾かないと extractUsage が空を返し、全項目 unavailable のまま
  // 「超過なし」としてジョブが緑で終わってしまう（H12 の監視が機能しなくなる）。
  if (json.errors?.length) {
    const detail = json.errors.map((e) => e.message).join('; ')
    throw new Error(
      `Cloudflare GraphQL API がエラーを返しました: ${detail}。` +
        'クエリ形状（データセット名・フィールド名）が実際の API と合っていない可能性があります。' +
        'scripts/cf/usage-report.mjs の buildQuery と UNVERIFIED_NOTES を確認してください。',
    )
  }

  // CPU 時間は buildCpuTimeQuery のコメントのとおり別リクエストにしてあるので、
  // ここが失敗しても上のレポート（リクエスト数・D1・R2）は失敗させない。
  let cpuTimeJson = null
  const unverified = [...UNVERIFIED_NOTES]
  try {
    const cpuQuery = buildCpuTimeQuery(accountId, startUtc, endUtc)
    const res = await api.post('/graphql', cpuQuery)
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
    cpuTimeJson = res
  } catch (e) {
    unverified.push(
      `Workers CPU 時間の取得に失敗したため、この項目は「取得できず」として扱いました: ${e.message}`,
    )
  }

  const usage = extractUsage(json, cpuTimeJson)
  const metrics = summarizeUsage(usage, thresholdRatio)
  return {
    windowStart: startUtc,
    windowEnd: endUtc,
    thresholdRatio,
    metrics,
    exceeded: metrics.filter((m) => m.exceeded).map((m) => m.label),
    unverified,
  }
}

export function formatMarkdown(report) {
  const lines = [
    `# Cloudflare 使用量レポート（${report.windowStart} 〜 ${report.windowEnd}）`,
    '',
    '| 項目 | 使用量 | 込み枠 | 割合 | 判定 |',
    '|---|---|---|---|---|',
  ]
  for (const m of report.metrics) {
    const used = m.unavailable ? '取得できず' : Math.round(m.used).toLocaleString('ja-JP')
    const ratio = m.unavailable ? '-' : `${(m.ratio * 100).toFixed(1)}%`
    const mark = m.unavailable ? '不明' : m.exceeded ? '**超過**' : 'OK'
    lines.push(`| ${m.label} | ${used} | ${m.limit.toLocaleString('ja-JP')} | ${ratio} | ${mark} |`)
  }
  lines.push('')
  lines.push(
    report.exceeded.length
      ? `しきい値（${(report.thresholdRatio * 100).toFixed(0)}%）を超えた項目: ${report.exceeded.join(', ')}`
      : 'しきい値を超えた項目はありません。',
  )
  if (report.unverified?.length) {
    lines.push('', '## 未検証事項（このレポートの前提のうち実アカウントで確認できていないもの）')
    for (const u of report.unverified) lines.push(`- ${u}`)
  }
  return lines.join('\n')
}

// --- CLI ---

function printUsage() {
  console.log(`使い方: node scripts/cf/usage-report.mjs [--json] [--threshold <0-100>] [--dry-run] [--help]

Cloudflare GraphQL Analytics API から当月の Workers / D1 / R2 使用量を取得し、
Workers Paid の込み枠に対する割合をしきい値（既定 80%）と比較する。

  --json                  結果を JSON で標準出力に出す（既定は Markdown）
  --threshold <0-100>     超過判定のしきい値をパーセントで指定（既定 80）
  --markdown-from-json <file>  API を呼ばず、指定した JSON レポートファイルから Markdown を組み立てる
  --dry-run               API を呼ばずに、取得予定の期間としきい値だけを表示する
  --help                  このヘルプを表示する

必要な環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID`)
}

function parseArgs(argv) {
  const args = {
    help: false,
    dryRun: false,
    json: false,
    thresholdPercent: 80,
    markdownFromJson: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--threshold') args.thresholdPercent = Number(argv[++i])
    else if (a === '--markdown-from-json') args.markdownFromJson = argv[++i]
    else throw new Error(`不明な引数: ${a}（--help で使い方を確認してください）`)
  }
  if (
    !Number.isFinite(args.thresholdPercent) ||
    args.thresholdPercent <= 0 ||
    args.thresholdPercent > 100
  ) {
    throw new Error(`--threshold は 1〜100 の数値で指定してください: ${args.thresholdPercent}`)
  }
  return args
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    return
  }

  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
    return
  }

  if (args.markdownFromJson) {
    const report = JSON.parse(readFileSync(args.markdownFromJson, 'utf8'))
    console.log(formatMarkdown(report))
    return
  }

  const thresholdRatio = args.thresholdPercent / 100

  if (args.dryRun) {
    const { startUtc, endUtc } = currentMonthWindowJst()
    const plan = {
      windowStart: startUtc,
      windowEnd: endUtc,
      thresholdRatio,
      metrics: Object.keys(PLAN_LIMITS),
      unverified: UNVERIFIED_NOTES,
    }
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
    } else {
      console.log(
        `[dry-run] ${plan.windowStart} 〜 ${plan.windowEnd} の使用量を取得予定（しきい値 ${args.thresholdPercent}%）。API は呼びません。`,
      )
    }
    return
  }

  let report
  try {
    report = await runReport({ thresholdRatio })
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
    return
  }
  console.log(args.json ? JSON.stringify(report, null, 2) : formatMarkdown(report))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
