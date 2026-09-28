// Cloudflare の当月使用量を GraphQL Analytics API で取得し、Workers の込み枠に対する割合を
// しきい値と比較するレポートを出す。
//
// 比較先のプランは PLAN_LIMITS のキー（'free' | 'paid'）で切り替える。既定は DEFAULT_PLAN。
// Free は上限のほとんどが 1 日あたりなので、日単位の項目（Workers リクエスト数、D1 の読み書き
// 行数）は対象期間の日ごとの値の最大値を上限と比べる。Workers CPU 時間は合計に月の枠が無く
// 1 リクエストあたり 10ms の上限しか無いため、p99 を 10ms と比べる。R2 は Workers のプランと
// 関係が無い別枠なので、free/paid とも対象期間の合計を同じ値の込み枠と比べる。
//
// 割合計算としきい値判定（summarizeUsage）は GraphQL のレスポンス形に依存しない純粋関数にし、
// 実測値の取得・整形（runReport・extractUsage）と分離してある。GraphQL のデータセット名・
// フィールド名は Cloudflare の公開ドキュメントに基づく最善の推測であり、実アカウントでの
// 疎通確認はできていない（UNVERIFIED_NOTES に列挙し、レポートにも含める）。

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'

// Cloudflare の込み枠。値を変えるときはここと確認日・出典を一緒に直す。
//
// Workers Free（確認日 2026-09-29、https://developers.cloudflare.com/workers/platform/limits/）:
//   リクエスト 10 万/日（UTC 0 時にリセット）、CPU 時間 10ms/リクエスト（Cron Trigger も同じ）。
// D1 Free（確認日 2026-09-29、https://developers.cloudflare.com/d1/platform/pricing/）:
//   読み取り 500 万行/日、書き込み 10 万行/日（いずれも UTC 0 時にリセット）。
//   上限に達するとクエリの実行自体が失敗する。
// R2 Free（確認日 2026-09-29、https://developers.cloudflare.com/r2/pricing/）:
//   Class A 100 万/月、Class B 1,000 万/月。Workers のプランとは別枠なので free/paid で共通。
// Workers Paid $5/月（確認日 2026-09-29、https://developers.cloudflare.com/workers/platform/pricing/）:
//   リクエスト 1,000 万/月が込み（日次上限は無い）、CPU 時間 3,000 万 CPU-ms/月が込み。
// D1（Workers Paid、確認日 2026-09-29、https://developers.cloudflare.com/d1/platform/pricing/）:
//   書き込み 5,000 万行/月、読み取り 250 億行/月が込み。
export const PLAN_LIMITS = {
  free: {
    workersRequests: { label: 'Workers リクエスト数（日次最大）', limit: 100_000 },
    workersCpuP99Ms: { label: 'Workers CPU 時間 p99（ms/リクエスト）', limit: 10 },
    d1RowsWritten: { label: 'D1 書き込み行数（日次最大）', limit: 100_000 },
    d1RowsRead: { label: 'D1 読み取り行数（日次最大）', limit: 5_000_000 },
    r2ClassA: { label: 'R2 Class A オペレーション数（月間）', limit: 1_000_000 },
    r2ClassB: { label: 'R2 Class B オペレーション数（月間）', limit: 10_000_000 },
  },
  paid: {
    workersRequests: { label: 'Workers リクエスト数（月間）', limit: 10_000_000 },
    workersCpuMs: { label: 'Workers CPU 時間（月間合計, ms）', limit: 30_000_000 },
    d1RowsWritten: { label: 'D1 書き込み行数（月間）', limit: 50_000_000 },
    d1RowsRead: { label: 'D1 読み取り行数（月間）', limit: 25_000_000_000 },
    r2ClassA: { label: 'R2 Class A オペレーション数（月間）', limit: 1_000_000 },
    r2ClassB: { label: 'R2 Class B オペレーション数（月間）', limit: 10_000_000 },
  },
}

