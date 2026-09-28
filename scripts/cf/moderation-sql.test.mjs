import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildModerationSql,
  buildCreatorLookupSql,
  firstRow,
  extractIds,
} from './moderation-sql.mjs'

const VALID_PAGE_ID = 'a3k7m2n9p4qz' // 12 文字の Crockford Base32 小文字
const VALID_HASH = 'a'.repeat(32)
const VALID_DEVICE_ID = 'dev-device_ID-123'

test('hide は active なページだけを hidden にする SQL を返す', () => {
  const { sql, countSql } = buildModerationSql({ action: 'hide', pageId: VALID_PAGE_ID })
  assert.match(sql, /^UPDATE pages SET status = 'hidden' WHERE /)
  assert.match(sql, new RegExp(`id = '${VALID_PAGE_ID}'`))
  assert.match(sql, /status = 'active'/)
  assert.match(countSql, /^SELECT COUNT\(\*\) AS count FROM pages WHERE /)
  assert.match(countSql, new RegExp(`id = '${VALID_PAGE_ID}'`))
})

test('unhide は hidden なページだけを active に戻す SQL を返す', () => {
  const { sql, countSql } = buildModerationSql({ action: 'unhide', pageId: VALID_PAGE_ID })
  assert.match(sql, /^UPDATE pages SET status = 'active' WHERE /)
  assert.match(sql, /status = 'hidden'/)
  assert.match(countSql, /status = 'hidden'/)
})

test('hide-by-creator は同一送信元の active なページを一括で hidden にする SQL を返す', () => {
  const { sql, countSql, listSql } = buildModerationSql({
    action: 'hide-by-creator',
    creatorIpHash: VALID_HASH,
    creatorDeviceId: VALID_DEVICE_ID,
  })
  assert.match(sql, /^UPDATE pages SET status = 'hidden' WHERE /)
  assert.match(sql, new RegExp(`creator_ip_hash = '${VALID_HASH}'`))
  assert.match(sql, new RegExp(`creator_device_id = '${VALID_DEVICE_ID}'`))
  assert.match(sql, / OR /)
  assert.match(countSql, /^SELECT COUNT\(\*\) AS count FROM pages WHERE /)
  // 誤って巻き込んだページを特定して戻せるよう、更新前に対象 id を確認できる SELECT も返す。
  assert.match(listSql, /^SELECT id FROM pages WHERE /)
  assert.match(listSql, new RegExp(`creator_ip_hash = '${VALID_HASH}'`))
})

test('hide-by-creator は creator_ip_hash が unknown のとき device_id だけで絞る', () => {
  const statements = buildModerationSql({
    action: 'hide-by-creator',
    creatorIpHash: 'unknown',
    creatorDeviceId: VALID_DEVICE_ID,
  })
  assert.match(statements.sql, /^UPDATE pages SET status = 'hidden' WHERE /)
  for (const statement of [statements.sql, statements.countSql, statements.listSql]) {
    assert.doesNotMatch(statement, /creator_ip_hash/)
    assert.match(statement, /status = 'active'/)
    assert.match(statement, new RegExp(`creator_device_id = '${VALID_DEVICE_ID}'`))
  }
})

test('hide-by-creator の unknown の分岐でも device_id を検証し、unknown に完全一致しない値は ip_hash として検証する', () => {
  assert.throws(
    () =>
      buildModerationSql({
        action: 'hide-by-creator',
        creatorIpHash: 'unknown',
        creatorDeviceId: "x'; DROP TABLE pages; --",
      }),
    /creator_device_id が不正/,
  )
  for (const creatorIpHash of ['UNKNOWN', 'unknown ', "unknown'"]) {
    assert.throws(
      () =>
        buildModerationSql({
          action: 'hide-by-creator',
          creatorIpHash,
          creatorDeviceId: VALID_DEVICE_ID,
        }),
      /creator_ip_hash が不正/,
    )
  }
})

test('不明な action は分かりやすいメッセージで失敗する', () => {
  assert.throws(
    () => buildModerationSql({ action: 'delete', pageId: VALID_PAGE_ID }),
    /不明な action: delete/,
  )
})

