import type {
  CreateSource,
  EventFieldsJson,
  PageSummaryJson,
  ReportReason,
  ValidationErrorCode,
} from '../types'

// Date は ISO8601 文字列
export interface CreatePageRequest {
  rawText: string
  fields: EventFieldsJson
  source: CreateSource
}
export interface CreatePageResponse extends PageSummaryJson {
  editToken: string
}
/** GET /api/pages/:id。Bearer 必須なので公開情報ではない rawText を含む（§6.5） */
export type GetPageResponse = PageSummaryJson & { rawText: string }
export interface UpdatePageRequest {
  rawText: string
  fields: EventFieldsJson
}
export type UpdatePageResponse = PageSummaryJson
export interface CreateReportRequest {
  reason: ReportReason
  comment: string | null
}
export type ApiErrorCode =
  | ValidationErrorCode
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FORBIDDEN_ORIGIN'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INTERNAL'
export interface ApiError {
  code: ApiErrorCode
  message: string
}
/** GET /api/health（§11.7） */
export interface HealthResponse {
  ok: true
}