export const DEFAULT_PLAN = 'free'
export const DEFAULT_THRESHOLD_RATIO = 0.8

/** 指定したプランの込み枠を返す。'free' / 'paid' 以外を渡すと分かりやすいメッセージで失敗する。 */
export function getPlanLimits(plan) {
  const limits = PLAN_LIMITS[plan]
  if (!limits) {
    throw new Error(`不明なプラン: ${plan}（'free' か 'paid' を指定してください）`)
  }
  return limits
}

/**
 * 使用量の実測値としきい値から、項目ごとの割合・超過判定を返す純粋関数。
 * usage に無い（または null の）項目は「取得できず」として unavailable = true にし、
 * ratio は null、exceeded は false にする（取得失敗を「超過なし」と混同させないため）。
 * usage に `${key}Date` があれば、日次最大値を記録した日として usedOnDate に載せる
 * （Free プランの日次上限項目でどの日が上限に近いかを示すため）。
 */
export function summarizeUsage(
  usage,
  thresholdRatio = DEFAULT_THRESHOLD_RATIO,
  plan = DEFAULT_PLAN,
) {
  const limits = getPlanLimits(plan)
  return Object.entries(limits).map(([key, { label, limit }]) => {
    const raw = usage?.[key]
    const unavailable = raw === null || raw === undefined
    const ratio = unavailable ? null : raw / limit
    return {
      key,
      label,
      limit,
      used: unavailable ? null : raw,
      usedOnDate: usage?.[`${key}Date`] ?? null,
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
  'workersInvocationsAdaptive・d1AnalyticsAdaptiveGroups に `dimensions { date }` を指定できるかは' +
    '未確認。公開ドキュメントのクエリ例では、workersInvocationsAdaptive は datetime/scriptName/status を' +
    '使った例（querying-workers-metrics チュートリアル）、d1AnalyticsAdaptiveGroups は date と' +
    'databaseId を使った例（d1/observability の metrics-analytics）があり、後者の date を' +
    'workersInvocationsAdaptive にも流用できると仮定している。これが実際の API と違う場合、' +
    'GraphQL 自体がエラーを返すため「使用量レポートを取得する」ステップが失敗する' +
    '（他の項目が unavailable として緑で終わるわけではない）',
  'quantiles.cpuTimeP50/cpuTimeP99（Workers CPU 時間の分布）は querying-workers-metrics' +
    'チュートリアルのクエリ例に記載がある一方、単位（マイクロ秒かミリ秒か）は明記されていない。' +
    'このスクリプトは他のフィールド（cpuTimeUs）の命名からマイクロ秒と仮定し、/1000 で ms に換算している',
  'd1AnalyticsAdaptiveGroups の rowsWritten/rowsRead、r2OperationsAdaptiveGroups の actionType/requests は' +
    'Cloudflare の公開ドキュメント（d1/observability・r2/platform の metrics-analytics）のクエリ例で確認済み',
  'r2OperationsAdaptiveGroups は datetime_geq/datetime_leq（変数型は公開ドキュメントの例では Time）、' +
    'd1AnalyticsAdaptiveGroups は date_geq/date_leq（変数型は Date、日付のみで時刻を含まない）で、' +
    'workersInvocationsAdaptive の例（datetime_geq/datetime_leq、変数型は string）と統一されていない。' +
    'このスクリプトはデータセットごとに公開ドキュメントの例と同じ引数名・変数を使うようにしている',
  'R2 の Class A/B へのオペレーション種別（actionType）の割り振りは Cloudflare の課金ドキュメントに基づく' +
    '推測で、網羅性は未確認',
  'Workers Free・D1 Free の日次上限は UTC 0 時にリセットされる（公開ドキュメントで確認済み）が、' +
    'このスクリプトの対象期間はカレンダー月（JST）なので、月初・月末は UTC の日区切りと厳密には揃わない',
  'Free プランの CPU 時間は p99 が 10ms 未満でも、それを上回る個々のリクエストがエラー 1102 に' +
    'なっていない保証にはならない。p99 は分布の目安であり、上限超過そのものを検知する値ではない',
]

// workersInvocationsAdaptive・d1AnalyticsAdaptiveGroups を日ごとにグループ化し、R2 は
// 対象期間の合計を取る 1 本のクエリ。Free（日次最大）・Paid（月間合計）のどちらも同じ
// レスポンスから計算できるため、プランで分けていない。
function buildQuery(accountTag, startUtc, endUtc) {
  const startDate = startUtc.slice(0, 10)
  const endDate = endUtc.slice(0, 10)
  const query = `
    query UsageReport($accountTag: string!, $start: string!, $end: string!, $startDate: Date, $endDate: Date) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 32, filter: { datetime_geq: $start, datetime_leq: $end }) {
            dimensions { date }
            sum { requests }
          }
          d1AnalyticsAdaptiveGroups(limit: 32, filter: { date_geq: $startDate, date_leq: $endDate }) {
            dimensions { date }
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

// CPU 時間だけ別リクエストにする。フィールド名の推測が実際の API と違っていて GraphQL の
// バリデーションエラーになっても、このクエリだけが失敗するようにし、他の項目
// （リクエスト数・D1・R2）まで巻き込んで全項目 unavailable にしないため。
// Free は 1 リクエストあたりの上限と比べるので分布（quantiles.cpuTimeP99）、
// Paid は月間の込み枠と比べるので合計（sum.cpuTimeUs）を取る。
function buildCpuTimeQuery(plan, accountTag, startUtc, endUtc) {
  if (plan === 'free') {
    const query = `
      query UsageReportCpuTimeFree($accountTag: string!, $start: string!, $end: string!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $start, datetime_leq: $end }) {
              quantiles { cpuTimeP99 }
            }
          }
        }
      }
    `
    return { query, variables: { accountTag, start: startUtc, end: endUtc } }
  }
  const query = `
    query UsageReportCpuTimePaid($accountTag: string!, $start: string!, $end: string!) {
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

/**
 * 日ごとにグループ化された行（[{ dimensions: { date }, sum: {...} }, ...]）から、
 * pick が取り出す値の最大値・合計・最大値を記録した日を計算する。
 * rows が配列でない（フィールド自体を取得できなかった）場合は null を返し、
 * 取得できたが 0 件（対象期間の使用量が実際にゼロ）の場合と区別する。
 */
function dailyStats(rows, pick) {
  if (!Array.isArray(rows)) return { max: null, total: null, maxDate: null }
  let max = null
  let maxDate = null
  let total = 0
  for (const row of rows) {
    const value = pick(row?.sum) ?? 0
    total += value
    if (max === null || value > max) {
      max = value
      maxDate = row?.dimensions?.date ?? null
    }
  }
  return { max: max ?? 0, total, maxDate }
}

function extractUsage(mainJson, cpuJson, plan) {
  const account = mainJson?.data?.viewer?.accounts?.[0]
  if (!account) return {}

  const workersDaily = dailyStats(account.workersInvocationsAdaptive, (sum) => sum?.requests)
  const d1WrittenDaily = dailyStats(account.d1AnalyticsAdaptiveGroups, (sum) => sum?.rowsWritten)
  const d1ReadDaily = dailyStats(account.d1AnalyticsAdaptiveGroups, (sum) => sum?.rowsRead)

  const r2Groups = account.r2OperationsAdaptiveGroups ?? []
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

  const usage = {
    r2ClassA: r2Known ? r2ClassA : null,
    r2ClassB: r2Known ? r2ClassB : null,
  }

  if (plan === 'free') {
    usage.workersRequests = workersDaily.max
    usage.workersRequestsDate = workersDaily.maxDate
    usage.d1RowsWritten = d1WrittenDaily.max
    usage.d1RowsWrittenDate = d1WrittenDaily.maxDate
    usage.d1RowsRead = d1ReadDaily.max
    usage.d1RowsReadDate = d1ReadDaily.maxDate
    const cpuTimeP99Us =
      cpuJson?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.quantiles?.cpuTimeP99
    usage.workersCpuP99Ms = cpuTimeP99Us != null ? cpuTimeP99Us / 1000 : null
  } else {
    usage.workersRequests = workersDaily.total
    usage.d1RowsWritten = d1WrittenDaily.total
    usage.d1RowsRead = d1ReadDaily.total
    const cpuTimeUs =
      cpuJson?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.cpuTimeUs
    usage.workersCpuMs = cpuTimeUs != null ? cpuTimeUs / 1000 : null
  }

  return usage
}

/**
 * Cloudflare GraphQL Analytics API から当月の使用量を取得しレポートを組み立てる。
 * GraphQL は POST なので、`createCfApi` の dryRun は使わない（dryRun は書き込み系を
 * 実行しない仕組みで、読み取り専用のこの呼び出しに使うと結果が常に null になってしまうため）。
 */
export async function runReport({
  plan = DEFAULT_PLAN,
  thresholdRatio = DEFAULT_THRESHOLD_RATIO,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  getPlanLimits(plan) // 不明なプランなら Cloudflare を呼ぶ前に失敗させる
  const { token, accountId } = readCfEnv(env)
  const api = createCfApi({ token, accountId, fetchImpl })
  const { startUtc, endUtc } = currentMonthWindowJst(now)
  const { query, variables } = buildQuery(accountId, startUtc, endUtc)
  const json = await api.post('/graphql', { query, variables })
  // GraphQL は HTTP 200 のまま { data: null, errors: [...] } を返すことがあり、
  // createCfApi は success フィールドを見ないのでこれを例外にできない。
  // ここで弾かないと extractUsage が空を返し、全項目 unavailable のまま
  // 「超過なし」としてジョブが緑で終わってしまう（使用量の監視が機能しなくなる）。
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
  let cpuJson = null
  const unverified = [...UNVERIFIED_NOTES]
  try {
    const cpuQuery = buildCpuTimeQuery(plan, accountId, startUtc, endUtc)
    const res = await api.post('/graphql', cpuQuery)
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
    cpuJson = res
  } catch (e) {
    unverified.push(
      `Workers CPU 時間の取得に失敗したため、この項目は「取得できず」として扱いました: ${e.message}`,
    )
  }

  const usage = extractUsage(json, cpuJson, plan)
  const metrics = summarizeUsage(usage, thresholdRatio, plan)
  return {
    plan,
    windowStart: startUtc,
    windowEnd: endUtc,
    thresholdRatio,
    metrics,
    exceeded: metrics.filter((m) => m.exceeded).map((m) => m.label),
    unverified,
  }
}

export function formatMarkdown(report) {
  const plan = report.plan ?? DEFAULT_PLAN
  const planLabel = plan === 'free' ? 'Workers Free' : 'Workers Paid（$5/月）'
  const lines = [
    `# Cloudflare 使用量レポート（${planLabel}の上限と比較, ${report.windowStart} 〜 ${report.windowEnd}）`,
    '',
    '| 項目 | 使用量 | 込み枠 | 割合 | 判定 |',
    '|---|---|---|---|---|',
  ]
  for (const m of report.metrics) {
    // CPU 時間の p99（ms）は小数で意味のある値になるため、Math.round ではなく小数第 1 位までにする
    // （リクエスト数・行数のような整数の項目は元々小数を含まないので、この丸め方でも変わらない）。
    const usedValue = m.unavailable
      ? '取得できず'
      : m.used.toLocaleString('ja-JP', { maximumFractionDigits: 1 })
    const used = m.usedOnDate ? `${usedValue}（${m.usedOnDate}）` : usedValue
    const ratio = m.unavailable ? '-' : `${(m.ratio * 100).toFixed(1)}%`
    const mark = m.unavailable ? '不明' : m.exceeded ? '**超過**' : 'OK'
    lines.push(`| ${m.label} | ${used} | ${m.limit.toLocaleString('ja-JP')} | ${ratio} | ${mark} |`)
  }
  lines.push('')

  if (report.exceeded.length) {
    lines.push(
      `しきい値（${(report.thresholdRatio * 100).toFixed(0)}%）を超えた項目: ${report.exceeded.join(', ')}`,
      '',
    )
    if (plan === 'free') {
      lines.push(
        '## しきい値超過時の対応（Workers Free）',
        'Workers・D1 は Free の込み枠（Workers・D1 とも UTC 0 時にリセット）に達すると、' +
          '課金されるのではなくその日はサービスが止まる。R2 だけは Workers のプランとは別課金で、' +
          '無料枠を超えても止まらず従量課金になる可能性がある（要確認）。',
        '- Workers リクエスト数が上限に達すると、以後のリクエストがエラー 1027 になる',
        '- D1 の読み取り・書き込み行数が上限に達すると、D1 のクエリが失敗し作成・通報などの API が失敗する',
        '- Workers CPU 時間の p99 が上限に近いと、個々のリクエストがエラー 1102 で強制終了する' +
          '（`try`/`catch` で捕捉できない）',
        '- R2 のオペレーション数が上限に近い場合は、止まる心配は無いが課金が発生し始める',
        '',
        '対応の選択肢:',
        '- スパムや異常アクセスがないか、エラーのログを確認する',
        '- D1 の `rate_limit_counters` の書き込みが多い場合、GC が正しく掃除できているか確認する',
        '- 恒常的に上限へ近いなら Workers Paid（$5/月）へ切り替える。込み枠が月間の合計値に変わり、' +
          '超過しても即座には止まらず少額課金で済む' +
          '（週次のレポートは `scripts/cf/usage-report.mjs` の `DEFAULT_PLAN` を変えると追随する）',
      )
    } else {
      lines.push(
        '## しきい値超過時の対応（Workers Paid）',
        'Paid プランは込み枠を超えてもサービスは止まらず、超過分が少額課金される' +
          '（例: CPU 時間は $0.02/100 万 CPU-ms）。',
        '- 恒常的に上限を超え続ける場合は、処理の見直し（キャッシュ、GC）を検討する',
      )
    }
  } else {
    lines.push('しきい値を超えた項目はありません。')
  }

  if (report.unverified?.length) {
    lines.push('', '## 未検証事項（このレポートの前提のうち実アカウントで確認できていないもの）')
    for (const u of report.unverified) lines.push(`- ${u}`)
  }
  return lines.join('\n')
}

// --- CLI ---

function printUsage() {
  console.log(`使い方: node scripts/cf/usage-report.mjs [--json] [--plan free|paid] [--threshold <0-100>] [--dry-run] [--help]

Cloudflare GraphQL Analytics API から当月の Workers / D1 / R2 使用量を取得し、
指定したプランの込み枠に対する割合をしきい値（既定 80%）と比較する。

  --json                  結果を JSON で標準出力に出す（既定は Markdown）
  --plan <free|paid>      比較する込み枠のプラン（既定 free）
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
    plan: DEFAULT_PLAN,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--json') args.json = true
    else if (a === '--plan') args.plan = argv[++i]
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
  if (!PLAN_LIMITS[args.plan]) {
    throw new Error(`--plan は 'free' か 'paid' を指定してください: ${args.plan}`)
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
      plan: args.plan,
      windowStart: startUtc,
      windowEnd: endUtc,
      thresholdRatio,
      metrics: Object.keys(getPlanLimits(args.plan)),
      unverified: UNVERIFIED_NOTES,
    }
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
    } else {
      console.log(
        `[dry-run] ${plan.windowStart} 〜 ${plan.windowEnd} の使用量を ${args.plan} プランの上限で` +
          `取得予定（しきい値 ${args.thresholdPercent}%）。API は呼びません。`,
      )
    }
    return
  }

  let report
  try {
    report = await runReport({ thresholdRatio, plan: args.plan })
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
