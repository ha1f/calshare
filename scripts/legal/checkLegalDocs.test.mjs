import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  checkLegalDocText,
  checkAllLegalDocs,
  findPlaceholders,
  isReleaseReady,
  parseArgs,
} from './checkLegalDocs.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./checkLegalDocs.mjs', import.meta.url))

const VALID_DOC = `# サンプル

施行日: 2026-10-01
運営者: calshare運営事務局

## 第1条（目的）

本文。

## 第2条（禁止事項）

本文。

---

## 変更履歴

| 日付 | 変更内容 |
|---|---|
| 2026-10-01 | 初版作成 |
`

test('checkLegalDocText は正しい文書に対してエラーを返さない', () => {
  assert.deepEqual(checkLegalDocText(VALID_DOC), [])
})

test('checkLegalDocText は施行日の行が無ければエラーを返す', () => {
  const text = VALID_DOC.replace('施行日: 2026-10-01\n', '')
  assert.ok(checkLegalDocText(text).some((e) => e.includes('施行日')))
})

test('checkLegalDocText は運営者の行が無ければエラーを返す', () => {
  const text = VALID_DOC.replace('運営者: calshare運営事務局\n', '')
  assert.ok(checkLegalDocText(text).some((e) => e.includes('運営者')))
})

test('checkLegalDocText は条番号が連番でなければエラーを返す', () => {
  const text = VALID_DOC.replace('## 第2条（禁止事項）', '## 第3条（禁止事項）')
  assert.ok(checkLegalDocText(text).some((e) => e.includes('連番')))
})

test('checkLegalDocText は条文が1つも無ければエラーを返す', () => {
  const text = VALID_DOC.replace(/## 第1条.*\n\n本文。\n\n/, '').replace(
    /## 第2条.*\n\n本文。\n\n/,
    '',
  )
  assert.ok(checkLegalDocText(text).some((e) => e.includes('条文見出し')))
})

test('checkLegalDocText は変更履歴の見出しが無ければエラーを返す', () => {
  const text = VALID_DOC.slice(0, VALID_DOC.indexOf('---'))
  assert.ok(checkLegalDocText(text).some((e) => e.includes('変更履歴')))
})

test('checkLegalDocText は変更履歴の表に必要な列が無ければエラーを返す', () => {
  const text = VALID_DOC.replace(
    '| 日付 | 変更内容 |\n|---|---|\n| 2026-10-01 | 初版作成 |\n',
    '（表なし）\n',
  )
  assert.ok(checkLegalDocText(text).some((e) => e.includes('日付') && e.includes('変更内容')))
})

test('checkAllLegalDocs はファイルが存在しない場合にエラーを返す', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'calshare-legal-'))
  try {
    const results = await checkAllLegalDocs(dir, ['docs/legal/missing.md'])
    assert.equal(results.length, 1)
    assert.equal(results[0].ok, false)
    assert.ok(results[0].errors.some((e) => e.includes('存在しない')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('checkAllLegalDocs は正しいファイル群に対してすべて ok を返す', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'calshare-legal-'))
  try {
    const rel = 'docs/legal/terms.md'
    await writeFileWithDirs(dir, rel, VALID_DOC)
    const results = await checkAllLegalDocs(dir, [rel])
    assert.deepEqual(results, [{ file: rel, ok: true, errors: [], placeholders: [] }])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('findPlaceholders は「（オーナーが記入」を含む未記入行を検出する', () => {
  const text = '施行日: （オーナーが記入。例: 2026-10-01）\n本文\n'
  const found = findPlaceholders(text)
  assert.equal(found.length, 1)
  assert.match(found[0], /1行目/)
  assert.match(found[0], /オーナーが記入/)
})

test('findPlaceholders は変更履歴の「（記入）」を検出する', () => {
  const text = '| 日付 | 変更内容 |\n|---|---|\n| （記入） | 初版作成 |\n'
  const found = findPlaceholders(text)
  assert.equal(found.length, 1)
  assert.match(found[0], /3行目/)
})

test('findPlaceholders はプレースホルダが無ければ空配列を返す', () => {
  assert.deepEqual(findPlaceholders(VALID_DOC), [])
})

test('checkAllLegalDocs は未記入のプレースホルダを placeholders に含める', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'calshare-legal-'))
  try {
    const rel = 'docs/legal/terms.md'
    const text = VALID_DOC.replace(
      '施行日: 2026-10-01',
      '施行日: （オーナーが記入。例: 2026-10-01）',
    )
    await writeFileWithDirs(dir, rel, text)
    const results = await checkAllLegalDocs(dir, [rel])
    assert.equal(results[0].ok, true, 'プレースホルダの残存はフォーマット検査には影響しない')
    assert.equal(results[0].placeholders.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('isReleaseReady は既定ではプレースホルダの残存を許容する', () => {
  const results = [{ file: 'a.md', ok: true, errors: [], placeholders: ['1行目: …'] }]
  assert.equal(isReleaseReady(results, { strict: false }), true)
})

test('isReleaseReady は strict のときプレースホルダの残存で false を返す', () => {
  const results = [{ file: 'a.md', ok: true, errors: [], placeholders: ['1行目: …'] }]
  assert.equal(isReleaseReady(results, { strict: true }), false)
})

test('isReleaseReady は strict でもプレースホルダが無ければ true を返す', () => {
  const results = [{ file: 'a.md', ok: true, errors: [], placeholders: [] }]
  assert.equal(isReleaseReady(results, { strict: true }), true)
})

test('isReleaseReady はフォーマットエラーがあれば strict でなくても false を返す', () => {
  const results = [{ file: 'a.md', ok: false, errors: ['何か'], placeholders: [] }]
  assert.equal(isReleaseReady(results, { strict: false }), false)
})

test('parseArgs は --strict --help --json を読み取る', () => {
  assert.deepEqual(parseArgs(['--strict']), { strict: true, help: false, json: false })
  assert.deepEqual(parseArgs([]), { strict: false, help: false, json: false })
})

test('parseArgs は不明な引数で例外を投げる', () => {
  assert.throws(() => parseArgs(['--strcit']), /不明な引数です: --strcit/)
})

test('CLI: 不明な引数はエラー終了する（打ち間違いで検査が通ったように見えない）', () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, [SCRIPT_PATH, '--strcit'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    (err) => {
      assert.match(err.stderr, /不明な引数です: --strcit/)
      return true
    },
  )
})

async function writeFileWithDirs(root, relPath, content) {
  const abs = path.join(root, relPath)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}
