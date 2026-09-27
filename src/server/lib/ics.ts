import { buildIcs } from '../../core/ics/buildIcs'
import type { IcsInput } from '../../core/ics/buildIcs'
import type { PageRecord } from '../../ports/pageRepository'
import type { Deps } from '../deps'

export const ICS_EXTENSION = '.ics'

/** 詳細ページの絶対 URL を組む（§9.9）。`request.url` / `Host` は使わず `config.publicOrigin` から組む */
export function buildDetailUrl(publicOrigin: string, pageId: string): string {
  return new URL(`/${pageId}`, publicOrigin).toString()
}

/**
 * PageRecord と config から ics 文字列を組む（§7.2）。日時の無い下書きは ics を持たないので null を返す。
 * 作成・更新・自己修復で共用する
 */
export function buildIcsForPage(
  page: PageRecord,
  config: Deps['config'],
  generatedAt: Date,
): string | null {
  const { event } = page
  if (event.start === null || event.end === null) return null

  const input: IcsInput = {
    uid: `${event.id}@${config.publicHost}`,
    title: event.title,
    location: event.location,
    memo: event.memo,
    start: event.start,
    end: event.end,
    isAllDay: event.isAllDay,
    sequence: page.version - 1,
    generatedAt,
    detailUrl: buildDetailUrl(config.publicOrigin, page.id),
  }
  return buildIcs(input)
}
