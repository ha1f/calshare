#!/usr/bin/env node
// 公開前・公開直後・大きな変更後に「公開してよい状態か」を機械的に確認する。
// 依存ゼロ（Node 20 の child_process / fs / fetch のみ）。
// gh 未インストール・未認証・CLOUDFLARE_API_TOKEN 未設定でも落ちず、
// 該当項目を「確認できなかった項目」に振り分ける（check-domain.mjs と同じ方針）。
//
// 使い方:
//   node .claude/skills/go-live-check/scripts/go-live-check.mjs [--json] [--repo-root <path>]
//
// このスクリプトが担うのは機械的に判定できる部分だけ。
// docs/design.md §14.2（未決事項）の各項目が「決まったか」や、
// `owner help wanted` Issue 本文の残作業の要約は、実行するセッション（Claude）が
// 都度 Issue を読んで判断する（references/checklist.md に手順がある）。

import { execFile } from 'node:child_process'
import { readFile, access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT_FROM_THIS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
)

const REQUIRED_GH_SECRETS = [
  {
    name: 'CLOUDFLARE_API_TOKEN',
    who: 'オーナー（H5）',
    action: 'Cloudflare API トークンを発行し GitHub Secrets に登録する',
  },
  {
    name: 'CLOUDFLARE_ACCOUNT_ID',
    who: 'オーナー（H5）',
    action: 'Cloudflare アカウント ID を GitHub Secrets に登録する',
  },
]
const OPTIONAL_GH_SECRETS = [
  {
    name: 'REPORT_WEBHOOK_URL',
    who: 'オーナー（H7）',
    action:
      '通報通知先（Discord/Slack の Incoming Webhook）を作成し登録する。未設定でも通報の受理自体は失敗しない（Fake Notifier で動く）が、公開後は通報が誰にも届かない',
  },
]
const GH_VARIABLES_TO_CHECK = ['DEPLOY_ENABLED', 'PUBLIC_DOMAIN']
const WRANGLER_PLACEHOLDER_DATABASE_ID = '00000000-0000-0000-0000-000000000000'
// design.md §14.2 の項目のうち、公開判断そのものをブロックするもの（設計書の番号に対応）。
// 3〜6・8・9 は運用しながら調整できるチューニング項目なので、要確認止まりで公開はブロックしない。
// 設計書の §14.2 の番号立てを変えたときは、ここも合わせて見直す。
const UNDECIDED_ITEM_BLOCKING_INDEXES = new Set([1, 7])
const PLACEHOLDER_KEYWORD_PATTERN = /TBD|未定|準備中|検討中|未実施|未確認|記入|YYYY-MM-DD|xxxx/i
// 値の全体が半角/全角の括弧・山括弧で囲まれているだけなら、記入例や「オーナーが記入」のような
// プレースホルダとみなす（"（オーナーが記入。例: 2026-10-01）" のような docs/legal の雛形を検出するため）
const WRAPPED_IN_BRACKETS_PATTERN = /^[[（(].*[\]）)]$/

/** フィールドの値が未記入のプレースホルダに見えるかを判定する */
export function looksLikePlaceholder(value) {
  if (/^\s*$/.test(value)) return true
  if (WRAPPED_IN_BRACKETS_PATTERN.test(value)) return true
  return PLACEHOLDER_KEYWORD_PATTERN.test(value)
}

// ---------------------------------------------------------------------------
// 純粋関数（node:test の対象）
// ---------------------------------------------------------------------------

/**
 * wrangler.jsonc は JSONC（// 行コメント・/* ブロックコメント付き）なので JSON.parse できない。
 * 文字列リテラルの外側にあるコメントを除去する。
 * @param {string} text
 */
export function stripJsonComments(text) {
  let result = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inBlockComment) {
      if (ch === '*' && text[i + 1] === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        result += ch
      }
      continue
    }
    if (inString) {
      result += ch
      if (ch === '\\') {
        result += text[i + 1] ?? ''
        i++
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      result += ch
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      inLineComment = true
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      inBlockComment = true
      i++
      continue
    }
    result += ch
  }
  return result
}

