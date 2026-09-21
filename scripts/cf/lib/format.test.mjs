import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toMarkdownTable } from './format.mjs'

test('toMarkdownTable はヘッダ・区切り・行からなる Markdown 表を組み立てる', () => {
  const table = toMarkdownTable(
    ['状態', '確認内容'],
    [
      ['OK', 'トークン'],
      ['NG', 'D1'],
    ],
  )
  assert.equal(
    table,
    '| 状態 | 確認内容 |\n' + '| --- | --- |\n' + '| OK | トークン |\n' + '| NG | D1 |',
  )
})

test('セル内の改行は <br> に変換する', () => {
  const table = toMarkdownTable(['a'], [['1行目\n2行目']])
  assert.match(table, /1行目<br>2行目/)
})
