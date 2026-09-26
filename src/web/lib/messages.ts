import type { ApiErrorCode } from '../../core/api/types'
import type { ValidationErrorCode } from '../../core/types'

/** バリデーションエラーコードごとの文言（§5.7） */
export const VALIDATION_MESSAGES: Record<ValidationErrorCode, string> = {
  EMPTY_INPUT: '予定を書いてください',
  INPUT_TOO_LONG: '長すぎます（2,000文字まで）',
  INVALID_RANGE: '終了は開始より後にしてください',
  PAST_EVENT: '過去の日時です',
  BEYOND_MAX_LEAD_TIME: '作成できるのは13ヶ月先までです',
  TOO_MANY_URLS: 'リンクは3つまでです',
}

/**
 * API のエラーコードを画面に出す文言に変換する。`overrides` は画面固有の文言（編集画面の
 * `UNAUTHORIZED` `NOT_FOUND` 等）を割り込ませるためのもので、無いコードは通常どおりに解決する
 */
export function apiErrorMessage(
  code: ApiErrorCode,
  overrides: Partial<Record<ApiErrorCode, string>> = {},
): string {
  if (Object.hasOwn(overrides, code)) {
    const override = overrides[code]
    if (override !== undefined) return override
  }
  if (code === 'RATE_LIMITED') return 'しばらく時間をおいてから試してください'
  if (Object.hasOwn(VALIDATION_MESSAGES, code)) {
    return VALIDATION_MESSAGES[code as ValidationErrorCode]
  }
  return 'エラーが発生しました。しばらくしてからやり直してください'
}
