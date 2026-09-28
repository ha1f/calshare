import { Hono } from 'hono'
import {
  MAX_REPORT_COMMENT_LENGTH,
  RATE_LIMITS,
  REPORT_DEDUPE_HOURS,
} from '../../core/config/limits'
import { PAGE_ID_PATTERN } from '../../core/id/crockford'
import type { CreateReportRequest, CreateReportResponse } from '../../core/api/types'
import type { ReportReason } from '../../core/types'
import type { NewReportInput } from '../../ports/reportRepository'
import type { RateLimitRule } from '../../ports/rateLimiter'
import type { Deps } from '../deps'
import type { Env } from '../env'
import { apiRequestError, validationApiError } from '../lib/errors'
import { buildDetailUrl } from '../lib/ics'
import { isServable } from '../lib/pageAccess'
import { readJsonBody } from '../middleware/jsonBody'
import { resolveIpHash } from '../middleware/rateLimit'
import { assertSameOriginJsonRequest } from '../middleware/sameOrigin'

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

  app.post(`/api/pages/:id{${PAGE_ID_PATTERN}}/reports`, async (c) => {
    // (1) Content-Type と Origin（§5.7・§9.8）
    assertSameOriginJsonRequest(c.req.raw, deps.config.publicOrigin)

    // (2) 本文の byte 上限・JSON の形・comment の長さ（§5.7）
    const request = await readJsonBody(c.req.raw, parseCreateReportRequest)
    if ((request.comment?.length ?? 0) > MAX_REPORT_COMMENT_LENGTH) {
      throw validationApiError('INPUT_TOO_LONG')
    }

    // (3) レート制限（§9.3）。resolveIpHash はページ検索より先に走るため、pepper が無ければ
    // 存在しないページへの通報も (4) の 404 ではなく 503 になる
    const reporterIpHash = await resolveIpHash(c.req.raw, deps)
    const now = deps.clock.now()
    await consumeReportRateLimit(deps, reporterIpHash, now)

    // (4) hidden／期限切れ／存在しない ID は 404（区別させない、§4.1）。形式が不正な ID は
    // PAGE_ID_PATTERN 制約でこのルートに一致せず、ここには来ない
    const pageId = c.req.param('id')
    const page = await deps.pages.findById(pageId)
    if (page === null || !isServable(page, now)) {
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
    if (result.kind === 'inserted') {
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
            reportCount: result.reportCount,
            activePagesFromSameCreator,
          })
          .catch((error: unknown) => {
            deps.logger.error('report_notify_failed', { error, pageId: page.id })
          }),
      )
    }

    const response: CreateReportResponse = { ok: true }
    return c.json(response)
  })

  return app
}
