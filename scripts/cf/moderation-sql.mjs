// 通報対応（非表示・解除・送信元一括非表示）の SQL を組み立てる純粋関数と CLI。
// design.md §9.4（通報導線）・§3（データモデル）・§4.2（ページ ID の形式）に対応する。
// このスクリプト自身は Cloudflare へ接続しない。実行は
// `npx wrangler d1 execute calshare --remote --command "<ここで組み立てた SQL>"` を
// .github/workflows/moderation.yml から呼ぶ形にし、書き込み経路を GitHub Actions の
// ログに残す。
//
// 値の埋め込みは文字列連結だが、埋め込む前に許可文字だけの正規表現で検証するため、
// SQL 文字列リテラルを抜け出す文字（クォート・バックスラッシュ・セミコロン等）は
// 混入できない。

import { pathToFileURL } from 'node:url'

// design.md §4.2: 公開ページ ID は Crockford Base32 小文字 12 文字（i/l/o/u を含まない）
export const PAGE_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{12}$/
// design.md §9.3: ip_hash は HMAC-SHA256 の hex 先頭32文字
export const IP_HASH_PATTERN = /^[0-9a-f]{32}$/
// CF-Connecting-IP が無いリクエストの ip_hash。定義は src/core/config/limits.ts の UNKNOWN_IP_HASH。
// 送信元を区別しない値なので、hide-by-creator は IP の一致を条件にしない（design.md §9.4）
export const UNKNOWN_IP_HASH = 'unknown'
// device_id の正確な生成方式は設計書に明記が無い（cs_device Cookie の値。§9.3）。
// ここでは「SQL 文字列リテラルを抜けられない」ことだけを機械的に保証する許可文字集合にする。
export const DEVICE_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/

function assertPageId(pageId) {
  if (typeof pageId !== 'string' || !PAGE_ID_PATTERN.test(pageId)) {
    throw new Error(
      `page_id が不正です: ${JSON.stringify(pageId)}。12 文字の Crockford Base32 小文字` +
        '（0-9a-hjkmnp-tv-z。i/l/o/u を含まない）で指定してください（design.md §4.2）',
    )
  }
  return pageId
}

function assertIpHash(hash) {
  if (typeof hash !== 'string' || !IP_HASH_PATTERN.test(hash)) {
    throw new Error(
      `creator_ip_hash が不正です: ${JSON.stringify(hash)}。32桁の16進文字列か ${UNKNOWN_IP_HASH} で指定してください（design.md §9.3）`,
    )
  }
  return hash
}

function assertDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw new Error(
      `creator_device_id が不正です: ${JSON.stringify(deviceId)}。英数字・-・_ のみ、1〜64文字で指定してください`,
    )
  }
  return deviceId
}

/**
 * 通報対応の SQL を組み立てる。
 * - hide / unhide: page_id 1件を対象に status を切り替える
 * - hide-by-creator: 同一送信元（creator_ip_hash または creator_device_id が一致）の
 *   active なページをまとめて hidden にする（design.md §9.4 のスパム波対応）。
 *   creatorIpHash が UNKNOWN_IP_HASH のときは creator_device_id の一致だけで絞る
 *
 * 戻り値の countSql・listSql は sql と同じ WHERE 句を共有する。countSql は実行前の対象件数
 * 確認に、listSql は更新前に対象 id を記録する（hide-by-creator は複数件を巻き込みうるため、
 * 誤操作したときに戻す対象を特定できるようにする。design.md §9.4）のに使う。
 * @returns {{ sql: string, countSql: string, listSql: string }}
 */
export function buildModerationSql({ action, pageId, creatorIpHash, creatorDeviceId }) {
  if (action === 'hide' || action === 'unhide') {
    const id = assertPageId(pageId)
    const fromStatus = action === 'hide' ? 'active' : 'hidden'
    const toStatus = action === 'hide' ? 'hidden' : 'active'
    const where = `id = '${id}' AND status = '${fromStatus}'`
    return {
      countSql: `SELECT COUNT(*) AS count FROM pages WHERE ${where};`,
      listSql: `SELECT id FROM pages WHERE ${where};`,
      sql: `UPDATE pages SET status = '${toStatus}' WHERE ${where};`,
    }
  }
  if (action === 'hide-by-creator') {
    const deviceId = assertDeviceId(creatorDeviceId)
    const creatorCondition =
      creatorIpHash === UNKNOWN_IP_HASH
        ? `creator_device_id = '${deviceId}'`
        : `(creator_ip_hash = '${assertIpHash(creatorIpHash)}' OR creator_device_id = '${deviceId}')`
    const where = `status = 'active' AND ${creatorCondition}`
    return {
      countSql: `SELECT COUNT(*) AS count FROM pages WHERE ${where};`,
      listSql: `SELECT id FROM pages WHERE ${where};`,
      sql: `UPDATE pages SET status = 'hidden' WHERE ${where};`,
    }
  }
  throw new Error(
    `不明な action: ${action}（hide / unhide / hide-by-creator のいずれかを指定してください）`,
  )
}

