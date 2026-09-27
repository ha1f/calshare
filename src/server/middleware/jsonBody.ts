import { MAX_BODY_BYTES } from '../../core/config/limits'
import { apiRequestError } from '../lib/errors'

/**
 * 本文を上限（`MAX_BODY_BYTES`）まで読む。`Content-Length` があればボディを読まずに弾き、
 * 無い（chunked）場合は読みながら累積量を数え、超えた時点で打ち切る。エッジが許す最大本文で
 * isolate のメモリを圧迫しないため、上限判定に本文全体の読み込みは要らない
 */
async function readBodyWithLimit(request: Request): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array(0)

  // Workers の型定義では Request.body が ReadableStream<any> になっており、getReader() の戻り値も any 化する
  const reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      throw apiRequestError(400, 'INVALID_REQUEST', 'request body is too large')
    }
    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/**
 * 本文の byte 上限（§5.7 の (2)）を検査してから JSON をパースし、`parse` で形を検証する。
 * `parse` が投げた例外のメッセージは `INVALID_REQUEST` の message にそのまま使う
 */
export async function readJsonBody<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    throw apiRequestError(400, 'INVALID_REQUEST', 'request body is too large')
  }

  const bytes = await readBodyWithLimit(request)

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw apiRequestError(400, 'INVALID_REQUEST', 'malformed JSON')
  }

  try {
    return parse(json)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid request shape'
    throw apiRequestError(400, 'INVALID_REQUEST', message)
  }
}
