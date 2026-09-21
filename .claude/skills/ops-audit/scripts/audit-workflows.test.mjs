import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractRunBlocks,
  auditWorkflowText,
  auditWorkflowsDir,
  formatReport,
} from './audit-workflows.mjs'

test('extractRunBlocks はインラインの run: を1行として拾う', () => {
  const lines = ['    - run: echo hi']
  const blocks = extractRunBlocks(lines)
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0].lines, [{ lineNumber: 1, text: 'echo hi' }])
})

test('extractRunBlocks はブロックスタイルの run: を、インデントが戻るまで拾う', () => {
  const lines = ['  - run: |', '      echo one', '      echo two', '  - uses: actions/checkout@v4']
  const blocks = extractRunBlocks(lines)
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0].lines, [
    { lineNumber: 2, text: '      echo one' },
    { lineNumber: 3, text: '      echo two' },
  ])
})

test('auditWorkflowText は permissions が無いファイルを high で指摘する', () => {
  const findings = auditWorkflowText(
    'name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
  )
  assert.ok(findings.some((f) => f.category === 'permissions' && f.severity === 'high'))
})

test('auditWorkflowText は permissions があれば permissions の指摘を出さない', () => {
  const findings = auditWorkflowText(
    'permissions:\n  contents: read\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
  )
  assert.ok(!findings.some((f) => f.category === 'permissions'))
})

test('auditWorkflowText は run: 内の github.event.* の直接展開を指摘する', () => {
  const text = [
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    steps:',
    '      - run: echo "${{ github.event.issue.title }}"',
  ].join('\n')
  const findings = auditWorkflowText(text)
  const hit = findings.find((f) => f.category === 'injection')
  assert.ok(hit, 'injection の指摘が無い')
  assert.equal(hit.line, 6)
})

test('auditWorkflowText は env 経由で受けている場合は指摘しない（run: 行自体に ${{ }} が無いため）', () => {
  const text = [
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    steps:',
    '      - env:',
    '          TITLE: ${{ github.event.issue.title }}',
    '        run: echo "$TITLE"',
  ].join('\n')
  const findings = auditWorkflowText(text)
  assert.ok(!findings.some((f) => f.category === 'injection'))
})

test('auditWorkflowText は set -x と echo secrets.* を指摘する', () => {
  const text = [
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    steps:',
    '      - run: |',
    '          set -x',
    '          echo "${{ secrets.TOKEN }}"',
  ].join('\n')
  const findings = auditWorkflowText(text)
  assert.ok(findings.some((f) => f.category === 'secret-logging' && /set -x/.test(f.message)))
  assert.ok(findings.some((f) => f.category === 'secret-logging' && /echo/.test(f.message)))
})

test('auditWorkflowText は SHA 固定でない uses: を指摘し、SHA 固定なら指摘しない', () => {
  const text = [
    'permissions:',
    '  contents: read',
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: some-org/some-action@main',
    '      - uses: actions/checkout@8f4b7f84864484a7bde6ce1d2fb5aad35e6b3ce7',
  ].join('\n')
  const findings = auditWorkflowText(text).filter((f) => f.category === 'unpinned-action')
  assert.equal(findings.length, 2)
  assert.equal(findings[0].severity, 'medium') // actions/* は trusted 扱い
  assert.equal(findings[1].severity, 'high') // サードパーティは high
})

test('auditWorkflowText はバージョン指定の無い uses: を指摘する', () => {
  const findings = auditWorkflowText(
    'permissions:\n  contents: read\njobs:\n  build:\n    steps:\n      - uses: actions/checkout\n',
  )
  assert.ok(
    findings.some((f) => f.category === 'unpinned-action' && /バージョン指定/.test(f.message)),
  )
})

test('auditWorkflowsDir はディレクトリが無ければ exists:false を返す', () => {
  const result = auditWorkflowsDir('/path/does/not/exist-xyz')
  assert.deepEqual(result, { dir: '/path/does/not/exist-xyz', exists: false, files: [] })
})

test('formatReport はディレクトリが無いとき、該当なしの文言を返す', () => {
  const text = formatReport({ dir: '.github/workflows', exists: false, files: [] })
  assert.match(text, /存在しない/)
})

test('formatReport は指摘を file:line 形式で並べる', () => {
  const text = formatReport({
    dir: '.github/workflows',
    exists: true,
    files: [
      {
        path: '.github/workflows/ci.yml',
        findings: [{ line: 3, severity: 'high', category: 'permissions', message: 'x' }],
      },
    ],
  })
  assert.equal(text, '.github/workflows/ci.yml:3 [high/permissions] x')
})
