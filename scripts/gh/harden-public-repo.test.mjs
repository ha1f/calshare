import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(new URL('./harden-public-repo.sh', import.meta.url))

test('CLI: --help は gh が無くても使い方を表示して正常終了する', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin' },
  })
  assert.match(out, /使い方/)
})

test('CLI: --repo が無いとエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync('bash', [SCRIPT_PATH, '--dry-run'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /--repo は必須です/)
      return true
    },
  )
})

test('CLI: --repo が owner/repo 形式でないとエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync('bash', [SCRIPT_PATH, '--dry-run', '--repo', 'calshare'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /owner\/repo 形式で指定してください/)
      return true
    },
  )
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

test('CLI: --dry-run は gh を呼ばず、期待する API 呼び出しがすべて並ぶ', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--dry-run', '--repo', 'ha1f/calshare'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // gh コマンド自体が無い環境でも --dry-run は完走できることを確認する
    env: { PATH: '/usr/bin:/bin' },
  })

  assert.match(out, /PUT repos\/ha1f\/calshare\/vulnerability-alerts/)
  assert.match(out, /PUT repos\/ha1f\/calshare\/automated-security-fixes/)
  assert.match(out, /PATCH repos\/ha1f\/calshare — secret scanning と push protection/)
  assert.match(out, /PUT repos\/ha1f\/calshare\/private-vulnerability-reporting/)
  assert.match(out, /PUT repos\/ha1f\/calshare\/branches\/main\/protection/)
  assert.match(out, /GET repos\/ha1f\/calshare\/actions\/permissions\/workflow/)
  assert.match(out, /GET repos\/ha1f\/calshare\/actions\/permissions\/fork-pr-contributor-approval/)

  // fork PR の承認設定は確認のみで、dry-run でも PUT が計画に含まれないこと
  assert.doesNotMatch(
    out,
    /PUT repos\/ha1f\/calshare\/actions\/permissions\/fork-pr-contributor-approval/,
  )
})
