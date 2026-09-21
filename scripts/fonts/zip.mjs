// 依存ゼロの最小 ZIP 展開ユーティリティ（Node の zlib のみ使用）。
// store（無圧縮）と deflate（圧縮方式 8）にのみ対応する。GitHub Release の配布物程度の
// 単純な ZIP（暗号化・分割なし）を読むための用途に限定する。

import zlib from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIR_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50

/** End Of Central Directory レコードの開始オフセットを末尾から探す（コメント付与に対応するため走査する） */
function findEocdOffset(buffer) {
  const minSize = 22
  for (let i = buffer.length - minSize; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error(
    'ZIP の End Of Central Directory が見つかりません（壊れたファイル、または未対応の形式）',
  )
}

/** @returns {{ name: string, method: number, compressedSize: number, localHeaderOffset: number }[]} */
export function listZipEntries(buffer) {
  const eocdOffset = findEocdOffset(buffer)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  let offset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = []
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`中央ディレクトリのシグネチャが不正です（offset=${offset}）`)
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readLocalFileData(buffer, entry) {
  const offset = entry.localHeaderOffset
  if (buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`ローカルファイルヘッダのシグネチャが不正です（${entry.name}）`)
  }
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(compressed)
  if (entry.method === 8) return zlib.inflateRawSync(compressed)
  throw new Error(
    `未対応の圧縮方式です（${entry.name}: method=${entry.method}）。store(0) と deflate(8) のみ対応`,
  )
}

/** ZIP バッファから指定ファイルを展開して返す。見つからなければエラーに候補一覧を含める */
export function readZipEntry(buffer, fileName) {
  const entries = listZipEntries(buffer)
  const entry = entries.find((e) => e.name === fileName)
  if (!entry) {
    throw new Error(
      `ZIP 内に "${fileName}" が見つかりません（存在するファイル: ${entries.map((e) => e.name).join(', ')}）`,
    )
  }
  return readLocalFileData(buffer, entry)
}
