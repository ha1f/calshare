import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { downloadNotoSansJp, parseArgs } from './download-noto-sans-jp.mjs'
import { buildZip } from './testZipFixture.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./download-noto-sans-jp.mjs', import.meta.url))

const FONT_BYTES = Buffer.from('fake-otf-bytes-for-test')
const LICENSE_BYTES = Buffer.from('SIL Open Font License 1.1 (test fixture)')

function fakeZip() {
  return buildZip([
    { name: 'NotoSansJP-Regular.otf', content: FONT_BYTES, method: 0 },
    { name: 'LICENSE', content: LICENSE_BYTES, method: 8 },
  ])
}

test('parseArgs は --out --dry-run --json --help を読み取る', () => {
  assert.deepEqual(parseArgs(['--out', '/tmp/x', '--dry-run', '--json']), {
    out: '/tmp/x',
    dryRun: true,
    json: true,
    help: false,
  })
  assert.equal(parseArgs(['--help']).help, true)
})

test('parseArgs は不明な引数で例外を投げる', () => {
  assert.throws(() => parseArgs(['--dryrun']), /不明な引数です: --dryrun/)
})

test('CLI: 不明な引数は使い方を添えてエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--dryrun'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /不明な引数です: --dryrun/)
      assert.match(err.stderr, /使い方/)
      return true
    },
  )
})

test('downloadNotoSansJp は dry-run でネットワークにも書き込みにもアクセスしない', async () => {
  let fetchCalled = false
  let mkdirCalled = false
  let writeCalled = false
  const result = await downloadNotoSansJp({
    out: '.claude/tmp/fonts',
    dryRun: true,
    fetchImpl: async () => {
      fetchCalled = true
      throw new Error('呼ばれてはいけない')
    },
    mkdirImpl: async () => {
      mkdirCalled = true
    },
    writeFileImpl: async () => {
      writeCalled = true
    },
  })
  assert.equal(fetchCalled, false)
  assert.equal(mkdirCalled, false)
  assert.equal(writeCalled, false)
  assert.equal(result.dryRun, true)
  assert.deepEqual(result.plannedFiles, [
    path.join('.claude/tmp/fonts', 'NotoSansJP-Regular.otf'),
    path.join('.claude/tmp/fonts', 'LICENSE.txt'),
  ])
})

test('downloadNotoSansJp は zip を展開してフォントとライセンスを保存する', async () => {
  const written = {}
  const zip = fakeZip()
  const result = await downloadNotoSansJp({
    out: '/virtual/out',
    dryRun: false,
    fetchImpl: async (url) => {
      assert.match(url, /notofonts\/noto-cjk/)
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      }
    },
    mkdirImpl: async () => {},
    writeFileImpl: async (p, content) => {
      written[p] = content
    },
  })

  const regularPath = path.join('/virtual/out', 'NotoSansJP-Regular.otf')
  const licensePath = path.join('/virtual/out', 'LICENSE.txt')
  assert.deepEqual(written[regularPath], FONT_BYTES)
  assert.deepEqual(written[licensePath], LICENSE_BYTES)

  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]))
  assert.equal(
    byPath[regularPath].sha256,
    crypto.createHash('sha256').update(FONT_BYTES).digest('hex'),
  )
  assert.equal(
    byPath[licensePath].sha256,
    crypto.createHash('sha256').update(LICENSE_BYTES).digest('hex'),
  )
})

test('downloadNotoSansJp は HTTP エラーで分かりやすい例外を投げる', async () => {
  await assert.rejects(
    downloadNotoSansJp({
      out: '/virtual/out',
      fetchImpl: async () => ({ ok: false, status: 404 }),
    }),
    /HTTP 404/,
  )
})
