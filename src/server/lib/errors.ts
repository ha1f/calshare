import { InvariantViolation } from '../../ports/pageRepository'
import type { ApiError, ApiErrorCode } from '../../core/api/types'
import type { ValidationErrorCode } from '../../core/types'

/** ルートが意図的に返す API エラー。HTTP ステータスと ApiErrorCode を持つ（§5.7） */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export function apiRequestError(
  status: number,
  code: ApiErrorCode,
  message: string,
): ApiRequestError {
  return new ApiRequestError(status, code, message)
}

const VALIDATION_MESSAGES: Record<ValidationErrorCode, string> = {
  EMPTY_INPUT: 'rawText or title is empty',
  INPUT_TOO_LONG: 'input exceeds the maximum length',
  INVALID_RANGE: 'start/end range is invalid',
  PAST_EVENT: 'event date/time is in the past',
  BEYOND_MAX_LEAD_TIME: 'event date/time is beyond the max lead time',
  TOO_MANY_URLS: 'too many URLs',
}

/** core/validate/validateEventFields の結果コードを ApiRequestError（400）に変換する（§5.7） */
export function validationApiError(code: ValidationErrorCode): ApiRequestError {
  return apiRequestError(400, code, VALIDATION_MESSAGES[code])
}

/**
 * ルートハンドラで catch した例外を { status, body } に変換する。`ApiRequestError` はそのまま、
 * `InvariantViolation` を含むそれ以外の例外は 500 `INTERNAL` にする
 */
export function toApiErrorResponse(error: unknown): { status: number; body: ApiError } {
  if (error instanceof ApiRequestError) {
    return { status: error.status, body: { code: error.code, message: error.message } }
  }
  if (error instanceof InvariantViolation) {
    return { status: 500, body: { code: 'INTERNAL', message: 'internal error' } }
  }
  return { status: 500, body: { code: 'INTERNAL', message: 'internal error' } }
}
