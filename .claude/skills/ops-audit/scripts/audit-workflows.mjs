#!/usr/bin/env node
// .github/workflows/*.yml をテキストとして走査し、機械的に見つけられる指摘だけを出す。
// YAML の構文検証や permissions の意味的な妥当性（最小権限かどうか）は見ない。
// それらは ops-audit スキルの手順（ruby -ryaml・人間 + Claude によるレビュー）が担う。
// 依存ゼロ（Node 20 標準ライブラリのみ）。

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_WORKFLOWS_DIR = '.github/workflows'

// シェルに直接展開すると injection の起点になりうるコンテキスト。
// これらは env: 経由で受け渡すのが定石（「${{ }} をそのまま run: に書かない」）。
const RISKY_CONTEXT_PATTERN =
  /\$\{\{\s*(github\.event\.[\w.[\]'"]+|github\.head_ref|inputs\.[\w-]+|github\.event_name)\s*\}\}/g

// 公式・準公式扱いにする owner（SHA 固定でなくても severity を medium に留める）。
const TRUSTED_ACTION_OWNERS = new Set(['actions', 'github', 'cloudflare'])

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length
}

/**
 * `run:` の値（インライン、または `|`/`>` に続くインデントブロック）を集める。
 * 2 スペース系の標準的なインデントを前提にした簡易走査で、厳密な YAML パーサではない。
 * @param {string[]} lines 0 始まりの行配列（改行なし）
 * @returns {Array<{ runLine: number, lines: Array<{ lineNumber: number, text: string }> }>}
 */
export function extractRunBlocks(lines) {
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:-\s*)?run:\s?(.*)$/)
    if (!m) continue
    const indent = indentOf(lines[i])
    const inline = m[2].trim()
    const blockLines = []
    if (inline && inline !== '|' && inline !== '|-' && inline !== '>' && inline !== '>-') {
      blockLines.push({ lineNumber: i + 1, text: inline })
    }
    let j = i + 1
    while (j < lines.length) {
      const line = lines[j]
      if (line.trim() === '') {
        j++
        continue
      }
      if (indentOf(line) > indent) {
        blockLines.push({ lineNumber: j + 1, text: line })
        j++
      } else {
        break
      }
    }
    blocks.push({ runLine: i + 1, lines: blockLines })
  }
  return blocks
}

/** @param {string} text ワークフロー YAML の内容 */
export function auditWorkflowText(text) {
  const lines = text.split(/\r\n|\n/)
  const findings = []

  if (!/^\s*permissions:/m.test(text)) {
    findings.push({
      line: 1,
      severity: 'high',
      category: 'permissions',
      message:
        'permissions: がファイル中に見つからない。既定（GITHUB_TOKEN が広い書き込み権限）のままの可能性がある。トップレベルまたは各 job に最小権限の permissions を明示する',
    })
  }

  for (const block of extractRunBlocks(lines)) {
    for (const { lineNumber, text: shellLine } of block.lines) {
      RISKY_CONTEXT_PATTERN.lastIndex = 0
      let match
      while ((match = RISKY_CONTEXT_PATTERN.exec(shellLine))) {
        findings.push({
          line: lineNumber,
          severity: 'high',
          category: 'injection',
          message: `run: の中で ${match[1]} をシェルに直接展開している疑い。env: 経由の環境変数に渡してから "$VAR" として参照する`,
        })
      }
      if (/\bset\s+-x\b/.test(shellLine) || /\bset\s+-o\s+xtrace\b/.test(shellLine)) {
        findings.push({
          line: lineNumber,
          severity: 'medium',
          category: 'secret-logging',
          message:
            'set -x（または -o xtrace）はコマンドをそのままログへ出す。シークレットを扱う手前で set +x するか、該当ステップでは使わない',
        })
      }
      if (/\becho\b/.test(shellLine) && /secrets\./.test(shellLine)) {
        findings.push({
          line: lineNumber,
          severity: 'high',
          category: 'secret-logging',
          message:
            'echo で secrets.* をログに出している疑い。マスクされないログ経路（::add-mask:: 未使用）がないか確認する',
        })
      }
    }
  }

  const usesPattern = /^(\s*)(?:-\s*)?uses:\s*([^\s#]+)/
  lines.forEach((line, idx) => {
    const m = line.match(usesPattern)
    if (!m) return
    const ref = m[2]
    if (ref.startsWith('./') || ref.startsWith('docker://')) return // ローカル action / docker イメージは対象外
    const atIndex = ref.lastIndexOf('@')
    if (atIndex === -1) {
      findings.push({
        line: idx + 1,
        severity: 'high',
        category: 'unpinned-action',
        message: `uses: ${ref} にバージョン指定（@...）が無い`,
      })
      return
    }
    const owner = ref.split('/')[0]
    const version = ref.slice(atIndex + 1)
    const isSha = /^[0-9a-f]{40}$/.test(version)
    if (!isSha) {
      const trusted = TRUSTED_ACTION_OWNERS.has(owner)
      findings.push({
        line: idx + 1,
        severity: trusted ? 'medium' : 'high',
        category: 'unpinned-action',
        message: `uses: ${ref} がタグ/ブランチ指定（${version}）で SHA 固定でない。${trusted ? '公式 action だがタグの付け替えに備えて SHA 固定を推奨' : 'サードパーティ action は改ざんリスクがあるため SHA 固定を強く推奨'}`,
      })
    }
  })

  return findings
}

/** @param {string} [dir] */
export function auditWorkflowsDir(dir = DEFAULT_WORKFLOWS_DIR) {
  if (!existsSync(dir)) {
    return { dir, exists: false, files: [] }
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const path = join(dir, name)
      const findings = auditWorkflowText(readFileSync(path, 'utf8'))
      return { path, findings }
    })
  return { dir, exists: true, files }
}

function usage() {
  return [
    '使い方: node audit-workflows.mjs [ワークフローのディレクトリ] [--json]',
    '',
    '既定のディレクトリ: .github/workflows',
    '',
    '検出するもの（すべてテキストベースの簡易チェック。YAML 構文は検証しない）:',
    '  - permissions: が無い',
    '  - run: の中で github.event.* / inputs.* / github.head_ref を直接展開している',
    '  - set -x や echo secrets.* によるシークレットのログ出力',
    '  - uses: のバージョンが SHA 固定でない',
    '',
    '例:',
    '  node .claude/skills/ops-audit/scripts/audit-workflows.mjs',
    '  node .claude/skills/ops-audit/scripts/audit-workflows.mjs .github/workflows --json',
  ].join('\n')
}

/** @param {{ dir: string, exists: boolean, files: Array<{ path: string, findings: object[] }> }} result */
export function formatReport(result) {
  if (!result.exists) {
    return `${result.dir} が存在しない（ワークフロー未作成、または他 PR が未着手）。該当なしとして扱う。`
  }
  if (result.files.length === 0) {
    return `${result.dir} に .yml/.yaml が無い。`
  }
  const lines = []
  for (const file of result.files) {
    if (file.findings.length === 0) {
      lines.push(`${file.path}: 指摘なし`)
      continue
    }
    for (const f of file.findings) {
      lines.push(`${file.path}:${f.line} [${f.severity}/${f.category}] ${f.message}`)
    }
  }
  return lines.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage())
    return
  }
  const json = args.includes('--json')
  const dir = args.find((a) => !a.startsWith('-')) ?? DEFAULT_WORKFLOWS_DIR
  const result = auditWorkflowsDir(dir)
  console.log(json ? JSON.stringify(result, null, 2) : formatReport(result))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
