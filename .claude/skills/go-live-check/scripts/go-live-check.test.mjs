import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir as mkdirRaw, writeFile as writeFileRaw, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  stripJsonComments,
  parseWranglerJsonc,
  analyzeWranglerConfig,
  parseGhSecretList,
  parseGhVariableList,
  buildSecretItems,
  buildCiItem,
  buildVariableItems,
  findFieldValue,
  looksLikePlaceholder,
  checkLegalDocFields,
  checkLineDeviceTestResult,
  extractUndecidedItems,
  buildUndecidedItems,
  computeVerdict,
  buildReport,
  collectChecklistItems,
} from './go-live-check.mjs'

// --- stripJsonComments / parseWranglerJsonc -------------------------------

test('stripJsonComments は行コメントだけを取り除き文字列中の // は残す', () => {
  const input = [
    '{',
    '  "a": 1, // コメント',
    '  "url": "http://example.com" // 別のコメント',
    '}',
  ].join('\n')
  const stripped = stripJsonComments(input)
  assert.match(stripped, /"url": "http:\/\/example\.com"/)
  assert.doesNotMatch(stripped, /コメント/)
})

test('stripJsonComments はブロックコメント /* */ を取り除き文字列中の /* */ は残す', () => {
  const input = [
    '{',
    '  /* これはコメント */',
    '  "a": 1,',
    '  "url": "http://example.com/*not-a-comment*/"',
    '}',
  ].join('\n')
  const stripped = stripJsonComments(input)
  assert.doesNotMatch(stripped, /これはコメント/)
  assert.match(stripped, /"url": "http:\/\/example\.com\/\*not-a-comment\*\/"/)
})

test('parseWranglerJsonc は末尾カンマがあってもパースできる', () => {
  const text = ['{', '  "workers_dev": true,', '  "routes": [1, 2,],', '}'].join('\n')
  const config = parseWranglerJsonc(text)
  assert.equal(config.workers_dev, true)
  assert.deepEqual(config.routes, [1, 2])
})

test('parseWranglerJsonc は design.md §11.7 相当のコメント付き wrangler.jsonc をパースできる', () => {
  const text = [
    '{',
    '  "name": "calshare",',
    '  "workers_dev": true, // H3 でカスタムドメインを割り当てたら false',
    '  "d1_databases": [',
    '    { "binding": "DB", "database_id": "00000000-0000-0000-0000-000000000000" } // H4 で置換',
    '  ],',
    '  "vars": { "PUBLIC_ORIGIN": "http://localhost:8787" }',
    '}',
  ].join('\n')
  const config = parseWranglerJsonc(text)
  assert.equal(config.name, 'calshare')
  assert.equal(config.workers_dev, true)
})

// --- analyzeWranglerConfig -------------------------------------------------

test('analyzeWranglerConfig はプレースホルダの database_id を検出する', () => {
  const result = analyzeWranglerConfig({
    d1_databases: [{ database_id: '00000000-0000-0000-0000-000000000000' }],
  })
  assert.equal(result.databaseIdIsPlaceholder, true)
})

test('analyzeWranglerConfig は本物の database_id を検出しない', () => {
  const result = analyzeWranglerConfig({
    d1_databases: [{ database_id: 'a1b2c3d4-e5f6-4a5b-8c9d-000000000001' }],
  })
  assert.equal(result.databaseIdIsPlaceholder, false)
})

test('analyzeWranglerConfig は d1_databases が無くてもプレースホルダ扱いにする（未設定＝ブロッカー）', () => {
  const result = analyzeWranglerConfig({})
  assert.equal(result.databaseIdIsPlaceholder, true)
  assert.equal(result.databaseId, null)
})

test('analyzeWranglerConfig は workers_dev が明示的に false のときだけ false を返す', () => {
  assert.equal(analyzeWranglerConfig({ workers_dev: false }).workersDevEnabled, false)
  assert.equal(analyzeWranglerConfig({ workers_dev: true }).workersDevEnabled, true)
  assert.equal(analyzeWranglerConfig({}).workersDevEnabled, true)
})