test('page_id の形式検証: 長さ・文字種・除外文字', () => {
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'a3k7m2n9p4q' }),
    /page_id が不正/,
  ) // 11文字
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'a3k7m2n9p4qzz' }),
    /page_id が不正/,
  ) // 13文字
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'A3K7M2N9P4QZ' }),
    /page_id が不正/,
  ) // 大文字
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'a3k7m2n9p4qi' }),
    /page_id が不正/,
  ) // i を含む
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'a3k7m2n9p4ql' }),
    /page_id が不正/,
  ) // l を含む
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'a3k7m2n9p4qo' }),
    /page_id が不正/,
  ) // o を含む
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: 'a3k7m2n9p4qu' }),
    /page_id が不正/,
  ) // u を含む
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: '//example.com' }),
    /page_id が不正/,
  ) // 注入・オープンリダイレクト狙い
  assert.throws(
    () => buildModerationSql({ action: 'hide', pageId: "a3k7m2n9p4q'" }),
    /page_id が不正/,
  ) // クォート
  assert.throws(() => buildModerationSql({ action: 'hide', pageId: undefined }), /page_id が不正/)
})

test('creator_ip_hash の形式検証: 32桁16進文字列以外を拒否する', () => {
  assert.throws(
    () =>
      buildModerationSql({
        action: 'hide-by-creator',
        creatorIpHash: 'zz'.repeat(16),
        creatorDeviceId: VALID_DEVICE_ID,
      }),
    /creator_ip_hash が不正/,
  )
  assert.throws(
    () =>
      buildModerationSql({
        action: 'hide-by-creator',
        creatorIpHash: VALID_HASH.slice(0, 31),
        creatorDeviceId: VALID_DEVICE_ID,
      }),
    /creator_ip_hash が不正/,
  )
  assert.throws(
    () =>
      buildModerationSql({
        action: 'hide-by-creator',
        creatorIpHash: `${VALID_HASH.slice(0, 31)}'`,
        creatorDeviceId: VALID_DEVICE_ID,
      }),
    /creator_ip_hash が不正/,
  )
})

test('creator_device_id の形式検証: SQL 文字列リテラルを抜けられる文字を拒否する', () => {
  assert.throws(
    () =>
      buildModerationSql({
        action: 'hide-by-creator',
        creatorIpHash: VALID_HASH,
        creatorDeviceId: "x'; DROP TABLE pages; --",
      }),
    /creator_device_id が不正/,
  )
  assert.throws(
    () =>
      buildModerationSql({
        action: 'hide-by-creator',
        creatorIpHash: VALID_HASH,
        creatorDeviceId: '',
      }),
    /creator_device_id が不正/,
  )
})

test('buildCreatorLookupSql は page_id を検証した上で SELECT を返す', () => {
  const sql = buildCreatorLookupSql(VALID_PAGE_ID)
  assert.match(sql, /^SELECT creator_ip_hash, creator_device_id FROM pages WHERE id = /)
  assert.match(sql, new RegExp(`'${VALID_PAGE_ID}'`))
  assert.throws(() => buildCreatorLookupSql('invalid'), /page_id が不正/)
})

test('firstRow は wrangler d1 execute --json の出力から先頭行を取り出す', () => {
  const output = JSON.stringify([{ results: [{ creator_ip_hash: VALID_HASH }], success: true }])
  assert.deepEqual(firstRow(output), { creator_ip_hash: VALID_HASH })
})

test('firstRow は結果が0件のとき分かりやすいメッセージで失敗する', () => {
  const output = JSON.stringify([{ results: [], success: true }])
  assert.throws(() => firstRow(output), /対象が見つかりませんでした/)
})

test('firstRow は JSON でない入力を分かりやすいメッセージで拒否する', () => {
  assert.throws(() => firstRow('not json'), /JSON として解釈できません/)
})

test('extractIds は listSql の実行結果から id の一覧を取り出す', () => {
  const output = JSON.stringify([
    { results: [{ id: 'a3k7m2n9p4qz' }, { id: 'b3k7m2n9p4qz' }], success: true },
  ])
  assert.deepEqual(extractIds(output), ['a3k7m2n9p4qz', 'b3k7m2n9p4qz'])
})

test('extractIds は0件でも空配列を返す（0件は呼び出し側で判定する）', () => {
  const output = JSON.stringify([{ results: [], success: true }])
  assert.deepEqual(extractIds(output), [])
})

test('extractIds は JSON でない入力を分かりやすいメッセージで拒否する', () => {
  assert.throws(() => extractIds('not json'), /JSON として解釈できません/)
})
