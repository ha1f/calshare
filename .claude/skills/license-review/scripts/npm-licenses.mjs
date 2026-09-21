#!/usr/bin/env node
// package.json の直接依存パッケージについて、ライセンス種別と LICENSE ファイル同梱有無を一覧にする。
// license-review スキルの手順(1)「対象とライセンス本文を特定する」を npm パッケージ向けに自動化するための下ごしらえで、
// SPDX への対応付けや義務の判定はスキル側（人間 + Claude）が行う。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const LICENSE_FILE_CANDIDATES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'License',
  'LICENCE',
  'LICENCE.md',
]

/** package.json の内容から直接依存パッケージ名を取り出す（dependencies + devDependencies、重複は除いて昇順）。 */
export function extractDependencyNames(packageJsonText) {
  const pkg = JSON.parse(packageJsonText)
  const names = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
  return [...names].sort()
}

/**
 * package.json の license 表記を 1 つの文字列に揃える。
 * 新形式（文字列）・旧形式（{ type }・配列）のいずれにも対応する。
 */
export function normalizeLicenseField(license) {
  if (!license) return null
  if (typeof license === 'string') return license
  if (Array.isArray(license))
    return (
      license
        .map((l) => l.type)
        .filter(Boolean)
        .join(' OR ') || null
    )
  if (typeof license === 'object' && license.type) return license.type
  return null
}

/**
 * 1 パッケージ分のライセンス情報を node_modules から調べる。
 * fs アクセスを deps 経由にして、実ファイルを置かずにテストできるようにしている。
 */
export function inspectPackage(name, nodeModulesDir, deps = { readFileSync, existsSync }) {
  const pkgDir = join(nodeModulesDir, name)
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!deps.existsSync(pkgJsonPath)) {
    return { name, found: false, version: null, license: null, hasLicenseFile: false }
  }
  const pkg = JSON.parse(deps.readFileSync(pkgJsonPath, 'utf8'))
  const hasLicenseFile = LICENSE_FILE_CANDIDATES.some((f) => deps.existsSync(join(pkgDir, f)))
  return {
    name,
    found: true,
    version: pkg.version ?? null,
    license: normalizeLicenseField(pkg.license ?? pkg.licenses),
    hasLicenseFile,
  }
}

/** 調査結果を Markdown テーブルにする。審査記録（assets/record-template.md）にそのまま貼れる形式。 */
export function formatTable(rows) {
  const header = '| package | version | license (package.json) | LICENSE 同梱 |\n|---|---|---|---|'
  const lines = rows.map((r) => {
    if (!r.found) return `| ${r.name} | - | (node_modules に見つからず。npm install を確認) | - |`
    return `| ${r.name} | ${r.version ?? '?'} | ${r.license ?? '(記載なし。LICENSE ファイルを直接確認)'} | ${r.hasLicenseFile ? 'あり' : 'なし'} |`
  })
  return [header, ...lines].join('\n')
}

function main() {
  const cwd = process.cwd()
  const packageJsonPath = join(cwd, 'package.json')
  const nodeModulesDir = join(cwd, 'node_modules')
  if (!existsSync(packageJsonPath)) {
    console.log(
      'package.json が見つかりません。license-review スキルの手順(1)は対象を手動で特定してください。',
    )
    return
  }
  if (!existsSync(nodeModulesDir)) {
    console.log(
      'node_modules が見つかりません（npm install 前）。license-review スキルの手順(1)は対象を手動で特定してください。',
    )
    return
  }
  const names = extractDependencyNames(readFileSync(packageJsonPath, 'utf8'))
  if (names.length === 0) {
    console.log('package.json に dependencies / devDependencies がありません。')
    return
  }
  const rows = names.map((name) => inspectPackage(name, nodeModulesDir))
  console.log(formatTable(rows))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
