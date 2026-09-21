import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readZipEntry, listZipEntries } from './zip.mjs'
import { buildZip } from './testZipFixture.mjs'

test('listZipEntries はファイル名の一覧を返す', () => {
  const zip = buildZip([
    { name: 'a.txt', content: Buffer.from('hello'), method: 0 },
    { name: 'b.txt', content: Buffer.from('world'.repeat(50)), method: 8 },
  ])
  assert.deepEqual(
    listZipEntries(zip).map((e) => e.name),
    ['a.txt', 'b.txt'],
  )
})

test('readZipEntry は store（無圧縮）を展開する', () => {
  const zip = buildZip([{ name: 'a.txt', content: Buffer.from('hello store'), method: 0 }])
  assert.equal(readZipEntry(zip, 'a.txt').toString('utf8'), 'hello store')
})

test('readZipEntry は deflate 圧縮を展開する', () => {
  const original = Buffer.from('繰り返し圧縮確認'.repeat(100))
  const zip = buildZip([{ name: 'b.otf', content: original, method: 8 }])
  assert.deepEqual(readZipEntry(zip, 'b.otf'), original)
})

test('readZipEntry は複数エントリから正しいものを取り出す', () => {
  const zip = buildZip([
    { name: 'NotoSansJP-Regular.otf', content: Buffer.from('font-bytes'), method: 0 },
    { name: 'LICENSE', content: Buffer.from('OFL 1.1'), method: 8 },
  ])
  assert.equal(readZipEntry(zip, 'NotoSansJP-Regular.otf').toString(), 'font-bytes')
  assert.equal(readZipEntry(zip, 'LICENSE').toString(), 'OFL 1.1')
})

test('readZipEntry は存在しないファイル名でエラーに候補を含める', () => {
  const zip = buildZip([{ name: 'a.txt', content: Buffer.from('x'), method: 0 }])
  assert.throws(() => readZipEntry(zip, 'missing.txt'), /a\.txt/)
})