test('analyzeWranglerConfig は localhost / .example の PUBLIC_ORIGIN を仮値として検出する', () => {
  assert.equal(
    analyzeWranglerConfig({ vars: { PUBLIC_ORIGIN: 'http://localhost:8787' } })
      .publicOriginLooksLocalOrPlaceholder,
    true,
  )
  assert.equal(
    analyzeWranglerConfig({ vars: { PUBLIC_ORIGIN: 'https://calshare.example' } })
      .publicOriginLooksLocalOrPlaceholder,
    true,
  )
  assert.equal(
    analyzeWranglerConfig({ vars: { PUBLIC_ORIGIN: 'https://calshare.jp' } })
      .publicOriginLooksLocalOrPlaceholder,
    false,
  )
})

test('analyzeWranglerConfig は routes 設定の有無を返す', () => {
  assert.equal(analyzeWranglerConfig({}).hasRoutes, false)
  assert.equal(analyzeWranglerConfig({ routes: [] }).hasRoutes, false)
  assert.equal(analyzeWranglerConfig({ routes: [{ pattern: 'calshare.jp/*' }] }).hasRoutes, true)
})

// --- gh 出力パース -----------------------------------------------------------

test('parseGhSecretList はタブ区切りの1列目だけを名前として取る', () => {
  const stdout =
    'CLOUDFLARE_API_TOKEN\t2024-01-01T00:00:00Z\nCLOUDFLARE_ACCOUNT_ID\t2024-01-02T00:00:00Z\n'
  assert.deepEqual(parseGhSecretList(stdout), ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])
})

test('parseGhSecretList は空出力から空配列を返す', () => {
  assert.deepEqual(parseGhSecretList(''), [])
  assert.deepEqual(parseGhSecretList('\n\n'), [])
})

test('parseGhVariableList は name と value を Map にする', () => {
  const stdout =
    'DEPLOY_ENABLED\ttrue\t2024-01-01T00:00:00Z\nPUBLIC_DOMAIN\tcalshare.jp\t2024-01-01T00:00:00Z\n'
  const map = parseGhVariableList(stdout)
  assert.equal(map.get('DEPLOY_ENABLED'), 'true')
  assert.equal(map.get('PUBLIC_DOMAIN'), 'calshare.jp')
})

// --- buildSecretItems / buildVariableItems / buildCiItem -------------------

test('buildSecretItems は必須シークレットが無いと blocker、任意シークレットが無いと warn になる', () => {
  const items = buildSecretItems([])
  const required = items.find((i) => i.label.includes('CLOUDFLARE_API_TOKEN'))
  const optional = items.find((i) => i.label.includes('REPORT_WEBHOOK_URL'))
  assert.equal(required.status, 'blocker')
  assert.equal(optional.status, 'warn')
})

test('buildSecretItems は揃っていれば全部 ok になる', () => {
  const items = buildSecretItems([
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'REPORT_WEBHOOK_URL',
  ])
  assert.ok(items.every((i) => i.status === 'ok'))
})

test('buildVariableItems は未設定を warn、設定済みを ok にする', () => {
  const items = buildVariableItems(new Map([['DEPLOY_ENABLED', 'true']]))
  assert.equal(items.find((i) => i.label.includes('DEPLOY_ENABLED')).status, 'ok')
  assert.equal(items.find((i) => i.label.includes('PUBLIC_DOMAIN')).status, 'warn')
})

test('buildCiItem は実行履歴が無いと warn になる', () => {
  assert.equal(buildCiItem([]).status, 'warn')
})

test('buildCiItem は失敗した実行を blocker にする', () => {
  const item = buildCiItem([
    { status: 'completed', conclusion: 'failure', url: 'https://example.com/run/1' },
  ])
  assert.equal(item.status, 'blocker')
})

test('buildCiItem は成功した実行を ok にする', () => {
  const item = buildCiItem([
    { status: 'completed', conclusion: 'success', url: 'https://example.com/run/1' },
  ])
  assert.equal(item.status, 'ok')
})

