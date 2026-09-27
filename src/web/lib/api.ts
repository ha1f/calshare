import type {
  ApiError,
  CreatePageRequest,
  CreatePageResponse,
  GetPageResponse,
  UpdatePageRequest,
  UpdatePageResponse,
} from '../../core/api/types'
import { API_REQUEST_TIMEOUT_MS } from '../../core/config/limits'

/** 作成・取得・更新・通報 API が 2xx 以外を返したとき、またはタイムアウトしたときに投げる。呼び出し側は code でエラー文言を出し分ける（§5.7） */
export class ApiRequestFailedError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiError['code'],
    operation: string,
  ) {
    super(`${operation} request failed: ${code}`)
  }
}

/** `AbortSignal.timeout` 未対応環境（Safari / WKWebView の旧版）では signal なしで fetch を続ける */
function timeoutSignal(): AbortSignal | null {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)
    : null
}

/**
 * `AbortSignal.timeout` 付きで fetch する。タイムアウト・中断は `ApiRequestFailedError` に変換する。
 * 作成・取得・更新・通報のすべての fetch がここを通る
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: timeoutSignal() })
  } catch (error) {
    const isTimeoutOrAbort =
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    if (isTimeoutOrAbort) throw new ApiRequestFailedError(0, 'INTERNAL', operation)
    throw error
  }
}

async function readApiError(response: Response, operation: string): Promise<ApiRequestFailedError> {
  try {
    const body = (await response.json()) as ApiError
    return new ApiRequestFailedError(response.status, body.code, operation)
  } catch {
    return new ApiRequestFailedError(response.status, 'INTERNAL', operation)
  }
}

/** 作成 API を呼ぶ（§6.1）。同一オリジンの fetch なので Content-Type だけ指定すればよい（§9.8） */
export async function createPage(request: CreatePageRequest): Promise<CreatePageResponse> {
  const response = await fetchWithTimeout(
    '/api/pages',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
    'create page',
  )
  if (!response.ok) throw await readApiError(response, 'create page')
  return (await response.json()) as CreatePageResponse
}

/** 編集画面の初期値を取得する（§11.5）。トークンは URL に載せず Authorization ヘッダで送る（§3.3） */
export async function getPage(id: string, editToken: string): Promise<GetPageResponse> {
  const response = await fetchWithTimeout(
    `/api/pages/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${editToken}` } },
    'get page',
  )
  if (!response.ok) throw await readApiError(response, 'get page')
  return (await response.json()) as GetPageResponse
}

/** 編集内容を保存する（§11.5）。トークンが一致しなければ 401 になる（§3.3、§4.1） */
export async function updatePage(
  id: string,
  editToken: string,
  request: UpdatePageRequest,
): Promise<UpdatePageResponse> {
  const response = await fetchWithTimeout(
    `/api/pages/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${editToken}`,
      },
      body: JSON.stringify(request),
    },
    'update page',
  )
  if (!response.ok) throw await readApiError(response, 'update page')
  return (await response.json()) as UpdatePageResponse
}
