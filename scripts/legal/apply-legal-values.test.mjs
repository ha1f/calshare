import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  parseArgs,
  transformEffectiveDate,
  transformOperator,
  transformCourt,
  transformChangelog,
  applyLegalValues,
} from './apply-legal-values.mjs'
import { checkAllLegalDocs, isReleaseReady } from './checkLegalDocs.mjs'

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..')
const LEGAL_FILES = ['docs/legal/terms.md', 'docs/legal/privacy.md', 'docs/legal/report-policy.md']

test('parseArgs はオプションを読み取る', () => {
  const args = parseArgs([
    '--effective-date',
    '2026-10-01',
    '--operator',
    'calshare運営事務局',
    '--court',
    '東京地方裁判所',
    '--dry-run',
  ])
  assert.equal(args.effectiveDate, '2026-10-01')
  assert.equal(args.operator, 'calshare運営事務局')
  assert.equal(args.court, '東京地方裁判所')
  assert.equal(args.dryRun, true)
})

test('transformEffectiveDate は施行日の行を書き換える', () => {
  const result = transformEffectiveDate('施行日: （オーナーが記入。例: 2026-10-01）\n本文\n', {
    effectiveDate: '2026-10-01',
  })
  assert.equal(result.content, '施行日: 2026-10-01\n本文\n')
})

test('transformEffectiveDate は施行日の行が無ければ null', () => {
  assert.equal(transformEffectiveDate('本文のみ\n', { effectiveDate: '2026-10-01' }), null)
})

test('transformOperator は運営者の行を書き換える', () => {
  const result = transformOperator('運営者: （オーナーが記入。屋号表記でも可）\n', {
    operator: 'calshare運営事務局',
  })
  assert.equal(result.content, '運営者: calshare運営事務局\n')
})

test('transformCourt は管轄裁判所のプレースホルダを書き換える', () => {
  const before =
    '2. 紛争が生じた場合には、（オーナーが記入。例: ○○地方裁判所）を第一審の専属的合意管轄裁判所とします。\n'
  const result = transformCourt(before, { court: '東京地方裁判所' })
  assert.equal(
    result.content,
    '2. 紛争が生じた場合には、東京地方裁判所を第一審の専属的合意管轄裁判所とします。\n',
  )
})

test('transformCourt はプレースホルダが無ければ null', () => {
  assert.equal(transformCourt('裁判所の記載なし\n', { court: '東京地方裁判所' }), null)
})

test('transformChangelog は変更履歴の「（記入）」を施行日に置き換える', () => {
  const before = '| 日付 | 変更内容 |\n|---|---|\n| （記入） | 初版作成 |\n'
  const result = transformChangelog(before, { effectiveDate: '2026-10-01' })
  assert.equal(result.content, '| 日付 | 変更内容 |\n|---|---|\n| 2026-10-01 | 初版作成 |\n')
})

test('transformChangelog は「（記入）」が無ければ改定行を1行追加する', () => {
  const before = '## 変更履歴\n\n| 日付 | 変更内容 |\n|---|---|\n| 2026-10-01 | 初版作成 |\n'
  const result = transformChangelog(before, { effectiveDate: '2026-11-01' })
  assert.match(result.content, /\| 2026-10-01 \| 初版作成 \|\n\| 2026-11-01 \| 改定 \|\n/)
})

test('transformChangelog は同じ日付の行が既にあれば追加しない（二重実行対策）', () => {
  const before = '## 変更履歴\n\n| 日付 | 変更内容 |\n|---|---|\n| 2026-10-01 | 初版作成 |\n'
  assert.equal(transformChangelog(before, { effectiveDate: '2026-10-01' }), null)
})

test('applyLegalValues は3文書のプレースホルダを一括で置き換える', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-legal-values-'))
  try {
    await writeDoc(
      dir,
      'docs/legal/terms.md',
      [
        '施行日: （オーナーが記入。例: 2026-10-01）',
        '運営者: （オーナーが記入）',
        '',
        '## 第17条（準拠法・管轄裁判所）',
        '',
        '2. 紛争が生じた場合には、（オーナーが記入。例: ○○地方裁判所）を第一審の専属的合意管轄裁判所とします。',
        '',
        '## 変更履歴',
        '',
        '| 日付 | 変更内容 |',
        '|---|---|',
        '| （記入） | 初版作成 |',
        '',
      ].join('\n'),
    )
    await writeDoc(
      dir,
      'docs/legal/privacy.md',
      [
        '施行日: （オーナーが記入。例: 2026-10-01）',
        '運営者: （オーナーが記入）',
        '',
        '## 変更履歴',
        '',
        '| 日付 | 変更内容 |',
        '|---|---|',
        '| （記入） | 初版作成 |',
        '',
      ].join('\n'),
    )
    // report-policy.md は作らない（存在しないファイルは skip されることを確認する）

    const results = await applyLegalValues({
      root: dir,
      effectiveDate: '2026-10-01',
      operator: 'calshare運営事務局',
      court: '東京地方裁判所',
      dryRun: false,
    })

    const byFile = Object.fromEntries(results.map((r) => [r.file, r]))
    assert.equal(byFile['docs/legal/terms.md'].status, 'written')
    assert.equal(byFile['docs/legal/privacy.md'].status, 'written')
    assert.equal(byFile['docs/legal/report-policy.md'].status, 'skipped')

    const terms = await readFile(path.join(dir, 'docs/legal/terms.md'), 'utf8')
    assert.match(terms, /施行日: 2026-10-01/)
    assert.match(terms, /運営者: calshare運営事務局/)
    assert.match(terms, /東京地方裁判所を第一審の専属的合意管轄裁判所とします/)
    assert.match(terms, /\| 2026-10-01 \| 初版作成 \|/)
    assert.doesNotMatch(terms, /オーナーが記入/)
    assert.doesNotMatch(terms, /（記入）/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyLegalValues は dry-run で書き込まない', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-legal-values-'))
  try {
    await writeDoc(dir, 'docs/legal/terms.md', '施行日: （オーナーが記入。例: 2026-10-01）\n')
    const results = await applyLegalValues({
      root: dir,
      effectiveDate: '2026-10-01',
      operator: 'calshare運営事務局',
      court: '東京地方裁判所',
      dryRun: true,
    })
    assert.equal(results.find((r) => r.file === 'docs/legal/terms.md').status, 'planned')
    assert.equal(
      await readFile(path.join(dir, 'docs/legal/terms.md'), 'utf8'),
      '施行日: （オーナーが記入。例: 2026-10-01）\n',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('実際の docs/legal/*.md に適用すると checkLegalDocs --strict 相当の検査を通過する', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'apply-legal-values-real-'))
  try {
    for (const rel of LEGAL_FILES) {
      const content = await readFile(path.join(REPO_ROOT, rel), 'utf8')
      await writeDoc(dir, rel, content)
    }

    await applyLegalValues({
      root: dir,
      effectiveDate: '2026-10-01',
      operator: 'calshare運営事務局',
      court: '東京地方裁判所',
      dryRun: false,
    })

    const results = await checkAllLegalDocs(dir, LEGAL_FILES)
    for (const r of results) {
      assert.deepEqual(r.placeholders, [], `${r.file} にプレースホルダが残っている`)
    }
    assert.equal(isReleaseReady(results, { strict: true }), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function writeDoc(root, relPath, content) {
  const abs = path.join(root, relPath)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}