test('buildCiItem は実行中を warn にする', () => {
  const item = buildCiItem([
    { status: 'in_progress', conclusion: null, url: 'https://example.com/run/1' },
  ])
  assert.equal(item.status, 'warn')
})

// --- 法的文書の空欄検出 -------------------------------------------------------

test('findFieldValue はラベルの後ろの値を1行取る', () => {
  assert.equal(findFieldValue('施行日: 2026-10-01\n運営者: 山田太郎', '施行日'), '2026-10-01')
  assert.equal(findFieldValue('施行日: 2026-10-01\n運営者: 山田太郎', '運営者'), '山田太郎')
})

test('looksLikePlaceholder は docs/legal の雛形にある全角括弧の記入依頼を検出する', () => {
  assert.equal(looksLikePlaceholder('（オーナーが記入。例: 2026-10-01）'), true)
  assert.equal(
    looksLikePlaceholder(
      '（オーナーが記入。個人名を出したくない場合は「calshare運営事務局」のような屋号表記でも構いません）',
    ),
    true,
  )
})

test('looksLikePlaceholder は実際に埋まった値を検出しない', () => {
  assert.equal(looksLikePlaceholder('2026-10-01'), false)
  assert.equal(looksLikePlaceholder('calshare運営事務局'), false)
})

test('checkLegalDocFields は施行日・運営者が両方埋まっていれば issues が空', () => {
  const { issues } = checkLegalDocFields(
    '# 利用規約\n\n施行日: 2026-10-01\n運営者: 山田太郎\n\n本文...',
  )
  assert.deepEqual(issues, [])
})

test('checkLegalDocFields は施行日が空欄・プレースホルダなら検出する', () => {
  assert.equal(checkLegalDocFields('施行日: \n運営者: 山田太郎').issues.length, 1)
  assert.equal(checkLegalDocFields('施行日: TBD\n運営者: 山田太郎').issues.length, 1)
  assert.equal(checkLegalDocFields('施行日: [ここに日付]\n運営者: 山田太郎').issues.length, 1)
})

test('checkLegalDocFields は運営者が空欄なら検出する', () => {
  assert.equal(checkLegalDocFields('施行日: 2026-10-01\n運営者: ').issues.length, 1)
})

test('checkLegalDocFields はフィールド自体が無いと「見つからない」を issues に含める', () => {
  const { issues } = checkLegalDocFields('# 利用規約\n\n本文のみ')
  assert.equal(issues.length, 2)
})

// --- LINE 実機確認 -----------------------------------------------------------

test('checkLineDeviceTestResult は結果欄が埋まっていれば recorded = true', () => {
  const text = [
    '# LINE 実機確認',
    '',
    '## 結果',
    '2026-09-20 iPhone 15 / LINE 14.x で確認。カレンダーボタン・ics 取り込みとも成功。',
    '',
    '## 手順',
    '...',
  ].join('\n')
  const { recorded } = checkLineDeviceTestResult(text)
  assert.equal(recorded, true)
})

test('checkLineDeviceTestResult は結果欄が空・未実施なら recorded = false', () => {
  assert.equal(checkLineDeviceTestResult('## 結果\n\n## 手順').recorded, false)
  assert.equal(checkLineDeviceTestResult('## 結果\n未実施\n\n## 手順').recorded, false)
})

test('checkLineDeviceTestResult は見出しより前の地の文にある「結果」に惑わされない', () => {
  const text = [
    '# LINE 実機確認',
    '',
    '本手順の結果は下記に記録します。',
    '',
    '## 手順',
    '1. iPhone で開く',
    '',
    '## 結果',
    '2026-09-20 iPhone 15 / LINE 14.x で確認。カレンダーボタン・ics 取り込みとも成功。',
  ].join('\n')
  const { recorded, excerpt } = checkLineDeviceTestResult(text)
  assert.equal(recorded, true)
  assert.match(excerpt, /2026-09-20/)
  assert.doesNotMatch(excerpt, /iPhone で開く/)
})

// --- 未決事項の抽出 -----------------------------------------------------------

