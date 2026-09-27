// src/web → dist/ のビルド。
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const srcWebDir = path.join(rootDir, 'src/web')
const distDir = path.join(rootDir, 'dist')

async function listFiles(dir, predicate) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(dir, entry.name))
}

async function copyInto(files, destDir) {
  if (files.length === 0) return
  await mkdir(destDir, { recursive: true })
  for (const file of files) {
    await copyFile(file, path.join(destDir, path.basename(file)))
  }
}

async function main() {
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  // src/web 直下の 1 階層だけを esbuild のエントリにする（§11.7）
  const webEntries = await readdir(srcWebDir, { withFileTypes: true })
  const entryPoints = webEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(srcWebDir, entry.name, 'main.ts'))
    .filter((file) => existsSync(file))
  if (entryPoints.length > 0) {
    const esbuild = await import('esbuild')
    await esbuild.build({
      entryPoints,
      bundle: true,
      format: 'esm',
      target: 'es2022',
      minify: true,
      outdir: path.join(distDir, 'assets/js'),
      outbase: srcWebDir,
      entryNames: '[dir]',
      // splitting は使わない。共有チャンクが別リクエストになり、ページ単体の初回ロードが増える
    })
  }

  const cssFiles = await listFiles(path.join(srcWebDir, 'styles'), (name) => name.endsWith('.css'))
  await copyInto(cssFiles, path.join(distDir, 'assets/css'))

  const imgFiles = await listFiles(path.join(srcWebDir, 'img'), () => true)
  await copyInto(imgFiles, path.join(distDir, 'assets/img'))

  const pageFiles = await listFiles(path.join(srcWebDir, 'pages'), (name) => name.endsWith('.html'))
  await copyInto(pageFiles, distDir)

  // 欠けていれば copyFile が ENOENT で落ちる（CSP 等を持つ _headers を静かに欠落させないため）
  const rootFiles = ['robots.txt', 'favicon.ico', '_headers'].map((name) =>
    path.join(srcWebDir, name),
  )
  await copyInto(rootFiles, distDir)
}

await main()
