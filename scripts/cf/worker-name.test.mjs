import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWorkerName } from './worker-name.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./worker-name.mjs', import.meta.url))

test('readWorkerName は最初の "name" の値を返す', () => {
  const text = `{
  // コメント
  "name": "calshare",
  "d1_databases": [{ "binding": "DB", "database_name": "calshare" }],
}`
  assert.equal(readWorkerName(text), 'calshare')
})

test('readWorkerName は "name" が無ければ null を返す', () => {
  assert.equal(readWorkerName('{ "main": "src/server/index.ts" }'), null)
})

test('CLI: --config のファイルから Worker 名を 1 行で出す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-name-'))
  const config = join(dir, 'wrangler.jsonc')
  writeFileSync(config, '{ "name": "renamed-service" }')
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--config', config], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  assert.equal(out, 'renamed-service\n')
})

test('CLI: "name" が無ければ失敗する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-name-'))
  const config = join(dir, 'wrangler.jsonc')
  writeFileSync(config, '{}')
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--config', config], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /"name" が見つかりません/)
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
