import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(new URL('./set-github-secrets.sh', import.meta.url))

test('CLI: --help は gh が無くても使い方を表示して正常終了する', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.match(out, /使い方/)
})

test('CLI: --dry-run は gh を呼ばずに登録予定の Secret 名を表示する', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--dry-run'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH },
  })
  assert.match(out, /CLOUDFLARE_API_TOKEN/)
  assert.match(out, /CLOUDFLARE_ACCOUNT_ID/)
  assert.match(out, /REPORT_WEBHOOK_URL/)
})

test('CLI: 不明な引数は使い方を添えてエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync('bash', [SCRIPT_PATH, '--nope'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /不明な引数/)
      return true
    },
  )
})
