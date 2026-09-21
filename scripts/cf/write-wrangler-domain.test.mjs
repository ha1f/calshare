import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyDomainToWrangler, validateDomain, run } from './write-wrangler-domain.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./write-wrangler-domain.mjs', import.meta.url))

const SAMPLE = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "calshare",
  "workers_dev": true,
  "observability": { "enabled": true },
  "vars": { "PUBLIC_ORIGIN": "http://localhost:8787", "SERVICE_NAME": "calshare" }
}
`

test('validateDomain はホスト名だけを受け付ける', () => {
  assert.equal(validateDomain('example.com'), 'example.com')
  assert.equal(validateDomain('sub.example.co.jp'), 'sub.example.co.jp')
  assert.throws(() => validateDomain('example.com/*'), /ドメイン形式が不正/)
  assert.throws(() => validateDomain('*.example.com'), /ドメイン形式が不正/)
  assert.throws(() => validateDomain('example.com/path'), /ドメイン形式が不正/)
  assert.throws(() => validateDomain(''), /ドメイン形式が不正/)
  assert.throws(() => validateDomain(undefined), /ドメイン形式が不正/)
})

test('applyDomainToWrangler は workers_dev を false にし routes を追加する', () => {
  const { content, changed } = applyDomainToWrangler(SAMPLE, 'example.com')
  assert.equal(changed, true)
  assert.match(content, /"workers_dev": false/)
  assert.match(content, /"routes": \[\{ "pattern": "example\.com", "custom_domain": true \}\]/)
  // パス・ワイルドカードを含まないこと（docs/runbooks/custom-domain.md の blocker 修正）
  assert.doesNotMatch(content, /example\.com\/\*/)
  assert.doesNotMatch(content, /PUBLIC_ORIGIN.*example\.com/)
})

test('routes が既にあれば書き換えない', () => {
  const withRoutes = SAMPLE.replace(
    '"workers_dev": true,',
    '"workers_dev": false,\n  "routes": [{ "pattern": "old.example.com", "custom_domain": true }],',
  )
  const { content, changed, reason } = applyDomainToWrangler(withRoutes, 'example.com')
  assert.equal(changed, false)
  assert.equal(content, withRoutes)
  assert.match(reason, /既に設定されています/)
})

test('workers_dev が無い形式なら理由付きで変更しない', () => {
  const { changed, reason } = applyDomainToWrangler('{ "name": "calshare" }', 'example.com')
  assert.equal(changed, false)
  assert.match(reason, /workers_dev.*見つかりません/)
})

test('run はファイルが無ければ何もしない', () => {
  const result = run({
    path: '/tmp/does-not-exist-wrangler.jsonc',
    domain: 'example.com',
    dryRun: false,
  })
  assert.equal(result.applied, false)
  assert.match(result.reason, /存在しません/)
})

test('run は dry-run のとき書き込まない', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-domain-'))
  const path = join(dir, 'wrangler.jsonc')
  writeFileSync(path, SAMPLE)
  const result = run({ path, domain: 'example.com', dryRun: true })
  assert.equal(result.applied, false)
  assert.equal(result.wouldApply, true)
  assert.equal(readFileSync(path, 'utf8'), SAMPLE)
  rmSync(dir, { recursive: true })
})

test('run は実行するとファイルに書き込む', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrangler-domain-'))
  const path = join(dir, 'wrangler.jsonc')
  writeFileSync(path, SAMPLE)
  const result = run({ path, domain: 'example.com', dryRun: false })
  assert.equal(result.applied, true)
  assert.match(readFileSync(path, 'utf8'), /"custom_domain": true/)
  rmSync(dir, { recursive: true })
})

test('CLI: --domain 無しは分かりやすいエラーで終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /--domain は必須/)
      return true
    },
  )
})

test('CLI: 不正なドメインはエラーで終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--domain', 'example.com/*', '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /ドメイン形式が不正/)
      return true
    },
  )
})

test('CLI: --help は使い方を表示して正常終了する', () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(out, /使い方/)
})