/**
 * JSONC は配列・オブジェクトの末尾カンマを許すが JSON.parse は許さない。
 * 文字列リテラルの外側で、次に非空白文字として `}` か `]` が来るカンマだけを除去する。
 * @param {string} text コメント除去済みのテキスト
 */
export function stripTrailingCommas(text) {
  let result = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      result += ch
      if (ch === '\\') {
        result += text[i + 1] ?? ''
        i++
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      result += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') continue // カンマを結果に含めず読み飛ばす
    }
    result += ch
  }
  return result
}

/** @param {string} text wrangler.jsonc の生テキスト */
export function parseWranglerJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)))
}

/**
 * wrangler.jsonc の内容から公開判断に関わる項目を読む。
 * @param {any} config parseWranglerJsonc の戻り値
 */
export function analyzeWranglerConfig(config) {
  const databaseId = config?.d1_databases?.[0]?.database_id ?? null
  const databaseIdIsPlaceholder =
    databaseId === null || databaseId === WRANGLER_PLACEHOLDER_DATABASE_ID
  const workersDevEnabled = config?.workers_dev !== false
  const hasRoutes = Array.isArray(config?.routes) && config.routes.length > 0
  const publicOrigin = config?.vars?.PUBLIC_ORIGIN ?? null
  const publicOriginLooksLocalOrPlaceholder =
    typeof publicOrigin === 'string' && /localhost|127\.0\.0\.1|\.example(\/|$)/.test(publicOrigin)
  return {
    databaseId,
    databaseIdIsPlaceholder,
    workersDevEnabled,
    hasRoutes,
    publicOrigin,
    publicOriginLooksLocalOrPlaceholder,
  }
}

/** `gh secret list` の生出力（1行1シークレット、先頭列が名前）を名前の配列にする */
export function parseGhSecretList(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\t+/)[0])
}

/** `gh variable list` の生出力（NAME\tVALUE\t...）を name → value の Map にする */
export function parseGhVariableList(stdout) {
  const map = new Map()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [name, value] = trimmed.split(/\t+/)
    map.set(name, value ?? '')
  }
  return map
}

/**
 * 必須・任意シークレットの一覧から、公開可否チェックの項目（status/who/action）を組み立てる。
 * @param {string[]} presentNames `gh secret list` から取れた名前
 */
export function buildSecretItems(presentNames) {
  const present = new Set(presentNames)
  const items = []
  for (const { name, who, action } of REQUIRED_GH_SECRETS) {
    items.push(
      present.has(name)
        ? {
            key: `secret:${name}`,
            label: `GitHub Secret: ${name}`,
            status: 'ok',
            who,
            action: '',
            detail: '登録済み',
          }
        : {
            key: `secret:${name}`,
            label: `GitHub Secret: ${name}`,
            status: 'blocker',
            who,
            action,
            detail: '未登録',
          },
    )
  }
  for (const { name, who, action } of OPTIONAL_GH_SECRETS) {
    items.push(
      present.has(name)
        ? {
            key: `secret:${name}`,
            label: `GitHub Secret: ${name}`,
            status: 'ok',
            who,
            action: '',
            detail: '登録済み',
          }
        : {
            key: `secret:${name}`,
            label: `GitHub Secret: ${name}`,
            status: 'warn',
            who,
            action,
            detail: '未登録',
          },
    )
  }
  return items
}

/**
 * CI の最新実行結果から項目を組み立てる。
 * @param {Array<{ conclusion: string | null, status: string, url: string }>} runs main ブランチ絞り込み済み・新しい順
 */
