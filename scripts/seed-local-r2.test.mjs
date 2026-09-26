import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { formatResult, parseArgs, seedLocalR2 } from './seed-local-r2.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./seed-local-r2.mjs', import.meta.url))

test('parseArgs は --font --dry-run --json --help を読み取り、既定のフォントパスを持つ', () => {
  assert.deepEqual(parseArgs([]), {
    font: 'test/fixtures/fonts/NotoSansJP-Regular.subset.otf',
    dryRun: false,
    json: false,
    help: false,
  })
  assert.deepEqual(parseArgs(['--font', '/tmp/x.otf', '--dry-run', '--json']), {
    font: '/tmp/x.otf',
    dryRun: true,
    json: true,
    help: false,
  })
})

test('parseArgs は不明な引数で例外を投げる', () => {
  assert.throws(() => parseArgs(['--nope']), /不明な引数です: --nope/)
})

test('seedLocalR2 はフォントが無ければ例外を投げ、wrangler を呼ばない', () => {
  let called = false
  assert.throws(
    () =>
      seedLocalR2({
        font: '/no/such/font.otf',
        execFileImpl: () => {
          called = true
        },
        existsImpl: () => false,
      }),
    /フォントが見つかりません/,
  )
  assert.equal(called, false)
})

test('seedLocalR2 は wrangler r2 object put --local を正しい引数で呼ぶ', () => {
  const calls = []
  const result = seedLocalR2({
    font: 'test/fixtures/fonts/NotoSansJP-Regular.subset.otf',
    execFileImpl: (cmd, args) => calls.push([cmd, args]),
    existsImpl: () => true,
  })

  assert.deepEqual(calls, [
    [
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        'calshare/fonts/NotoSansJP-Regular.subset.otf',
        '--local',
        '--file',
        'test/fixtures/fonts/NotoSansJP-Regular.subset.otf',
      ],
    ],
  ])
  assert.equal(result.dryRun, false)
  assert.equal(result.bucket, 'calshare')
  assert.equal(result.key, 'fonts/NotoSansJP-Regular.subset.otf')
})

test('seedLocalR2 は --dry-run で wrangler を呼ばない', () => {
  let called = false
  const result = seedLocalR2({
    font: 'test/fixtures/fonts/NotoSansJP-Regular.subset.otf',
    dryRun: true,
    execFileImpl: () => {
      called = true
    },
    existsImpl: () => true,
  })
  assert.equal(called, false)
  assert.equal(result.dryRun, true)
})

test('formatResult は dry-run とそうでない場合で文言を変える', () => {
  const base = { bucket: 'calshare', key: 'fonts/x.otf', font: 'test/fixtures/fonts/x.otf' }
  assert.match(formatResult({ ...base, dryRun: true }), /^\[dry-run\]/)
  assert.doesNotMatch(formatResult({ ...base, dryRun: false }), /^\[dry-run\]/)
})

test('CLI: 不明な引数は使い方を添えてエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--nope'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /不明な引数です: --nope/)
      assert.match(err.stderr, /使い方/)
      return true
    },
  )
})

test('CLI: --dry-run --json はフォントを投入せず投入予定を JSON で表示する', () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--dry-run', '--json'], {
    encoding: 'utf8',
  })
  const result = JSON.parse(out)
  assert.equal(result.dryRun, true)
  assert.equal(result.bucket, 'calshare')
})