test('extractUndecidedItems は design.md §14.2 の番号付きリストを抜き出す', () => {
  const designText = [
    '## 14. リスクと未決事項',
    '',
    '### 14.2 未決事項（オーナー判断を仰ぐ）',
    '',
    '1. **サービス名・ドメイン**（H1）。設計書中の `calshare` は仮。',
    '2. **OGP 画像のデザイン**（配色）。制約: 固定文言を含める。',
    '',
    '### 14.3 レビュー指摘',
  ].join('\n')
  const items = extractUndecidedItems(designText)
  assert.equal(items.length, 2)
  assert.equal(items[0].index, 1)
  assert.equal(items[0].title, 'サービス名・ドメイン')
  assert.match(items[0].detail, /H1/)
})

test('extractUndecidedItems はセクションが無ければ空配列を返す', () => {
  assert.deepEqual(extractUndecidedItems('# 何か別の文書'), [])
})

test('buildUndecidedItems は §14.2-1 と §14.2-7 を blocker、それ以外を warn にする', () => {
  const items = buildUndecidedItems([
    { index: 1, title: 'サービス名・ドメイン', detail: '' },
    { index: 3, title: 'ヒューリスティック', detail: '' },
    { index: 7, title: 'Workers Paid の契約承認', detail: '' },
  ])
  assert.equal(items.find((i) => i.key === 'undecided:1').status, 'blocker')
  assert.equal(items.find((i) => i.key === 'undecided:3').status, 'warn')
  assert.equal(items.find((i) => i.key === 'undecided:7').status, 'blocker')
})

// --- computeVerdict / buildReport -------------------------------------------

test('computeVerdict は blocker が1つでもあれば公開不可', () => {
  assert.equal(
    computeVerdict([{ status: 'ok' }, { status: 'blocker' }, { status: 'warn' }]),
    '公開不可',
  )
})

test('computeVerdict は blocker が無く warn/unknown があれば条件付き公開可', () => {
  assert.equal(
    computeVerdict([{ status: 'ok' }, { status: 'warn' }]),
    '条件付き公開可（要確認あり）',
  )
  assert.equal(
    computeVerdict([{ status: 'ok' }, { status: 'unknown' }]),
    '条件付き公開可（要確認あり）',
  )
})

test('computeVerdict は全部 ok なら公開可', () => {
  assert.equal(computeVerdict([{ status: 'ok' }, { status: 'ok' }]), '公開可')
})

test('computeVerdict は項目が空でも公開可', () => {
  assert.equal(computeVerdict([]), '公開可')
})

