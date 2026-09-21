// Cloudflare REST API v4 の薄いクライアント。scripts/cf/ 配下のスクリプトが共通で使う。
// 依存ゼロ（Node 標準の fetch）。fetch を差し替えられるのはテストのため。
// dryRun のときは書き込み系（GET 以外）を実行せずログに出すだけにする。

const BASE_URL = 'https://api.cloudflare.com/client/v4'

export class CfApiError extends Error {
  constructor(method, path, status, errors) {
    const detail = errors.map((e) => `${e.code}: ${e.message}`).join('; ')
    super(`Cloudflare API ${method} ${path} が失敗 (HTTP ${status})${detail ? `: ${detail}` : ''}`)
    this.name = 'CfApiError'
    this.status = status
    this.errors = errors
  }
}

/**
 * 環境変数から認証情報を読む。無ければ、何をどこで発行するかを示すメッセージで失敗する。
 * @param {Record<string, string | undefined>} env
 * @returns {{ token: string, accountId: string }}
 */
export function readCfEnv(env = process.env) {
  const token = env.CLOUDFLARE_API_TOKEN
  const accountId = env.CLOUDFLARE_ACCOUNT_ID
  const missing = [!token && 'CLOUDFLARE_API_TOKEN', !accountId && 'CLOUDFLARE_ACCOUNT_ID'].filter(
    Boolean,
  )
  if (missing.length) {
    throw new Error(
      `${missing.join(', ')} が未設定です。docs/runbooks/cloudflare-api-token.md の手順で発行し、` +
        'ローカルでは環境変数、CI では GitHub Secrets に設定してください。',
    )
  }
  return { token, accountId }
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.accountId
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.dryRun]
 * @param {(line: string) => void} [options.log]
 */
export function createCfApi({
  token,
  accountId,
  fetchImpl = fetch,
  dryRun = false,
  log = (line) => console.error(line),
}) {
  async function request(method, path, body) {
    if (dryRun && method !== 'GET') {
      log(`[dry-run] ${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`)
      return { success: true, result: null, dryRun: true }
    }
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.success === false) {
      throw new CfApiError(method, path, res.status, json.errors ?? [])
    }
    return json
  }

  /** result_info.total_pages に従って全ページを集める */
  async function getAll(path) {
    const items = []
    const sep = path.includes('?') ? '&' : '?'
    for (let page = 1; ; page++) {
      const json = await request('GET', `${path}${sep}page=${page}&per_page=50`)
      items.push(...(json.result ?? []))
      const info = json.result_info
      if (!info || page >= (info.total_pages ?? 1)) return items
    }
  }

  return {
    accountId,
    dryRun,
    get: (path) => request('GET', path),
    getAll,
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  }
}
