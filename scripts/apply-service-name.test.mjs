import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  parseArgs,
  applyServiceName,
  transformReadme,
  transformDesignDoc,
  transformWranglerJsonc,
} from './apply-service-name.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./apply-service-name.mjs', import.meta.url))

test('parseArgs はオプションを読み取る', () => {
  const args = parseArgs(['--name', 'yoteitte', '--domain', 'yoteitte.com', '--dry-run'])
  assert.equal(args.name, 'yoteitte')
  assert.equal(args.domain, 'yoteitte.com')
  assert.equal(args.dryRun, true)
  assert.equal(args.oldName, 'calshare')
  assert.equal(args.oldDomain, 'calshare.example')
})

test('parseArgs は不明な引数で例外を投げる', () => {
  assert.throws(() => parseArgs(['--name', 'yoteitte', '--nope']), /不明な引数です: --nope/)
})

test('CLI: 不明な引数は使い方を添えてエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [SCRIPT_PATH, '--name', 'yoteitte', '--domain', 'yoteitte.com', '--dryrun'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    (err) => {
      assert.match(err.stderr, /不明な引数です: --dryrun/)
      assert.match(err.stderr, /使い方/)
      return true
    },
  )
})

test('CLI: --help は使い方を表示して正常終了する', () => {
  const out = execFileSync(process.execPath, [SCRIPT_PATH, '--help'], { encoding: 'utf8' })
  assert.match(out, /使い方/)
})

test('transformReadme は先頭見出しだけを書き換える', () => {
  const result = transformReadme('# calshare\n\n説明\n', { oldName: 'calshare', name: 'yoteitte' })
  assert.equal(result.content, '# yoteitte\n\n説明\n')
  assert.deepEqual(result.lines, [{ line: 1, before: '# calshare', after: '# yoteitte' }])
})

test('transformReadme は見出しが無ければ null', () => {
  assert.equal(transformReadme('見出しなし\n', { oldName: 'calshare', name: 'yoteitte' }), null)
})

test('transformDesignDoc は仮ドメインの全出現を置き換える', () => {
  const before = '仮値は `calshare.example` を使う。もう一箇所 calshare.example もある。'
  const result = transformDesignDoc(before, {
    oldDomain: 'calshare.example',
    domain: 'yoteitte.com',
  })
  assert.match(result.content, /yoteitte\.com/)
  assert.doesNotMatch(result.content, /calshare\.example/)
  assert.equal(result.lines.length, 1)
})

test('transformWranglerJsonc は name と SERVICE_NAME とドメインを書き換える', () => {
  const before =
    '{\n  "name": "calshare",\n  "vars": { "SERVICE_NAME": "calshare" },\n  "routes": [{ "pattern": "calshare.example/*" }]\n}\n'
  const result = transformWranglerJsonc(before, {
    oldName: 'calshare',
    name: 'yoteitte',
    oldDomain: 'calshare.example',
    domain: 'yoteitte.com',
  })
  assert.match(result.content, /"name": "yoteitte"/)
  assert.match(result.content, /"SERVICE_NAME": "yoteitte"/)
  assert.match(result.content, /yoteitte\.com\/\*/)
})

test('applyServiceName は存在するファイルだけ書き換える', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-service-name-'))
  try {
    await writeFile(path.join(dir, 'README.md'), '# calshare\n\n説明\n')
    await mkdir(path.join(dir, 'docs'))
    await writeFile(path.join(dir, 'docs', 'design.md'), '仮値は `calshare.example` を使う。\n')
    // wrangler.jsonc は作らない（アプリ本体の実装が未着手の状態を模す）

    const results = await applyServiceName({
      root: dir,
      name: 'yoteitte',
      domain: 'yoteitte.com',
      oldName: 'calshare',
      oldDomain: 'calshare.example',
      dryRun: false,
    })

    const byFile = Object.fromEntries(results.map((r) => [r.file, r]))
    assert.equal(byFile['README.md'].status, 'written')
    assert.equal(byFile['docs/design.md'].status, 'written')
    assert.equal(byFile['wrangler.jsonc'].status, 'skipped')

    assert.equal(await readFile(path.join(dir, 'README.md'), 'utf8'), '# yoteitte\n\n説明\n')
    assert.match(await readFile(path.join(dir, 'docs', 'design.md'), 'utf8'), /yoteitte\.com/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyServiceName は dry-run で書き込まない', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-service-name-'))
  try {
    await writeFile(path.join(dir, 'README.md'), '# calshare\n')
    const results = await applyServiceName({
      root: dir,
      name: 'yoteitte',
      domain: 'yoteitte.com',
      oldName: 'calshare',
      oldDomain: 'calshare.example',
      dryRun: true,
    })
    assert.equal(results[0].status, 'planned')
    assert.equal(await readFile(path.join(dir, 'README.md'), 'utf8'), '# calshare\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyServiceName は置き換え対象が無いファイルを unchanged にする', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-service-name-'))
  try {
    await writeFile(path.join(dir, 'README.md'), '見出しが違う\n')
    const results = await applyServiceName({
      root: dir,
      name: 'yoteitte',
      domain: 'yoteitte.com',
      oldName: 'calshare',
      oldDomain: 'calshare.example',
      dryRun: false,
    })
    assert.equal(results.find((r) => r.file === 'README.md').status, 'unchanged')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
