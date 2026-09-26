import { describe, expect, it } from 'vitest'
import type { ApiErrorCode } from '../../../../src/core/api/types'
import { apiErrorMessage, VALIDATION_MESSAGES } from '../../../../src/web/lib/messages'

describe('apiErrorMessage', () => {
  it('バリデーションエラーコードは VALIDATION_MESSAGES の文言を返す', () => {
    expect(apiErrorMessage('PAST_EVENT')).toBe(VALIDATION_MESSAGES.PAST_EVENT)
  })

  it('RATE_LIMITED は共通の文言を返す', () => {
    expect(apiErrorMessage('RATE_LIMITED')).toBe('しばらく時間をおいてから試してください')
  })

  it('該当しないコードはフォールバック文言を返す', () => {
    expect(apiErrorMessage('INTERNAL')).toBe(
      'エラーが発生しました。しばらくしてからやり直してください',
    )
  })

  it('overrides に指定したコードはそちらを優先する（編集画面固有の文言）', () => {
    expect(apiErrorMessage('UNAUTHORIZED', { UNAUTHORIZED: '編集トークンが無効です' })).toBe(
      '編集トークンが無効です',
    )
  })

  it('overrides に無いコードは通常どおりフォールバックする', () => {
    expect(apiErrorMessage('NOT_FOUND', { UNAUTHORIZED: '編集トークンが無効です' })).toBe(
      'エラーが発生しました。しばらくしてからやり直してください',
    )
  })

  it('Object.prototype のキーに一致するコードでもプロトタイプの値を返さない', () => {
    expect(apiErrorMessage('constructor' as ApiErrorCode)).toBe(
      'エラーが発生しました。しばらくしてからやり直してください',
    )
    expect(apiErrorMessage('toString' as ApiErrorCode, {})).toBe(
      'エラーが発生しました。しばらくしてからやり直してください',
    )
  })

  it('overrides のコードが undefined の場合は通常どおりフォールバックする', () => {
    expect(apiErrorMessage('UNAUTHORIZED', { UNAUTHORIZED: undefined })).toBe(
      'エラーが発生しました。しばらくしてからやり直してください',
    )
  })
})
