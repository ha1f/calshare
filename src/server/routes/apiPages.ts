import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { MAX_INPUT_LENGTH } from '../../core/config/limits'
import { calculateExpiresAt } from '../../core/retention/calculateExpiresAt'
import { hashEditToken } from '../../core/token/hashEditToken'
import { fromEventFieldsJson, toEventFieldsJson } from '../../core/types'
import { validateEventFields } from '../../core/validate/validateEventFields'
import type { CreatePageRequest, CreatePageResponse } from '../../core/api/types'
import type { CreateSource, EventFields, EventFieldsJson } from '../../core/types'
import type { NewPageInput, PageRecord } from '../../ports/pageRepository'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { buildDeviceCookie } from '../lib/deviceCookie'
import { apiRequestError, validationApiError, toApiErrorResponse } from '../lib/errors'
import { buildDetailUrl, buildIcsForPage } from '../lib/ics'
import { readJsonBody } from '../middleware/jsonBody'
import {
  consumeCreateRateLimit,
  resolveRequestIdentity,
  type RequestIdentity,
} from '../middleware/rateLimit'
import { assertSameOriginJsonRequest } from '../middleware/sameOrigin'

const CREATE_SOURCES: CreateSource[] = ['direct', 'detail_cta', 'prefill']

/** ページ ID 衝突時に再採番するのは 1 回だけ（§4.2） */
const MAX_ID_CONFLICT_RETRIES = 1

function isCreateSource(value: unknown): value is CreateSource {
  return typeof value === 'string' && (CREATE_SOURCES as string[]).includes(value)
}

/** JSON.parse 直後の信頼できない値を CreatePageRequest の形に検査する。形式不正は例外にする（§5.7） */
function parseCreatePageRequest(json: unknown): CreatePageRequest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('request body must be a JSON object')
  }
  const { rawText, fields, source } = json as Record<string, unknown>
  if (typeof rawText !== 'string') throw new Error('rawText must be a string')
  if (typeof fields !== 'object' || fields === null) throw new Error('fields must be an object')
  if (!isCreateSource(source)) throw new Error('source must be one of direct/detail_cta/prefill')
  return { rawText, fields: fields as EventFieldsJson, source }
}

async function createPageWithRetry(
  deps: Deps,
  request: CreatePageRequest,
  fields: EventFields,
  identity: RequestIdentity,
  now: Date,
): Promise<{ page: PageRecord; editToken: string }> {
  const editToken = deps.ids.generateEditToken()
  const editTokenHash = await hashEditToken(editToken)
  const expiresAt = calculateExpiresAt([{ endAt: fields.end }], now)
  const eventId = deps.ids.generateUuid()

  for (let attempt = 0; attempt <= MAX_ID_CONFLICT_RETRIES; attempt++) {
    const id = deps.ids.generatePageId()
    const input: NewPageInput = {
      id,
      editTokenHash,
      rawText: request.rawText,
      event: { id: eventId, ...fields },
      expiresAt,
      source: request.source,
      creatorIpHash: identity.ipHash,
      creatorDeviceId: identity.deviceId,
      now,
    }
    const result = await deps.pages.create(input)
    if (result === 'ok') {
      const page = await deps.pages.findById(id)
      if (page === null) throw new Error(`page ${id} not found right after create`)
      return { page, editToken }
    }
  }
  throw apiRequestError(500, 'INTERNAL', 'failed to allocate a page id')
}

export function apiPagesRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.post('/api/pages', async (c) => {
    try {
      // (1) Content-Type と Origin（§5.7・§9.8）
      assertSameOriginJsonRequest(c.req.raw, deps.config.publicOrigin)

      // (2) 本文の byte 上限・JSON の形・rawText の長さ（§5.7）
      const request = await readJsonBody(c.req.raw, parseCreatePageRequest)
      if (request.rawText.length > MAX_INPUT_LENGTH) {
        throw validationApiError('INPUT_TOO_LONG')
      }

      // (3) レート制限（§9.3）。Cookie が無ければここで device_id を発行する
      const identity = await resolveRequestIdentity(c.req.raw, deps)
      if (identity.isNewDevice) {
        c.header('Set-Cookie', buildDeviceCookie(identity.deviceId))
      }
      const now = deps.clock.now()
      await consumeCreateRateLimit(deps, identity, now)

      // (4) 項目検証（§5.7）
      let fields: EventFields
      try {
        fields = fromEventFieldsJson(request.fields)
      } catch {
        throw apiRequestError(400, 'INVALID_REQUEST', 'invalid fields')
      }
      const validation = validateEventFields(request.rawText, fields, now, { mode: 'create' })
      if (!validation.ok) throw validationApiError(validation.code)

      const { page, editToken } = await createPageWithRetry(deps, request, fields, identity, now)

      // R2 の PUT 失敗はロールバックしない。GET /:id.ics の自己修復に任せる（§2.3）
      const ics = buildIcsForPage(page, deps.config, now)
      if (ics !== null) {
        try {
          await deps.storage.putIcs(page.id, ics)
        } catch (error) {
          deps.logger.error('create_page_put_ics_failed', { error, pageId: page.id })
        }
      }

      const response: CreatePageResponse = {
        id: page.id,
        url: buildDetailUrl(deps.config.publicOrigin, page.id),
        fields: toEventFieldsJson(page.event),
        expiresAt: page.expiresAt.toISOString(),
        createdAt: page.createdAt.toISOString(),
        updatedAt: page.updatedAt.toISOString(),
        version: page.version,
        editToken,
      }
      return c.json(response)
    } catch (error) {
      const { status, body } = toApiErrorResponse(error)
      return c.json(body, status as ContentfulStatusCode)
    }
  })

  return app
}
