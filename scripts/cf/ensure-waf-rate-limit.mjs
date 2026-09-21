#!/usr/bin/env node
// /api/* へのレート制限ルール（design §9.3 の D1 カウンタの手前に置く保険、§4.3・H13）を
// http_ratelimit フェーズのルールセットに冪等に作る。既存ルールは description で識別し、
// 内容が変わっていれば更新する（Cloudflare のルールセットは配列全体を PUT する API のため、
// 対象ルール以外を壊さないよう既存の rules 配列を読んでから該当ルールだけ差し替える）。
//
// 要検証（実アカウント未確認。docs/runbooks/cloudflare-api-token.md と
// docs/runbooks/provisioning.md にも同じ注記がある）:
// - Free プランでの rate limiting の下限値（period・requests_per_period・mitigation_timeout の
//   最小値と組み合わせ制約）。ここでは design の「10 秒に 10 リクエスト超」をそのまま渡す。
// - action: 'block' の応答は Cloudflare 側で固定の 403 になる（H13 の記述にある「429」は
//   D1 側のアプリケーションレベルの制限のレスポンスコードであり、WAF 側の 403 とは別物）。
//   429 で応答させるには action の customize（Enterprise 機能の可能性）が要るかもしれない。
// - http_ratelimit フェーズにルールが 1 つも無いときに GET が 404 になるのか、
//   空の rules 配列で 200 を返すのかは未確認。ここでは 404 を「未設定」として扱う。
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createCfApi, readCfEnv } from './lib/cfApi.mjs'
import { toMarkdownTable } from './lib/format.mjs'

export const RULE_DESCRIPTION = 'calshare: /api/* rate limit (10 req / 10s per IP, Free plan)'

const USAGE = `使い方: node scripts/cf/ensure-waf-rate-limit.mjs --domain <domain> [--dry-run] [--json] [--help]

<domain> のゾーンに /api/* へのレート制限ルールを http_ratelimit フェーズへ冪等に作る。
既存ルールは description で識別して内容が変わっていれば更新する。

  --domain <domain>   対象のドメイン名（必須。ensure-zone.mjs で作成済みであること）
  --dry-run           ルールセットへの書き込みを行わず、計画だけを表示する
  --json              機械可読な JSON で出力する
  --help              このヘルプを表示する`

function buildRule() {
  return {
    description: RULE_DESCRIPTION,
    expression: 'starts_with(http.request.uri.path, "/api/")',
    action: 'block',
    ratelimit: {
      characteristics: ['ip.src'],
      period: 10,
      requests_per_period: 10,
      mitigation_timeout: 10,
    },
  }
}

/**
 * description 以外の「中身」だけを比較するための指紋。ratelimit は自分が設定する
 * 4 項目だけを取り出す。Cloudflare が応答に補って返す項目（requests_to_origin 等）や
 * キー順の違いを拾うと、内容が同じでも毎回 'updated' と判定して PUT してしまう。
 */
function ruleFingerprint(rule) {
  const { characteristics, period, requests_per_period, mitigation_timeout } = rule.ratelimit ?? {}
  return JSON.stringify({
    expression: rule.expression,
    action: rule.action,
    ratelimit: { characteristics, period, requests_per_period, mitigation_timeout },
  })
}

/** @param {{ api: ReturnType<typeof createCfApi>, domain: string }} deps */
export async function ensureWafRateLimit({ api, domain }) {
  const zones = await api.getAll(
    `/zones?name=${encodeURIComponent(domain)}&account.id=${api.accountId}`,
  )
  const zone = zones.find((z) => z.name === domain)
  if (!zone) {
    throw new Error(
      `ゾーン ${domain} が見つかりません。先に ensure-zone.mjs でゾーンを作成してください。`,
    )
  }

  let existingRules = []
  try {
    const entrypoint = await api.get(`/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`)
    existingRules = entrypoint.result?.rules ?? []
  } catch (err) {
    if (err.status !== 404) throw err
    // 404 = このフェーズにルールセットがまだ無い（要検証。上記コメント参照）。空から始める。
  }

  const wantedRule = buildRule()
  const idx = existingRules.findIndex((r) => r.description === RULE_DESCRIPTION)
  let action
  let rules
  if (idx === -1) {
    action = 'created'
    rules = [...existingRules, wantedRule]
  } else if (ruleFingerprint(existingRules[idx]) === ruleFingerprint(wantedRule)) {
    action = 'unchanged'
    rules = existingRules
  } else {
    action = 'updated'
    rules = existingRules.map((r, i) => (i === idx ? wantedRule : r))
  }

  if (action !== 'unchanged') {
    await api.put(`/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`, { rules })
  }

  return {
    domain,
    zoneId: zone.id,
    action,
    rule: wantedRule,
    dryRun: action !== 'unchanged' && api.dryRun,
  }
}

function formatText({ domain, action, rule, dryRun }) {
  const table = toMarkdownTable(
    ['項目', '値'],
    [
      ['ドメイン', domain],
      [
        '状態',
        { created: '新規作成', updated: '既存ルールを更新', unchanged: '変更なし（既に一致）' }[
          action
        ] + (dryRun ? '（dry-run のため未実行）' : ''),
      ],
      ['ルール', rule.description],
      ['expression', rule.expression],
      ['action', `${rule.action}（応答は 403。design H13 の「429」は D1 側の制限を指す。要検証）`],
      [
        'period / requests_per_period / mitigation_timeout',
        `${rule.ratelimit.period}s / ${rule.ratelimit.requests_per_period} / ${rule.ratelimit.mitigation_timeout}s`,
      ],
    ],
  )
  return `${table}\n\n要検証: Free プランでのパラメータ制約は docs/runbooks/cloudflare-api-token.md を参照し、実アカウントで一度確認してください。`
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      domain: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log(USAGE)
    return
  }
  if (!values.domain) {
    console.error('--domain は必須です。\n')
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const { token, accountId } = readCfEnv()
  const api = createCfApi({ token, accountId, dryRun: values['dry-run'] })
  const result = await ensureWafRateLimit({ api, domain: values.domain })
  console.log(values.json ? JSON.stringify(result, null, 2) : formatText(result))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
}
