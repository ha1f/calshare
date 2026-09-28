#!/usr/bin/env node
// wrangler.jsonc の "name"（Worker 名）を標準出力に出す。deploy.yml・provision.yml が
// Cloudflare API で Worker の有無を確かめるときに使う。
// "name" は apply-service-name.mjs がサービス名とともに書き換えるので、workflow に固定値で
// 書かずにここで読む（docs/runbooks/rename.md）。
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const USAGE = `使い方: node scripts/cf/worker-name.mjs [--config <path>] [--help]

wrangler.jsonc の最初の "name" の値（Worker 名）を標準出力に 1 行で出す。

  --config <path>  読む設定ファイル（既定: wrangler.jsonc）
  --help           このヘルプを表示する

例: name=$(node scripts/cf/worker-name.mjs)`

/**
 * wrangler.jsonc の本文から Worker 名を返す。見つからなければ null。
 * トップレベルの "name" がファイルの最初の "name" であることを前提にしている。
 * @param {string} text
 */
export function readWorkerName(text) {
  const m = text.match(/"name"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string', default: 'wrangler.jsonc' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log(USAGE)
    return
  }
  const name = readWorkerName(readFileSync(values.config, 'utf8'))
  if (name === null) {
    console.error(`${values.config} に "name" が見つかりません`)
    process.exitCode = 1
    return
  }
  console.log(name)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
