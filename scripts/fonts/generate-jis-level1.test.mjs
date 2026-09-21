import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs, generateJisLevel1Kanji, formatResult, run } from './generate-jis-level1.mjs'

test('parseArgs はオプションを読み取る', () => {
  assert.deepEqual(parseArgs([]), { out: null, dryRun: false, json: false, help: false })
  assert.deepEqual(parseArgs(['--out', 'a.txt', '--dry-run', '--json']), {
    out: 'a.txt',
    dryRun: true,
    json: true,
    help: false,
  })
})

test('parseArgs は不明な引数で例外を投げる', () => {
  assert.throws(() => parseArgs(['--nope']), /不明な引数です: --nope/)
})

test('generateJisLevel1Kanji は第1水準漢字を2965文字生成する', () => {
  const chars = generateJisLevel1Kanji()
  assert.equal(chars.length, 2965)
})

test('generateJisLevel1Kanji は第1水準の「亜」を含む', () => {
  assert.ok(generateJisLevel1Kanji().includes('亜'))
})

test('generateJisLevel1Kanji は第2水準の「弌」を含まない', () => {
  assert.ok(!generateJisLevel1Kanji().includes('弌'))
})

test('generateJisLevel1Kanji は重複を持たない', () => {
  const chars = generateJisLevel1Kanji()
  assert.equal(new Set(chars).size, chars.length)
})

test('generateJisLevel1Kanji は未割り当ての区点（置換文字）を除外する', () => {
  const decode = () => '�'
  assert.deepEqual(generateJisLevel1Kanji({ decode }), [])
})

test('formatResult は dry-run で件数だけを表示する', () => {
  assert.equal(formatResult({ out: null, dryRun: true, chars: ['亜', '愛'] }), '[dry-run] 件数: 2')
  assert.equal(
    formatResult({ out: 'x.txt', dryRun: true, chars: ['亜'] }),
    '[dry-run] 件数: 1 / 書き込み予定: x.txt',
  )
})

test('formatResult は out が無ければ文字を連結して返す', () => {
  assert.equal(formatResult({ out: null, dryRun: false, chars: ['亜', '愛'] }), '亜愛')
})

test('run は --out 指定時にファイルへ書き込む', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jis-level1-'))
  try {
    const out = path.join(dir, 'kanji.txt')
    const message = await run({ out, dryRun: false, json: false })
    assert.match(message, /2965 文字を書き込みました/)
    const written = await readFile(out, 'utf8')
    assert.equal([...written].length, 2965)
    assert.ok(written.includes('亜'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('run は --dry-run のとき書き込まない', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jis-level1-'))
  try {
    const out = path.join(dir, 'kanji.txt')
    let called = false
    await run({
      out,
      dryRun: true,
      json: false,
      writeFileImpl: async () => {
        called = true
      },
    })
    assert.equal(called, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('run は --json のとき件数を含む JSON を返す', async () => {
  const result = JSON.parse(await run({ out: null, dryRun: true, json: true }))
  assert.equal(result.count, 2965)
})

test('CLI: --help は使い方を表示する', async () => {
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const out = execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./generate-jis-level1.mjs', import.meta.url)), '--help'],
    { encoding: 'utf8' },
  )
  assert.match(out, /使い方/)
})