export function buildCiItem(runs) {
  const latest = runs[0]
  if (!latest) {
    return {
      key: 'ci',
      label: 'CI (main の最新実行)',
      status: 'warn',
      who: '実装担当',
      action: '一度 CI を回して green を確認する',
      detail: 'main での実行履歴が無い',
    }
  }
  if (latest.status !== 'completed') {
    return {
      key: 'ci',
      label: 'CI (main の最新実行)',
      status: 'warn',
      who: '—',
      action: '完了を待って再確認する',
      detail: `実行中（${latest.status}）: ${latest.url}`,
    }
  }
  if (latest.conclusion !== 'success') {
    return {
      key: 'ci',
      label: 'CI (main の最新実行)',
      status: 'blocker',
      who: '実装担当',
      action: '失敗している CI を直す',
      detail: `${latest.conclusion}: ${latest.url}`,
    }
  }
  return {
    key: 'ci',
    label: 'CI (main の最新実行)',
    status: 'ok',
    who: '—',
    action: '',
    detail: `green: ${latest.url}`,
  }
}

/**
 * GitHub Variables の値をそのまま報告用の項目にする。
 * 意味（デプロイを許可するか等）は .github/workflows/deploy.yml 側の実装が決めるので、
 * ここでは「設定されているか・値は何か」を出すだけで blocker にはしない。
 * @param {Map<string, string>} variables
 */
export function buildVariableItems(variables) {
  return GH_VARIABLES_TO_CHECK.map((name) => {
    const value = variables.get(name)
    return value === undefined
      ? {
          key: `var:${name}`,
          label: `GitHub Variable: ${name}`,
          status: 'warn',
          who: 'オーナー',
          action: '値を設定するか、未設定で意図通りか .github/workflows/deploy.yml で確認する',
          detail: '未設定',
        }
      : {
          key: `var:${name}`,
          label: `GitHub Variable: ${name}`,
          status: 'ok',
          who: '—',
          action: '',
          detail: value,
        }
  })
}

/** 文字列中の `ラベル: 値` を 1 つ探す。無ければ null */
export function findFieldValue(text, fieldLabel) {
  const m = text.match(new RegExp(`${fieldLabel}[:：][^\\S\\r\\n]*(.*)`, 'm'))
  return m ? m[1].trim() : null
}

/**
 * 法的文書（利用規約・プライバシーポリシー等）に施行日・運営者が埋まっているかを見る。
 * @param {string} text ファイル内容
 */
export function checkLegalDocFields(text) {
  const effectiveDate = findFieldValue(text, '施行日')
  const operator = findFieldValue(text, '運営者')
  const issues = []
  if (effectiveDate === null) issues.push('施行日の記載が見つからない')
  else if (looksLikePlaceholder(effectiveDate)) issues.push(`施行日が未確定（"${effectiveDate}"）`)
  if (operator === null) issues.push('運営者の記載が見つからない')
  else if (looksLikePlaceholder(operator)) issues.push(`運営者が未確定（"${operator}"）`)
  return { effectiveDate, operator, issues }
}

/**
 * docs/runbooks/line-device-test.md の「結果」欄が埋まっているかを見る。
 * 見出し（`## 結果` 等）としての「結果」直後、次の見出しか区切り線（---）までを本文として扱う。
 * 見出しより前の地の文にある「結果」という語（例:「本手順の結果は下記に記録します」）には反応しない。
 * @param {string} text
 */
