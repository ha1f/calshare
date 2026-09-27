import { Hono } from 'hono'
import { MAX_INPUT_LENGTH } from '../../core/config/limits'
import { buildChangeSnapshot } from '../../core/change/buildChangeSnapshot'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import { calculateExpiresAt } from '../../core/retention/calculateExpiresAt'
import { hashEditToken } from '../../core/token/hashEditToken'
import { verifyEditTokenHash } from '../../core/token/verifyEditToken'
import { fromEventFieldsJson, toEventFieldsJson } from '../../core/types'
import type { EventFields, EventFieldsJson } from '../../core/types'
import { validateEventFields } from '../../core/validate/validateEventFields'
import type { GetPageResponse, UpdatePageResponse } from '../../core/api/types'
import type { PageSummaryJson } from '../../core/types'
import type { PageRecord } from '../../ports/pageRepository'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { apiRequestError, validationApiError } from '../lib/errors'
import { buildDetailUrl, buildIcsForPage } from '../lib/ics'
import { isServable } from '../lib/pageAccess'
import { readJsonBody } from '../middleware/jsonBody'
import { assertSameOriginJsonRequest } from '../middleware/sameOrigin'

/** `Authorization: Bearer <token>` からトークンを取り出す。無い・形式違いは null（§3.3） */
function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (header === null) return null
  const match = /^Bearer (.+)$/.exec(header)
  return match?.[1] ?? null
}

/** 編集トークンがページの edit_token_hash と一致するか定数時間で比較する（§3.3） */
async function isAuthorized(page: PageRecord, token: string | null): Promise<boolean> {
  if (token === null) return false
  return verifyEditTokenHash(await hashEditToken(token), page.editTokenHash)
}

/** GET・PATCH のレスポンスで共通の公開情報部分（§11.3 PageSummaryJson） */
function toSummaryJson(page: PageRecord, publicOrigin: string): PageSummaryJson {
  return {
    id: page.id,
    url: buildDetailUrl(publicOrigin, page.id),
    fields: toEventFieldsJson(page.event),
    expiresAt: page.expiresAt.toISOString(),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    version: page.version,
  }
}

interface ParsedUpdatePageRequest {
  rawText: string
  fields: EventFields
}

/**
 * JSON.parse 直後の信頼できない値を検査し、fields も core の形（EventFields）まで変換する。
 * 形式不正は例外にする（apiPages.ts の parseCreatePageRequest と同じ契約。source が無い点だけが違う）
 */
function parseUpdatePageRequest(json: unknown): ParsedUpdatePageRequest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('request body must be a JSON object')
  }
  const { rawText, fields } = json as Record<string, unknown>
  if (typeof rawText !== 'string') throw new Error('rawText must be a string')
  if (typeof fields !== 'object' || fields === null) throw new Error('fields must be an object')
  return { rawText, fields: fromEventFieldsJson(fields as EventFieldsJson) }
}

export function apiPagesEditRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get(`/api/pages/:id{${PAGE_ID_PATTERN}}`, async (c) => {
    const page = await deps.pages.findById(c.req.param('id'))
    const now = deps.clock.now()
    if (page === null || !isServable(page, now)) {
      throw apiRequestError(404, 'NOT_FOUND', 'page not found')
    }

    const token = extractBearerToken(c.req.raw)
    if (!(await isAuthorized(page, token))) {
      throw apiRequestError(401, 'UNAUTHORIZED', 'edit token is missing or invalid')
    }

    const response: GetPageResponse = {
      ...toSummaryJson(page, deps.config.publicOrigin),
      rawText: page.rawText,
    }
    return c.json(response)
  })

  app.patch(`/api/pages/:id{${PAGE_ID_PATTERN}}`, async (c) => {
    // (1) Content-Type と Origin（§5.7・§9.8）
    assertSameOriginJsonRequest(c.req.raw, deps.config.publicOrigin)

    // (2) 本文の byte 上限・JSON の形・fields の形・rawText の長さ（§5.7）
    const request = await readJsonBody(c.req.raw, parseUpdatePageRequest)
    if (request.rawText.length > MAX_INPUT_LENGTH) {
      throw validationApiError('INPUT_TOO_LONG')
    }

    // 更新 API に対応するレート制限 scope は無い（RateLimitScope・RATE_LIMITS に 'update' が無い。§9.3）ので消費しない
    const page = await deps.pages.findById(c.req.param('id'))
    const now = deps.clock.now()
    if (page === null || !isServable(page, now)) {
      throw apiRequestError(404, 'NOT_FOUND', 'page not found')
    }

    const token = extractBearerToken(c.req.raw)
    if (!(await isAuthorized(page, token))) {
      throw apiRequestError(401, 'UNAUTHORIZED', 'edit token is missing or invalid')
    }

    // (4) 項目検証（§5.7）。日時が previous と不変なら PAST_EVENT は検証しない
    const validation = validateEventFields(request.rawText, request.fields, now, {
      mode: 'update',
      previous: page.event,
    })
    if (!validation.ok) throw validationApiError(validation.code)

    const previousSnapshot = buildChangeSnapshot(page.event, request.fields)
    // baseDate は更新時は now（§3.2）。作成から日が経ったページで日時を消しても即座に期限切れにしないため
    const expiresAt = calculateExpiresAt([{ endAt: request.fields.end }], now)

    const result = await deps.pages.update(page.id, {
      rawText: request.rawText,
      event: request.fields,
      expiresAt,
      previousSnapshot,
      now,
    })
    if (result === 'not_found') {
      throw apiRequestError(404, 'NOT_FOUND', 'page not found')
    }

    const updated = await deps.pages.findById(page.id)
    if (updated === null) throw new Error(`page ${page.id} not found right after update`)

    // R2 の PUT 失敗はロールバックしない（作成 API と同じ方針。§2.3）
    const ics = buildIcsForPage(updated, deps.config, now)
    if (ics !== null) {
      try {
        await deps.storage.putIcs(updated.id, ics)
      } catch (error) {
        deps.logger.error('update_page_put_ics_failed', { error, pageId: updated.id })
      }
    }

    const response: UpdatePageResponse = toSummaryJson(updated, deps.config.publicOrigin)
    return c.json(response)
  })

  return app
}
