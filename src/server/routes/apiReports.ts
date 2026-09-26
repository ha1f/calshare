import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  MAX_REPORT_COMMENT_LENGTH,
  RATE_LIMITS,
  REPORT_DEDUPE_HOURS,
} from '../../core/config/limits'
import type { CreateReportRequest } from '../../core/api/types'
import type { ReportReason } from '../../core/types'
import type { NewReportInput } from '../../ports/reportRepository'
import type { RateLimitRule } from '../../ports/rateLimiter'
import type { Deps } from '../deps'
import type { Env } from '../env'
import {
  apiRequestError,
  ApiRequestError,
  toApiErrorResponse,
  validationApiError,
} from '../lib/errors'
import { buildDetailUrl } from '../lib/ics'
import { ipHash } from '../lib/ipHash'
import { readJsonBody } from '../middleware/jsonBody'
import { assertSameOriginJsonRequest } from '../middleware/sameOrigin'
import { isReportTargetServable } from './reportPage'

const REPORT_REASONS: ReportReason[] = ['spam', 'personal_info', 'inappropriate', 'other']

function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as string[]).includes(value)
}

/** JSON.parse 直後の信頼できない値を検査する。形式不正は例外にする（§5.7 の (2)） */
function parseCreateReportRequest(json: unknown): CreateReportRequest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('request body must be a JSON object')
  }
  const { reason, comment } = json as Record<string, unknown>
  if (!isReportReason(reason)) {
    throw new Error('reason must be one of spam/personal_info/inappropriate/other')
  }
  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    throw new Error('comment must be a string or null')
  }
  // comment は任意項目（§9.4）。キー省略・空文字は「無し」として null に揃える
  const normalizedComment = comment === undefined || comment === '' ? null : comment
  return { reason, comment: normalizedComment }
}

/**
 * `report` スコープのレート制限を消費する（§9.3）。report は device バケットを持たず IP のみ
 */
async function consumeReportRateLimit(deps: Deps, ipHashValue: string, now: Date): Promise<void> {
  const rules: RateLimitRule[] = [
    {
      scope: 'report',
      bucketKey: `ip:${ipHashValue}`,
      window: 'hour',
      limit: RATE_LIMITS.report.ipPerHour,
    },
    {
      scope: 'report',
      bucketKey: `ip:${ipHashValue}`,
      window: 'day',
      limit: RATE_LIMITS.report.ipPerDay,
    },
  ]
  const result = await deps.rateLimiter.consume(rules, now)
  if (!result.allowed) {
    deps.logger.warn('rate_limited', {
      scope: 'report',
      exceeded: result.exceeded.map((rule) => ({
        bucket: rule.bucketKey.split(':')[0],
        window: rule.window,
      })),
    })
    throw apiRequestError(429, 'RATE_LIMITED', 'rate limit exceeded')
  }
}

export function apiReportsRoutes(deps: Deps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.post('/api/pages/:id/reports', async (c) => {
    try {
      // (1) Content-Type と Origin（§5.7・§9.8）
      assertSameOriginJsonRequest(c.req.raw, deps.config.publicOrigin)

      // (2) 本文の byte 上限・JSON の形・comment の長さ（§5.7）
      const request = await readJsonBody(c.req.raw, parseCreateReportRequest)
      if ((request.comment?.length ?? 0) > MAX_REPORT_COMMENT_LENGTH) {
        throw validationApiError('INPUT_TOO_LONG')
      }

      // (3) レート制限（§9.3）。本番で IP が取れなければ warn（middleware/rateLimit.ts の
      // resolveRequestIdentity と同じ判定）
      const rawIp = c.req.raw.headers.get('CF-Connecting-IP')
      if (!rawIp && new URL(deps.config.publicOrigin).hostname !== 'localhost') {
        deps.logger.warn('ip_unknown', {})
      }
      const reporterIpHash = await ipHash(rawIp, deps.config.ratePepper)
      const now = deps.clock.now()
      await consumeReportRateLimit(deps, reporterIpHash, now)

      // (4) hidden／期限切れ／不正 ID は 404（存在しないページと区別させない、§4.1）
      const pageId = c.req.param('id')
      const page = await deps.pages.findById(pageId)
      if (page === null || !isReportTargetServable(page, now)) {
        throw apiRequestError(404, 'NOT_FOUND', 'page not found')
      }

      const reportInput: NewReportInput = {
        id: deps.ids.generateUuid(),
        pageId: page.id,
        reason: request.reason,
        comment: request.comment,
        ipHash: reporterIpHash,
        now,
      }
      const dedupeSince = new Date(now.getTime() - REPORT_DEDUPE_HOURS * 60 * 60 * 1000)
      const result = await deps.reports.insertIfNotDuplicate(reportInput, dedupeSince)

      // 重複でも受理と同じ 200 を返し、通報者に重複だったかを知らせない（§9.4）
      if (result === 'inserted') {
        const reportCount = await deps.pages.incrementReportCount(page.id)
        const activePagesFromSameCreator = await deps.pages.countActiveByCreator(
          page.creatorIpHash,
          page.creatorDeviceId,
        )
        c.executionCtx.waitUntil(
          deps.notifier
            .notifyReport({
              pageId: page.id,
              url: buildDetailUrl(deps.config.publicOrigin, page.id),
              reason: request.reason,
              comment: request.comment,
              reportCount,
              activePagesFromSameCreator,
            })
            .catch((error: unknown) => {
              deps.logger.error('report_notify_failed', { error, pageId: page.id })
            }),
        )
      }

      return c.json({ ok: true })
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status >= 500) {
        deps.logger.error('create_report_failed', { error })
      }
      const { status, body } = toApiErrorResponse(error)
      return c.json(body, status as ContentfulStatusCode)
    }
  })

  return app
}
