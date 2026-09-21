#!/usr/bin/env node
// RDAP（https://rdap.org/domain/<name>）でドメインの登録状況を調べる。
// 依存ゼロ（Node 標準の fetch）。fetch を差し替えられるのはテストのため。
//
// 使い方:
//   node scripts/check-domain.mjs <domain> [<domain> ...] [--json]
//
// 判定:
//   200 → 登録済み / 404 → 未登録 / それ以外 → 不明（HTTP ステータスを添える）
//
// .jp ドメインについて:
//   IANA の RDAP ブートストラップ（https://data.iana.org/rdap/dns.json）に jp の
//   エントリが無く、JPRS は公開 RDAP サーバを提供していない（WHOIS のみ）。
//   rdap.org 経由でも .jp は登録・未登録を問わずリダイレクトなしの 404 になり
//   区別できないため、.jp（co.jp 等のサブドメインも含む）は RDAP 照会をせず
//   「手動確認」として JPRS WHOIS の URL を案内する（確認結果は docs/runbooks/naming.md 参照）。

const RDAP_BASE_URL = 'https://rdap.org/domain'
const JPRS_WHOIS_URL = 'https://whois.jprs.jp/'
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 2000
// rdap.org は Cloudflare 経由で、Node の既定 UA（undici の "node"）だとボット判定され 403 になる。
// ブラウザ相当の UA を付けて回避する（実機確認済み。§ docs/runbooks/naming.md）。
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  Accept: 'application/rdap+json, application/json',
}

function usage() {
  return [
    '使い方: node scripts/check-domain.mjs <domain> [<domain> ...] [--json]',
    '',
    '例:',
    '  node scripts/check-domain.mjs calshare.com calshare.app calshare.jp',
    '  node scripts/check-domain.mjs calshare.com --json',
    '',
    'RDAP（rdap.org）で 200=登録済み / 404=未登録 / それ以外=不明 を判定する。',
    '.jp は RDAP 未対応（JPRS が公開 RDAP サーバを持たない）ため手動確認とする。',
  ].join('\n')
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const json = argv.includes('--json')
  const domains = argv.filter((a) => a !== '--json' && !a.startsWith('-'))
  return { domains, json }
}

/** @param {string} domain */
export function isJpDomain(domain) {
  return domain.toLowerCase().split('.').at(-1) === 'jp'
}

/** @param {number} httpStatus */
export function classifyHttpStatus(httpStatus) {
  if (httpStatus === 200) return '登録済み'
  if (httpStatus === 404) return '未登録'
  return '不明'
}

/**
 * 1 ドメインを判定する。.jp は照会せず手動確認を返す。
 * @param {string} domain
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.wait] リトライ待機を差し替えるため（テスト用）
 * @param {number} [options.maxRetries]
 * @param {number} [options.retryDelayMs] Retry-After が無いときの既定待機
 */
export async function checkDomain(domain, options = {}) {
  const {
    fetchImpl = fetch,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = options

  if (isJpDomain(domain)) {
    return {
      domain,
      method: 'manual',
      httpStatus: null,
      status: '手動確認',
      note: `RDAP 非対応。JPRS WHOIS で確認: ${JPRS_WHOIS_URL}`,
    }
  }

  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res
    try {
      res = await fetchImpl(`${RDAP_BASE_URL}/${domain}`, { headers: REQUEST_HEADERS })
    } catch (err) {
      lastError = err
      break
    }
    if (res.status === 429) {
      if (attempt < maxRetries) {
        const retryAfterHeader = res.headers?.get?.('retry-after')
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : retryDelayMs
        await wait(Number.isFinite(retryAfterMs) ? retryAfterMs : retryDelayMs)
        continue
      }
      return {
        domain,
        method: 'rdap',
        httpStatus: 429,
        status: '不明',
        note: 'RDAP のレート制限に到達。時間を空けて再実行してください',
      }
    }
    return {
      domain,
      method: 'rdap',
      httpStatus: res.status,
      status: classifyHttpStatus(res.status),
      note: '',
    }
  }
  return {
    domain,
    method: 'rdap',
    httpStatus: null,
    status: '不明',
    note: `RDAP への到達に失敗: ${lastError?.message ?? '不明なエラー'}`,
  }
}

/**
 * 複数ドメインを順に判定する。RDAP 照会の間だけ wait を挟み、レート制限を避ける。
 * @param {string[]} domains
 * @param {object} [options] checkDomain と同じ options に加えて betweenDelayMs
 */
export async function checkDomains(domains, options = {}) {
  const {
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    betweenDelayMs = 1000,
  } = options
  const results = []
  for (const domain of domains) {
    results.push(await checkDomain(domain, options))
    if (!isJpDomain(domain) && domain !== domains.at(-1)) await wait(betweenDelayMs)
  }
  return results
}

/** @param {Array<{domain: string, status: string, httpStatus: number | null, note: string}>} results */
export function formatTable(results) {
  const header = ['ドメイン', '判定', 'HTTP', '備考']
  const rows = results.map((r) => [r.domain, r.status, r.httpStatus ?? '-', r.note])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i]).length)),
  )
  const line = (cols) => cols.map((c, i) => String(c).padEnd(widths[i], ' ')).join('  ')
  return [line(header), ...rows.map(line)].join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const { domains, json } = parseArgs(args)
  if (domains.length === 0) {
    console.error(usage())
    process.exit(args.includes('--help') ? 0 : 1)
    return
  }
  const results = await checkDomains(domains)
  if (json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    console.log(formatTable(results))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`予期しないエラー: ${err.message}`)
    process.exit(1)
  })
}