/** hide-by-creator の1段階目: page_id から送信元の ip_hash / device_id を引く SELECT */
export function buildCreatorLookupSql(pageId) {
  const id = assertPageId(pageId)
  return `SELECT creator_ip_hash, creator_device_id FROM pages WHERE id = '${id}';`
}

/**
 * `wrangler d1 execute --json` の標準出力から先頭クエリ結果の先頭行を取り出す。
 * ワークフロー内でシェル変数に値を渡す用途（--extract-field と併用）。
 */
export function firstRow(wranglerJsonOutput) {
  let parsed
  try {
    parsed = JSON.parse(wranglerJsonOutput)
  } catch {
    throw new Error(`wrangler の出力を JSON として解釈できません: ${wranglerJsonOutput}`)
  }
  const row = parsed?.[0]?.results?.[0]
  if (!row) {
    throw new Error('対象が見つかりませんでした（0件）。page_id を確認してください')
  }
  return row
}

/**
 * `wrangler d1 execute --json` の標準出力（listSql の実行結果）から id の一覧を取り出す。
 * hide-by-creator で巻き込む対象を、更新前にログへ残すために使う。
 */
export function extractIds(wranglerJsonOutput) {
  let parsed
  try {
    parsed = JSON.parse(wranglerJsonOutput)
  } catch {
    throw new Error(`wrangler の出力を JSON として解釈できません: ${wranglerJsonOutput}`)
  }
  const results = parsed?.[0]?.results
  if (!Array.isArray(results)) {
    throw new Error('wrangler の出力の形式が想定と違います（results が配列ではありません）')
  }
  return results.map((row) => row.id)
}

// --- CLI ---

function printUsage() {
  console.log(`使い方:
  node scripts/cf/moderation-sql.mjs --action <hide|unhide> --page-id <id> [--json]
  node scripts/cf/moderation-sql.mjs --action hide-by-creator --creator-ip-hash <hash> --creator-device-id <id> [--json]
  node scripts/cf/moderation-sql.mjs --lookup --page-id <id>
  node scripts/cf/moderation-sql.mjs --extract-field <field>   # stdin に wrangler --json の出力を渡す
  node scripts/cf/moderation-sql.mjs --extract-ids             # 同上。id の一覧を JSON 配列で出す

通報対応（非表示・解除・送信元一括非表示）の SQL を組み立てて標準出力に出す。
このコマンド自身は Cloudflare へ接続しない。実行は wrangler d1 execute に SQL を渡して行う。

  --action <hide|unhide|hide-by-creator>  操作の種類
  --page-id <id>                          対象ページ ID（hide / unhide / lookup で使用）
  --creator-ip-hash <hash>                送信元の ip_hash（hide-by-creator で使用。unknown なら device_id だけで絞る）
  --creator-device-id <id>                送信元の device_id（hide-by-creator で使用）
  --lookup                                page_id から creator_ip_hash / creator_device_id を引く SELECT を出す
  --extract-field <field>                 標準入力の wrangler --json 出力から指定フィールドの値だけを出す
  --extract-ids                           標準入力の wrangler --json 出力（listSql の結果）から id の一覧を JSON 配列で出す
  --json                                  { sql, countSql, listSql } を JSON で出す（既定は SQL コメント付きのテキスト）
  --help                                  このヘルプを表示する`)
}

function parseArgs(argv) {
  const args = {
    action: null,
    pageId: null,
    creatorIpHash: null,
    creatorDeviceId: null,
    lookup: false,
    extractField: null,
    extractIds: false,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--action') args.action = argv[++i]
    else if (a === '--page-id') args.pageId = argv[++i]
    else if (a === '--creator-ip-hash') args.creatorIpHash = argv[++i]
    else if (a === '--creator-device-id') args.creatorDeviceId = argv[++i]
    else if (a === '--lookup') args.lookup = true
    else if (a === '--extract-field') args.extractField = argv[++i]
    else if (a === '--extract-ids') args.extractIds = true
    else if (a === '--json') args.json = true
    else if (a === '--print' || a === '--dry-run')
      continue // 常に副作用が無いため受理するだけ
    else throw new Error(`不明な引数: ${a}（--help で使い方を確認してください）`)
  }
  return args
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage()
    return
  }
  if (
    !argv.includes('--action') &&
    !argv.includes('--lookup') &&
    !argv.includes('--extract-field') &&
    !argv.includes('--extract-ids')
  ) {
    printUsage()
    return
  }

  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
    return
  }

  try {
    if (args.extractField) {
      const input = await readStdin()
      const row = firstRow(input)
      if (!(args.extractField in row)) {
        throw new Error(
          `フィールドが見つかりません: ${args.extractField}（存在するフィールド: ${Object.keys(row).join(', ')}）`,
        )
      }
      console.log(row[args.extractField])
    } else if (args.extractIds) {
      const input = await readStdin()
      console.log(JSON.stringify(extractIds(input)))
    } else if (args.lookup) {
      console.log(buildCreatorLookupSql(args.pageId))
    } else {
      const { sql, countSql, listSql } = buildModerationSql(args)
      console.log(
        args.json
          ? JSON.stringify({ countSql, listSql, sql })
          : `-- 対象件数確認\n${countSql}\n\n-- 対象 id 一覧\n${listSql}\n\n-- 実行\n${sql}`,
      )
    }
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
