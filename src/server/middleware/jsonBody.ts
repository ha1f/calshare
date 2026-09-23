import { MAX_BODY_BYTES } from '../../core/config/limits'
import { apiRequestError } from '../lib/errors'

/**
 * 本文の byte 上限（§5.7 の (2)）を検査してから JSON をパースし、`parse` で形を検証する。
 * `parse` が投げた例外のメッセージは `INVALID_REQUEST` の message にそのまま使う
 */
export async function readJsonBody<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  const buffer = await request.arrayBuffer()
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw apiRequestError(400, 'INVALID_REQUEST', 'request body is too large')
  }

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(buffer))
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