export function checkLineDeviceTestResult(text) {
  const m = text.match(/^#{1,3}\s*結果[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|$)/m)
  const body = (m ? m[1] : '').trim()
  const recorded = body.length > 0 && !looksLikePlaceholder(body)
  return { recorded, excerpt: body.slice(0, 200) }
}

/**
 * docs/design.md の §14.2 未決事項を番号付きリストとして抜き出す。
 * @param {string} designText
 * @returns {Array<{ index: number, title: string, detail: string }>}
 */
export function extractUndecidedItems(designText) {
  const sectionMatch = designText.match(
    /###\s*14\.2\s*未決事項[^\n]*\n([\s\S]*?)(\n###\s|\n---\s*\n|$)/,
  )
  if (!sectionMatch) return []
  const body = sectionMatch[1]
  const items = []
  const re = /^(\d+)\.\s+\*\*(.+?)\*\*[.。]?\s*(.*)$/gm
  let m
  while ((m = re.exec(body))) {
    items.push({ index: Number(m[1]), title: m[2].trim(), detail: m[3].trim() })
  }
  return items
}

/** extractUndecidedItems の結果を公開可否チェックの項目に変換する */
export function buildUndecidedItems(undecidedItems) {
  return undecidedItems.map((item) => {
    const blocks = UNDECIDED_ITEM_BLOCKING_INDEXES.has(item.index)
    return {
      key: `undecided:${item.index}`,
      label: `未決事項 §14.2-${item.index}: ${item.title}`,
      status: blocks ? 'blocker' : 'warn',
      who: 'オーナー',
      action: blocks
        ? '設計書 §14.2 を読み、この項目を決める（決めるまで公開判断ができない）'
        : '設計書 §14.2 を読み、決めるか仮置きのまま進めるかを判断する（公開自体はブロックしない）',
      detail: item.detail,
    }
  })
}

/** items 全体から判定（公開可否）を1つ決める */
export function computeVerdict(items) {
  if (items.some((i) => i.status === 'blocker')) return '公開不可'
  if (items.some((i) => i.status === 'warn' || i.status === 'unknown'))
    return '条件付き公開可（要確認あり）'
  return '公開可'
}

/**
 * 固定テンプレート（判定 / ブロッカー / 推奨事項 / 確認できなかった項目）で組み立てる。
 * @param {Array<{ label: string, status: string, who: string, action: string, detail: string }>} items
 */
export function buildReport(items, { generatedAt = new Date().toISOString() } = {}) {
  const verdict = computeVerdict(items)
  const blockers = items.filter((i) => i.status === 'blocker')
  const warns = items.filter((i) => i.status === 'warn')
  const unknowns = items.filter((i) => i.status === 'unknown')
  const formatItem = (i) =>
    `- **${i.label}**（${i.who}）: ${i.action}${i.detail ? `（現状: ${i.detail}）` : ''}`
  const section = (title, list, emptyText) =>
    `## ${title}\n${list.length ? list.map(formatItem).join('\n') : emptyText}`
  return [
    '# 公開可否チェック',
    '',
    `生成日時: ${generatedAt}`,
    '',
    '## 判定',
    verdict,
    '',
    section('ブロッカー', blockers, 'ブロッカーなし'),
    '',
    section('推奨事項', warns, '推奨事項なし'),
    '',
    section('確認できなかった項目', unknowns, 'すべて確認できた'),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// I/O まわり（gh / ファイル読み取り）。テストでは差し替える
// ---------------------------------------------------------------------------

function execFileAsync(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

async function readTextFileOrNull(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** gh が使えるか（インストール済み・ログイン済み）を確認する。使えなければ理由付きで false */
async function checkGhAvailable(exec) {
  const version = await exec('gh', ['--version'])
  if (version.error)
    return { ok: false, reason: 'gh CLI が見つからない（https://cli.github.com/ でインストール）' }
  const auth = await exec('gh', ['auth', 'status'])
  if (auth.error) return { ok: false, reason: 'gh 未認証（`gh auth login` を実行）' }
  return { ok: true, reason: '' }
}

function unknownItem(key, label, reason) {
  return { key, label, status: 'unknown', who: '—', action: '', detail: reason }
}

// ---------------------------------------------------------------------------
// 全項目を集めて構築する
// ---------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {(cmd: string, args: string[]) => Promise<{error: any, stdout: string, stderr: string}>} [deps.exec]
 * @param {string} [deps.repoRoot]
 */
export async function collectChecklistItems(deps = {}) {
  const exec = deps.exec ?? execFileAsync
  const repoRoot = deps.repoRoot ?? REPO_ROOT_FROM_THIS_FILE
  const items = []

  const gh = await checkGhAvailable(exec)

  // GitHub Secrets
  if (!gh.ok) {
    items.push(unknownItem('secrets', 'GitHub Secrets', gh.reason))
  } else {
    const res = await exec('gh', ['secret', 'list'])
    if (res.error)
      items.push(
        unknownItem('secrets', 'GitHub Secrets', `gh secret list に失敗: ${res.stderr.trim()}`),
      )
    else items.push(...buildSecretItems(parseGhSecretList(res.stdout)))
  }

  // GitHub Variables
  if (!gh.ok) {
    items.push(unknownItem('variables', 'GitHub Variables', gh.reason))
  } else {
    const res = await exec('gh', ['variable', 'list'])
    if (res.error)
      items.push(
        unknownItem(
          'variables',
          'GitHub Variables',
          `gh variable list に失敗: ${res.stderr.trim()}`,
        ),
      )
    else items.push(...buildVariableItems(parseGhVariableList(res.stdout)))
  }

  // CI の状態
  if (!gh.ok) {
    items.push(unknownItem('ci', 'CI (main の最新実行)', gh.reason))
  } else {
    const res = await exec('gh', [
      'run',
      'list',
      '--branch',
      'main',
      '--limit',
      '1',
      '--json',
      'status,conclusion,url',
    ])
    if (res.error)
      items.push(
        unknownItem('ci', 'CI (main の最新実行)', `gh run list に失敗: ${res.stderr.trim()}`),
      )
    else items.push(buildCiItem(JSON.parse(res.stdout)))
  }

  // owner help wanted Issue
  if (!gh.ok) {
    items.push(unknownItem('issues', 'owner help wanted Issue', gh.reason))
  } else {
    const res = await exec('gh', [
      'issue',
      'list',
      '--label',
      'owner help wanted',
      '--state',
      'open',
      '--json',
      'number,title,url',
    ])
    if (res.error)
      items.push(
        unknownItem(
          'issues',
          'owner help wanted Issue',
          `gh issue list に失敗: ${res.stderr.trim()}`,
        ),
      )
    else {
      const issues = JSON.parse(res.stdout)
      items.push(
        issues.length === 0
          ? {
              key: 'issues',
              label: 'owner help wanted Issue',
              status: 'ok',
              who: '—',
              action: '',
              detail: 'open な Issue なし',
            }
          : {
              key: 'issues',
              label: 'owner help wanted Issue',
              status: 'warn',
              who: 'オーナー / Claude',
              action:
                '各 Issue 本文の「オーナーに残る作業」「完了したら進むこと」を読み、公開をブロックするか判断する（references/checklist.md）',
              detail: issues.map((i) => `#${i.number} ${i.title}`).join(' / '),
            },
      )
    }
  }

  // wrangler.jsonc
  const wranglerPath = path.join(repoRoot, 'wrangler.jsonc')
  const wranglerText = await readTextFileOrNull(wranglerPath)
  if (wranglerText === null) {
    items.push({
      key: 'wrangler',
      label: 'wrangler.jsonc',
      status: 'blocker',
      who: '実装担当（T1）',
      action: '足場 PR（T1）で wrangler.jsonc を用意する',
      detail: 'ファイルが存在しない',
    })
  } else {
    try {
      const config = analyzeWranglerConfig(parseWranglerJsonc(wranglerText))
      items.push(
        config.databaseIdIsPlaceholder
          ? {
              key: 'wrangler:db',
              label: 'wrangler.jsonc の database_id',
              status: 'blocker',
              who: 'オーナー（H4）',
              action: '本番 D1 を作成し database_id を置換する',
              detail: config.databaseId ?? '(未設定)',
            }
          : {
              key: 'wrangler:db',
              label: 'wrangler.jsonc の database_id',
              status: 'ok',
              who: '—',
              action: '',
              detail: config.databaseId,
            },
      )
      items.push(
        config.workersDevEnabled
          ? {
              key: 'wrangler:workers_dev',
              label: 'wrangler.jsonc の workers_dev',
              status: 'blocker',
              who: 'オーナー（H3）',
              action: 'カスタムドメイン割り当て後に workers_dev を false にする',
              detail: 'true のまま',
            }
          : {
              key: 'wrangler:workers_dev',
              label: 'wrangler.jsonc の workers_dev',
              status: 'ok',
              who: '—',
              action: '',
              detail: 'false',
            },
      )
      items.push(
        config.publicOriginLooksLocalOrPlaceholder
          ? {
              key: 'wrangler:origin',
              label: 'PUBLIC_ORIGIN',
              status: 'blocker',
              who: 'オーナー（H1）',
              action: '本番ドメイン確定後、deploy.yml の --var で本番 PUBLIC_ORIGIN を渡す',
              detail: config.publicOrigin,
            }
          : {
              key: 'wrangler:origin',
              label: 'PUBLIC_ORIGIN',
              status: 'ok',
              who: '—',
              action: '',
              detail: config.publicOrigin,
            },
      )
      if (!config.hasRoutes) {
        items.push(
          unknownItem(
            'wrangler:routes',
            'カスタムドメイン割り当て（routes）',
            'wrangler.jsonc に routes 設定なし。Custom Domains は Cloudflare ダッシュボード側で完結することがあるためファイルからは判定できない。H3 の完了を Cloudflare ダッシュボードで確認する',
          ),
        )
      }
    } catch (err) {
      items.push({
        key: 'wrangler',
        label: 'wrangler.jsonc',
        status: 'blocker',
        who: '実装担当',
        action: 'wrangler.jsonc の JSON(C) 構文を直す',
        detail: err.message,
      })
    }
  }

  // Cloudflare 側（トークンがあれば）
  const checkTokenScript = path.join(repoRoot, 'scripts/cf/check-token.mjs')
  const usageReportScript = path.join(repoRoot, 'scripts/cf/usage-report.mjs')
  const hasCfEnv = Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
  for (const [key, label, scriptPath] of [
    ['cf:token', 'Cloudflare API トークンの有効性', checkTokenScript],
    ['cf:usage', 'Cloudflare Usage', usageReportScript],
  ]) {
    if (!(await fileExists(scriptPath))) {
      items.push(
        unknownItem(
          key,
          label,
          `${path.relative(repoRoot, scriptPath)} が無い（このリポジトリでは別 PR/エージェントが用意する想定）`,
        ),
      )
      continue
    }
    if (!hasCfEnv) {
      items.push(
        unknownItem(
          key,
          label,
          'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID がローカル環境変数に無い（このマシンでは未確認。CI 側は GitHub Secrets の項目を見る）',
        ),
      )
      continue
    }
    const res = await exec('node', [scriptPath])
    items.push(
      res.error
        ? {
            key,
            label,
            status: 'blocker',
            who: 'オーナー',
            action: 'スクリプトの出力を見て Cloudflare 側の設定を直す',
            detail: res.stderr.trim().slice(0, 200),
          }
        : {
            key,
            label,
            status: 'ok',
            who: '—',
            action: '',
            detail: res.stdout.trim().slice(0, 200),
          },
    )
  }

  // docs/legal/*.md（scripts/legal/checkLegalDocs.mjs があれば cf:* と同じ作りでそちらに委譲する。
  // 施行日・運営者の空欄に加え、条番号の連番・変更履歴表の有無まで検査できるため）
  const legalCheckScript = path.join(repoRoot, 'scripts/legal/checkLegalDocs.mjs')
  if (await fileExists(legalCheckScript)) {
    const res = await exec('node', [legalCheckScript, '--json'])
    let parsed = null
    try {
      parsed = JSON.parse(res.stdout)
    } catch {
      parsed = null
    }
    if (!parsed || !Array.isArray(parsed.results)) {
      items.push(
        unknownItem(
          'legal',
          'docs/legal/*.md',
          `scripts/legal/checkLegalDocs.mjs の出力を解釈できなかった: ${res.stderr.trim().slice(0, 200)}`,
        ),
      )
    } else {
      for (const r of parsed.results) {
        const problems = [...r.errors, ...r.placeholders]
        items.push(
          r.ok && r.placeholders.length === 0
            ? {
                key: `legal:${r.file}`,
                label: r.file,
                status: 'ok',
                who: '—',
                action: '',
                detail: '施行日・運営者とも記載あり',
              }
            : {
                key: `legal:${r.file}`,
                label: r.file,
                status: 'blocker',
                who: 'オーナー（H10）',
                action: '施行日・運営者を確定して埋める、またはフォーマットの不備を直す',
                detail: problems.join(' / ') || 'ファイルが存在しない',
              },
        )
      }
    }
  } else {
    const legalDir = path.join(repoRoot, 'docs/legal')
    const legalFiles = (await readdir(legalDir).catch(() => [])).filter((f) => f.endsWith('.md'))
    if (legalFiles.length === 0) {
      items.push({
        key: 'legal',
        label: 'docs/legal/*.md',
        status: 'blocker',
        who: 'オーナー（H10）',
        action: '利用規約・プライバシーポリシー・通報ポリシーの文言を承認し掲載する',
        detail: 'docs/legal/ にファイルが無い',
      })
    } else {
      for (const file of legalFiles) {
        const text = await readTextFileOrNull(path.join(legalDir, file))
        const { issues } = checkLegalDocFields(text ?? '')
        items.push(
          issues.length === 0
            ? {
                key: `legal:${file}`,
                label: `docs/legal/${file}`,
                status: 'ok',
                who: '—',
                action: '',
                detail: '施行日・運営者とも記載あり',
              }
            : {
                key: `legal:${file}`,
                label: `docs/legal/${file}`,
                status: 'blocker',
                who: 'オーナー（H10）',
                action: '施行日・運営者を確定して埋める',
                detail: issues.join(' / '),
              },
        )
      }
    }
  }

  // docs/design.md §14.2 未決事項
  const designText = await readTextFileOrNull(path.join(repoRoot, 'docs/design.md'))
  if (designText === null) {
    items.push(
      unknownItem('undecided', 'design.md §14.2 未決事項', 'docs/design.md が見つからない'),
    )
  } else {
    items.push(...buildUndecidedItems(extractUndecidedItems(designText)))
  }

  // LINE 実機確認
  const lineRunbookPath = path.join(repoRoot, 'docs/runbooks/line-device-test.md')
  const lineText = await readTextFileOrNull(lineRunbookPath)
  if (lineText === null) {
    items.push({
      key: 'line',
      label: 'LINE 実機確認（H14）',
      status: 'blocker',
      who: 'オーナー（H14）',
      action:
        'iOS/Android の LINE 実機でカレンダーボタンと ics 取り込みを確認し、docs/runbooks/line-device-test.md に結果を残す',
      detail: 'runbook が無い',
    })
  } else {
    const { recorded, excerpt } = checkLineDeviceTestResult(lineText)
    items.push(
      recorded
        ? {
            key: 'line',
            label: 'LINE 実機確認（H14）',
            status: 'ok',
            who: '—',
            action: '',
            detail: excerpt,
          }
        : {
            key: 'line',
            label: 'LINE 実機確認（H14）',
            status: 'blocker',
            who: 'オーナー（H14）',
            action: 'iOS/Android の LINE 実機で確認し、結果欄に記入する',
            detail: '結果欄が未記入',
          },
    )
  }

  return items
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const json = argv.includes('--json')
  const idx = argv.indexOf('--repo-root')
  const repoRoot = idx >= 0 ? argv[idx + 1] : undefined
  return { json, repoRoot }
}

async function main() {
  const { json, repoRoot } = parseArgs(process.argv.slice(2))
  const items = await collectChecklistItems({ repoRoot })
  if (json) {
    console.log(JSON.stringify({ verdict: computeVerdict(items), items }, null, 2))
  } else {
    console.log(buildReport(items))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`予期しないエラー: ${err.message}`)
    process.exit(1)
  })
}
