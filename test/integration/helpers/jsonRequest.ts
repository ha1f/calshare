// wrangler.jsonc の vars.PUBLIC_ORIGIN と一致させる
export const TEST_ORIGIN = 'http://localhost:8787'

export interface JsonRequestOptions {
  method: 'POST' | 'PATCH'
  body: unknown
  /** Origin 不一致や text/plain のテスト用に既定のヘッダを上書きできる */
  headers?: Record<string, string>
}

export function jsonRequest(path: string, options: JsonRequestOptions): Request {
  const url = new URL(path, TEST_ORIGIN)
  const headers = {
    Origin: TEST_ORIGIN,
    'Content-Type': 'application/json',
    ...options.headers,
  }
  return new Request(url, {
    method: options.method,
    headers,
    body: JSON.stringify(options.body),
  })
}

/** ApiError の code だけを取り出す。Response#json() の戻り値が unknown 型のため */
export async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code
}
