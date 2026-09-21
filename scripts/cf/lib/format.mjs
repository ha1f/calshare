// scripts/cf 配下の CLI が共通で使う出力ヘルパ。
// Markdown の表 1 種類に統一する。ターミナルでもそのまま読め、GitHub Actions の
// GITHUB_STEP_SUMMARY にもそのまま追記できる（GFM としてレンダリングされる）ため。

/**
 * ヘッダと行データから Markdown の表を組み立てる。
 * @param {string[]} headers
 * @param {Array<Array<string | number>>} rows
 * @returns {string}
 */
export function toMarkdownTable(headers, rows) {
  const headerLine = `| ${headers.join(' | ')} |`
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`
  const bodyLines = rows.map(
    (row) => `| ${row.map((cell) => String(cell).replaceAll('\n', '<br>')).join(' | ')} |`,
  )
  return [headerLine, sepLine, ...bodyLines].join('\n')
}
