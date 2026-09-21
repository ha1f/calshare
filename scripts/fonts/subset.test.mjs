import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SCRIPT_PATH = fileURLToPath(new URL('./subset.sh', import.meta.url))
// pyftsubset を見つけさせないための最小 PATH（node 自体は動かす必要がある）。
const PATH_WITHOUT_FONTTOOLS = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':')

test('CLI: --help は pyftsubset が無くても使い方を表示する', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--help'], {
    encoding: 'utf8',
    env: { PATH: PATH_WITHOUT_FONTTOOLS },
  })
  assert.match(out, /使い方/)
})

test('CLI: 不明な引数は使い方を添えてエラー終了する', () => {
  assert.throws(
    () =>
      execFileSync('bash', [SCRIPT_PATH, '--nope'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: PATH_WITHOUT_FONTTOOLS },
      }),
    (err) => {
      assert.match(err.stderr, /不明な引数です/)
      return true
    },
  )
})

test('CLI: --dry-run は対象文字数を表示し pyftsubset を呼ばない', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--dry-run'], {
    encoding: 'utf8',
    env: { PATH: PATH_WITHOUT_FONTTOOLS },
  })
  assert.match(out, /\[dry-run\]/)
  assert.match(out, /対象文字数: 3248/)
})

test('CLI: --dry-run --json は JSON で結果を返す', () => {
  const out = execFileSync('bash', [SCRIPT_PATH, '--dry-run', '--json'], {
    encoding: 'utf8',
    env: { PATH: PATH_WITHOUT_FONTTOOLS },
  })
  const result = JSON.parse(out)
  assert.equal(result.dryRun, true)
  assert.equal(result.charCount, 3248)
})

test('CLI: pyftsubset が無ければインストール方法を表示して終了コード1になる', () => {
  assert.throws(
    () =>
      execFileSync('bash', [SCRIPT_PATH], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: PATH_WITHOUT_FONTTOOLS },
      }),
    (err) => {
      assert.equal(err.status, 1)
      assert.match(err.stderr, /pyftsubset（fonttools）が見つかりません/)
      assert.match(err.stderr, /pip install fonttools/)
      return true
    },
  )
})

// 実際のサブセット化は、フォントと fonttools が用意された環境（オーナーが検証に使った
// .claude/tmp/venv-fonttools）でのみ実行する。CI にはどちらも無いためスキップする。
const VENV_PYFTSUBSET = path.join(process.cwd(), '.claude/tmp/venv-fonttools/bin')
const FONT_FIXTURE = path.join(process.cwd(), '.claude/tmp/fonts/NotoSansJP-Regular.otf')
const hasLocalFixtures = (() => {
  try {
    execFileSync('test', ['-f', path.join(VENV_PYFTSUBSET, 'pyftsubset')])
    execFileSync('test', ['-f', FONT_FIXTURE])
    return true
  } catch {
    return false
  }
})()

test(
  'CLI: 実フォントをサブセット化すると全対象文字を含む OTF ができる（ローカル検証用）',
  { skip: !hasLocalFixtures && 'venv-fonttools かフォントが無いためスキップ' },
  async () => {
    const { mkdtemp, rm, stat } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(path.join(tmpdir(), 'subset-sh-'))
    try {
      const out = path.join(dir, 'out.otf')
      const result = JSON.parse(
        execFileSync('bash', [SCRIPT_PATH, '--out', out, '--json'], {
          encoding: 'utf8',
          env: { PATH: `${VENV_PYFTSUBSET}:${process.env.PATH}` },
        }),
      )
      assert.equal(result.charCount, 3248)
      const stats = await stat(out)
      assert.ok(stats.size > 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
