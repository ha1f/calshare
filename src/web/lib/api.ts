import type { ApiError, CreatePageRequest, CreatePageResponse } from '../../core/api/types'

/** POST /api/pages が 2xx 以外を返したときに投げる。呼び出し側は code でエラー文言を出し分ける（§5.7） */
export class ApiRequestFailedError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiError['code'],
  ) {
    super(`create page request failed: ${code}`)
  }
}

async function readApiError(response: Response): Promise<ApiRequestFailedError> {
  try {
    const body = (await response.json()) as ApiError
    return new ApiRequestFailedError(response.status, body.code)
  } catch {
    return new ApiRequestFailedError(response.status, 'INTERNAL')
  }
}

/** 作成 API を呼ぶ（§6.1）。同一オリジンの fetch なので Content-Type だけ指定すればよい（§9.8） */
export async function createPage(request: CreatePageRequest): Promise<CreatePageResponse> {
  const response = await fetch('/api/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as CreatePageResponse
}