test('buildReport は固定テンプレートの4見出し（判定・ブロッカー・推奨事項・確認できなかった項目）を含む', () => {
  const report = buildReport(
    [
      { label: 'A', status: 'blocker', who: 'オーナー', action: 'やる', detail: '未対応' },
      { label: 'B', status: 'warn', who: 'オーナー', action: '検討する', detail: '' },
      { label: 'C', status: 'unknown', who: '—', action: '', detail: 'gh 未認証' },
      { label: 'D', status: 'ok', who: '—', action: '', detail: '' },
    ],
    { generatedAt: '2026-09-17T00:00:00.000Z' },
  )
  assert.match(report, /## 判定\n公開不可/)
  assert.match(report, /## ブロッカー\n- \*\*A\*\*/)
  assert.match(report, /## 推奨事項\n- \*\*B\*\*/)
  assert.match(report, /## 確認できなかった項目\n- \*\*C\*\*/)
  assert.doesNotMatch(report, /\*\*D\*\*/)
})

test('buildReport はブロッカーが無ければ「ブロッカーなし」と出す', () => {
  const report = buildReport([{ label: 'A', status: 'ok', who: '—', action: '', detail: '' }])
  assert.match(report, /## ブロッカー\nブロッカーなし/)
})

// --- collectChecklistItems（gh・ファイルシステムをフェイクで差し替えた結合テスト）---

function fakeExecAllOk() {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(' ')
    if (key === 'gh --version') return { error: null, stdout: 'gh version 2.0.0', stderr: '' }
    if (key === 'gh auth status') return { error: null, stdout: 'Logged in', stderr: '' }
    if (key === 'gh secret list')
      return {
        error: null,
        stdout:
          'CLOUDFLARE_API_TOKEN\t2024\nCLOUDFLARE_ACCOUNT_ID\t2024\nREPORT_WEBHOOK_URL\t2024\n',
        stderr: '',
      }
    if (key === 'gh variable list')
      return {
        error: null,
        stdout: 'DEPLOY_ENABLED\ttrue\t2024\nPUBLIC_DOMAIN\tcalshare.jp\t2024\n',
        stderr: '',
      }
    if (key.startsWith('gh run list'))
      return {
        error: null,
        stdout: JSON.stringify([
          { status: 'completed', conclusion: 'success', url: 'https://x/1' },
        ]),
        stderr: '',
      }
    if (key.startsWith('gh issue list')) return { error: null, stdout: '[]', stderr: '' }
    throw new Error(`unexpected exec: ${key}`)
  }
}

test('collectChecklistItems は gh が使えないとき全 gh 系項目を unknown にする', async () => {
  const exec = async () => ({
    error: new Error('not found'),
    stdout: '',
    stderr: 'command not found',
  })
  const items = await collectChecklistItems({ exec, repoRoot: '/nonexistent-repo-root-for-test' })
  const ghKeys = ['secrets', 'variables', 'ci', 'issues']
  for (const key of ghKeys) {
    const item = items.find((i) => i.key === key)
    assert.equal(item.status, 'unknown', `${key} should be unknown`)
  }
})

test('collectChecklistItems は wrangler.jsonc が無いリポジトリを blocker にする', async () => {
  const items = await collectChecklistItems({
    exec: fakeExecAllOk(),
    repoRoot: '/nonexistent-repo-root-for-test',
  })
  const wrangler = items.find((i) => i.key === 'wrangler')
  assert.equal(wrangler.status, 'blocker')
  const legal = items.find((i) => i.key === 'legal')
  assert.equal(legal.status, 'blocker')
  const line = items.find((i) => i.key === 'line')
  assert.equal(line.status, 'blocker')
})

test('collectChecklistItems は gh が使えて secrets が揃っていれば blocker にしない', async () => {
  const items = await collectChecklistItems({
    exec: fakeExecAllOk(),
    repoRoot: '/nonexistent-repo-root-for-test',
  })
  const secretItems = items.filter((i) => i.key.startsWith('secret:'))
  assert.ok(secretItems.every((i) => i.status === 'ok'))
})

test('collectChecklistItems は scripts/legal/checkLegalDocs.mjs があればその出力を使う（存在しなければ簡易判定にフォールバック）', async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'go-live-check-legal-'))
  try {
    await mkdirRaw(path.join(repoRoot, 'scripts/legal'), { recursive: true })
    const scriptPath = path.join(repoRoot, 'scripts/legal/checkLegalDocs.mjs')
    await writeFileRaw(
      scriptPath,
      '// stub: exec is faked in this test, this file is never actually run\n',
    )

    const exec = async (cmd, args) => {
      const key = [cmd, ...args].join(' ')
      if (cmd === 'gh')
        return { error: new Error('not found'), stdout: '', stderr: 'command not found' }
      if (key === `node ${scriptPath} --json`) {
        return {
          error: null,
          stdout: JSON.stringify({
            ok: false,
            results: [
              { file: 'docs/legal/terms.md', ok: true, errors: [], placeholders: [] },
              {
                file: 'docs/legal/privacy.md',
                ok: false,
                errors: ['条番号が連番でない（2番目の見出しが第3条になっている）'],
                placeholders: [],
              },
            ],
          }),
          stderr: '',
        }
      }
      throw new Error(`unexpected exec: ${key}`)
    }

    const items = await collectChecklistItems({ exec, repoRoot })
    const terms = items.find((i) => i.key === 'legal:docs/legal/terms.md')
    const privacy = items.find((i) => i.key === 'legal:docs/legal/privacy.md')
    assert.equal(terms.status, 'ok')
    assert.equal(privacy.status, 'blocker')
    assert.match(privacy.detail, /条番号が連番でない/)
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
})
