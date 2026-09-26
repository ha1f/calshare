import type { PageRecord } from '../../ports/pageRepository'

/**
 * hidden または期限切れのページを「存在しない」として扱う（§4.1）。`findById` を呼ぶ全ルートがこれを通し、
 * `status = 'hidden'` と期限切れを区別せず 404 と同じ応答にする（ページの存在自体を推測させない）
 */
export function isServable(page: PageRecord, now: Date): boolean {
  return page.status === 'active' && page.expiresAt > now
}
