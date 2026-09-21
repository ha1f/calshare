import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractDependencyNames,
  normalizeLicenseField,
  inspectPackage,
  formatTable,
} from './npm-licenses.mjs'

test('extractDependencyNames は dependencies と devDependencies を合わせて昇順で返す', () => {
  const pkg = JSON.stringify({
    dependencies: { hono: '^4.0.0', zod: '^3.0.0' },
    devDependencies: { vitest: '^2.0.0' },
  })
  assert.deepEqual(extractDependencyNames(pkg), ['hono', 'vitest', 'zod'])
})

test('extractDependencyNames は依存が無ければ空配列を返す', () => {
  assert.deepEqual(extractDependencyNames(JSON.stringify({ name: 'calshare' })), [])
})

test('extractDependencyNames は重複する名前を1つにまとめる', () => {
  const pkg = JSON.stringify({
    dependencies: { hono: '^4.0.0' },
    devDependencies: { hono: '^4.0.0' },
  })
  assert.deepEqual(extractDependencyNames(pkg), ['hono'])
})

test('normalizeLicenseField は文字列表記をそのまま返す', () => {
  assert.equal(normalizeLicenseField('MIT'), 'MIT')
})

test('normalizeLicenseField は旧形式 { type } を展開する', () => {
  assert.equal(normalizeLicenseField({ type: 'ISC' }), 'ISC')
})

test('normalizeLicenseField は配列表記を OR で連結する', () => {
  assert.equal(
    normalizeLicenseField([{ type: 'MIT' }, { type: 'Apache-2.0' }]),
    'MIT OR Apache-2.0',
  )
})

test('normalizeLicenseField は license が無ければ null を返す', () => {
  assert.equal(normalizeLicenseField(undefined), null)
  assert.equal(normalizeLicenseField(null), null)
})

test('inspectPackage は node_modules に無いパッケージを found:false で返す', () => {
  const deps = {
    existsSync: () => false,
    readFileSync: () => {
      throw new Error('呼ばれないはず')
    },
  }
  const result = inspectPackage('missing-pkg', '/repo/node_modules', deps)
  assert.deepEqual(result, {
    name: 'missing-pkg',
    found: false,
    version: null,
    license: null,
    hasLicenseFile: false,
  })
})

test('inspectPackage は package.json の license と LICENSE ファイルの有無を読む', () => {
  const deps = {
    existsSync: (p) => p.endsWith('package.json') || p.endsWith('LICENSE'),
    readFileSync: () => JSON.stringify({ version: '4.2.0', license: 'MIT' }),
  }
  const result = inspectPackage('hono', '/repo/node_modules', deps)
  assert.deepEqual(result, {
    name: 'hono',
    found: true,
    version: '4.2.0',
    license: 'MIT',
    hasLicenseFile: true,
  })
})

test('inspectPackage は LICENSE 系ファイルが無ければ hasLicenseFile:false を返す', () => {
  const deps = {
    existsSync: (p) => p.endsWith('package.json'),
    readFileSync: () => JSON.stringify({ version: '1.0.0', license: 'ISC' }),
  }
  const result = inspectPackage('no-license-file', '/repo/node_modules', deps)
  assert.equal(result.hasLicenseFile, false)
})

test('formatTable は見つかったパッケージと見つからないパッケージを両方描画する', () => {
  const table = formatTable([
    { name: 'hono', found: true, version: '4.2.0', license: 'MIT', hasLicenseFile: true },
    { name: 'ghost', found: false, version: null, license: null, hasLicenseFile: false },
  ])
  assert.match(table, /\| hono \| 4\.2\.0 \| MIT \| あり \|/)
  assert.match(table, /\| ghost \| - \|.*node_modules.*\| - \|/)
})
