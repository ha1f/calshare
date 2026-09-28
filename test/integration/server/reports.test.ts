import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createD1PageRepository } from '../../../src/adapters/d1/d1PageRepository'
import { createD1ReportRepository } from '../../../src/adapters/d1/d1ReportRepository'
import { createFakeNotifier } from '../../../src/adapters/notifier/fakeNotifier'
import { RATE_LIMITS, REPORT_DEDUPE_HOURS, UNKNOWN_IP_HASH } from '../../../src/core/config/limits'
import type { CreatePageRequest, CreatePageResponse } from '../../../src/core/api/types'
import type { NewPageInput, PageRecord, PageRepository } from '../../../src/ports/pageRepository'
import { createApp } from '../../../src/server/app'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { errorCode, jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'

// buildFakeDeps の clock（fakeClock）が固定する現在時刻
const NOW = new Date('2026-09-16T01:00:00.000Z')

function pageInput(overrides: Partial<NewPageInput> = {}): NewPageInput {
  return {
    id: 'page00000001',
    editTokenHash: 'hash',
    rawText: '9/20 19時 渋谷で飲み会',
    event: {
      id: 'event00000001',
      title: '飲み会',
      location: '渋谷',
      memo: null,
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
    },
    expiresAt: new Date('2026-09-27T11:00:00.000Z'),
    source: 'direct',
    creatorIpHash: 'creator-ip-hash',
    creatorDeviceId: 'creator-device-id',
    now: NOW,
    ...overrides,
  }
}

function postReport(pageId: string, body: unknown, headers?: Record<string, string>) {
  return jsonRequest(`/api/pages/${pageId}/reports`, { method: 'POST', body, headers })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return { reason: 'spam', comment: 'これはスパムです', ...overrides }
}

/** 実行コンテキストを渡して fetch し、waitUntil された Promise の完了を待つ */
async function fetchAndDrain(
  app: ReturnType<typeof createApp>,
  request: Request,
): Promise<Response> {
  const ctx = createExecutionContext()
  const res = await app.fetch(request, {}, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

describe('POST /api/pages/:id/reports', () => {
  it('正常系: reports に 1 行追加され、report_count が +1 になり、Notifier が呼ばれる', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({
      pages: createD1PageRepository(env.DB),
      reports: createD1ReportRepository(env.DB),
      notifier,
    })
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await fetchAndDrain(app, postReport('page00000001', validBody()))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const rows = await env.DB.prepare('SELECT * FROM reports WHERE page_id = ?')
      .bind('page00000001')
      .all()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0]).toMatchObject({ reason: 'spam', comment: 'これはスパムです' })

    const page = await deps.pages.findById('page00000001')
    expect(page?.reportCount).toBe(1)

    expect(notifier.calls).toHaveLength(1)
    expect(notifier.calls[0]).toMatchObject({
      pageId: 'page00000001',
      url: `${TEST_ORIGIN}/page00000001`,
      reason: 'spam',
      comment: 'これはスパムです',
      reportCount: 1,
      activePagesFromSameCreator: 1,
    })
  })

  it('activePagesFromSameCreator は同一 ip_hash または同一 device_id の有効ページ数（通報対象自身を含む）', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({ notifier })
    // 通報対象。ip:shared-ip / device:shared-device
    await deps.pages.create(
      pageInput({
        id: 'page00000001',
        event: { ...pageInput().event, id: 'event00000001' },
        creatorIpHash: 'shared-ip',
        creatorDeviceId: 'shared-device',
      }),
    )
    // 同一 device・別 IP
    await deps.pages.create(
      pageInput({
        id: 'page00000002',
        event: { ...pageInput().event, id: 'event00000002' },
        creatorIpHash: 'other-ip-1',
        creatorDeviceId: 'shared-device',
      }),
    )
    // 同一 IP・別 device
    await deps.pages.create(
      pageInput({
        id: 'page00000003',
        event: { ...pageInput().event, id: 'event00000003' },
        creatorIpHash: 'shared-ip',
        creatorDeviceId: 'other-device-1',
      }),
    )
    // 無関係な送信元
    await deps.pages.create(
      pageInput({
        id: 'page00000004',
        event: { ...pageInput().event, id: 'event00000004' },
        creatorIpHash: 'other-ip-2',
        creatorDeviceId: 'other-device-2',
      }),
    )
    const app = createApp(deps)

    await fetchAndDrain(app, postReport('page00000001', validBody()))

    expect(notifier.calls[0]?.activePagesFromSameCreator).toBe(3)
  })

  it('CF-Connecting-IP 無しで作られたページどうしは、device_id が違えば同一送信元として数えない', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({
      pages: createD1PageRepository(env.DB),
      reports: createD1ReportRepository(env.DB),
      notifier,
    })
    const app = createApp(deps)
    const createBody: CreatePageRequest = {
      rawText: '9/20 19時 渋谷で飲み会',
      fields: {
        title: '飲み会',
        location: '渋谷',
        memo: null,
        start: '2026-09-20T10:00:00.000Z',
        end: '2026-09-20T11:00:00.000Z',
        isAllDay: false,
      },
      source: 'direct',
    }
    // Cookie も付けないので、呼ぶたびに別の device_id で作られる
    const createPage = async () => {
      const res = await fetchAndDrain(
        app,
        jsonRequest('/api/pages', { method: 'POST', body: createBody }),
      )
      expect(res.status).toBe(200)
      return (await res.json<CreatePageResponse>()).id
    }
    const reportedPageId = await createPage()
    const otherPageId = await createPage()
    const reportedPage = await deps.pages.findById(reportedPageId)
    const otherPage = await deps.pages.findById(otherPageId)
    expect(reportedPage?.creatorIpHash).toBe(UNKNOWN_IP_HASH)
    expect(otherPage?.creatorIpHash).toBe(UNKNOWN_IP_HASH)
    expect(otherPage?.creatorDeviceId).not.toBe(reportedPage?.creatorDeviceId)

    await fetchAndDrain(app, postReport(reportedPageId, validBody()))

    expect(notifier.calls[0]?.activePagesFromSameCreator).toBe(1)
  })

  it('reason が列挙値に無ければ 400 INVALID_REQUEST', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await fetchAndDrain(
      app,
      postReport('page00000001', validBody({ reason: 'not_a_reason' })),
    )

    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('INVALID_REQUEST')
  })

  it('comment が 501 文字なら 400 INPUT_TOO_LONG', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await fetchAndDrain(
      app,
      postReport('page00000001', validBody({ comment: 'a'.repeat(501) })),
    )

    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('INPUT_TOO_LONG')
  })

  it('comment が null でも 200（任意項目）', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await fetchAndDrain(app, postReport('page00000001', validBody({ comment: null })))

    expect(res.status).toBe(200)
  })

  it('comment キーを省略しても 200 になり、Notifier には null で渡る', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({ notifier })
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    // JSON.stringify は値が undefined のキーを落とすので、これで「comment キー無し」を再現する
    const res = await fetchAndDrain(
      app,
      postReport('page00000001', validBody({ comment: undefined })),
    )

    expect(res.status).toBe(200)
    expect(notifier.calls[0]?.comment).toBeNull()
  })

  it('comment が空文字列なら null として保存される', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({ notifier })
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await fetchAndDrain(app, postReport('page00000001', validBody({ comment: '' })))

    expect(res.status).toBe(200)
    expect(notifier.calls[0]?.comment).toBeNull()
  })

  it('同一 ip_hash・同一ページの 24 時間以内の重複は無視され、report_count も Notifier 呼び出しも増えない', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({ notifier })
    await deps.pages.create(pageInput())
    const app = createApp(deps)
    const ip = { 'CF-Connecting-IP': '203.0.113.5' }

    const first = await fetchAndDrain(app, postReport('page00000001', validBody(), ip))
    const second = await fetchAndDrain(app, postReport('page00000001', validBody(), ip))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // 重複でも受理と同じ本文を返し、通報者に重複だったかを知らせない（§9.4）
    expect(await second.json()).toEqual({ ok: true })
    const page = await deps.pages.findById('page00000001')
    expect(page?.reportCount).toBe(1)
    expect(notifier.calls).toHaveLength(1)
  })

  it('24 時間の重複排除ウィンドウの境界: 経過前は重複のまま、経過後は新規に受理される', async () => {
    const clock = fakeClock(NOW)
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({ clock, notifier })
    await deps.pages.create(pageInput())
    const app = createApp(deps)
    const ip = { 'CF-Connecting-IP': '203.0.113.99' }
    const dedupeWindowMs = REPORT_DEDUPE_HOURS * 60 * 60 * 1000

    await fetchAndDrain(app, postReport('page00000001', validBody(), ip))

    clock.set(new Date(NOW.getTime() + dedupeWindowMs - 1))
    const stillDuplicate = await fetchAndDrain(app, postReport('page00000001', validBody(), ip))
    expect(stillDuplicate.status).toBe(200)
    expect((await deps.pages.findById('page00000001'))?.reportCount).toBe(1)

    clock.set(new Date(NOW.getTime() + dedupeWindowMs + 1))
    const afterWindow = await fetchAndDrain(app, postReport('page00000001', validBody(), ip))
    expect(afterWindow.status).toBe(200)
    expect((await deps.pages.findById('page00000001'))?.reportCount).toBe(2)
    expect(notifier.calls).toHaveLength(2)
  })

  it('別 IP からの通報は重複扱いにならない', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    await fetchAndDrain(
      app,
      postReport('page00000001', validBody(), { 'CF-Connecting-IP': '203.0.113.10' }),
    )
    await fetchAndDrain(
      app,
      postReport('page00000001', validBody(), { 'CF-Connecting-IP': '203.0.113.11' }),
    )

    const page = await deps.pages.findById('page00000001')
    expect(page?.reportCount).toBe(2)
  })

  it(`同一 IP からの通報が ${RATE_LIMITS.report.ipPerHour + 1} 回目で 429 になる`, async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)
    const ip = { 'CF-Connecting-IP': '198.51.100.20' }

    for (let i = 0; i < RATE_LIMITS.report.ipPerHour; i++) {
      const res = await fetchAndDrain(app, postReport('page00000001', validBody(), ip))
      expect(res.status).toBe(200)
    }

    const res = await fetchAndDrain(app, postReport('page00000001', validBody(), ip))
    expect(res.status).toBe(429)
    expect(await errorCode(res)).toBe('RATE_LIMITED')
  })

  it('Content-Type が application/json 以外は 415', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await fetchAndDrain(
      app,
      postReport('page00000001', validBody(), { 'Content-Type': 'text/plain' }),
    )

    expect(res.status).toBe(415)
    expect(await errorCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('Origin が別ドメインなら 403 で reports に入らない', async () => {
    const notifier = createFakeNotifier()
    const deps = buildFakeDeps({
      pages: createD1PageRepository(env.DB),
      reports: createD1ReportRepository(env.DB),
      notifier,
    })
    await deps.pages.create(
      pageInput({ id: 'page00000002', event: { ...pageInput().event, id: 'event00000002' } }),
    )
    const app = createApp(deps)

    const res = await fetchAndDrain(
      app,
      postReport('page00000002', validBody(), { Origin: 'https://evil.example' }),
    )

    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN_ORIGIN')
    const rows = await env.DB.prepare('SELECT * FROM reports WHERE page_id = ?')
      .bind('page00000002')
      .all()
    expect(rows.results).toHaveLength(0)
    expect(notifier.calls).toHaveLength(0)
  })

  it('存在しないページへの通報は 404', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await fetchAndDrain(app, postReport('nonexistent01', validBody()))

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('hidden なページへの通報は 404', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const hiddenPages: PageRepository = {
      ...deps.pages,
      findById: async (id: string): Promise<PageRecord | null> => {
        const page = await deps.pages.findById(id)
        return page ? { ...page, status: 'hidden' } : null
      },
    }
    const app = createApp({ ...deps, pages: hiddenPages })

    const res = await fetchAndDrain(app, postReport('page00000001', validBody()))

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('期限切れのページへの通報は 404', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput({ expiresAt: new Date('2026-09-15T00:00:00.000Z') }))
    const app = createApp(deps)

    const res = await fetchAndDrain(app, postReport('page00000001', validBody()))

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('Webhook 通知が失敗しても通報自体は 200 になり、logger.error が呼ばれる', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const errorSpy = vi.spyOn(deps.logger, 'error')
    deps.notifier.notifyReport = () => Promise.reject(new Error('webhook down'))
    const app = createApp(deps)

    const res = await fetchAndDrain(app, postReport('page00000001', validBody()))

    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalledWith('report_notify_failed', expect.anything())
  })
})

describe('GET /:id/report', () => {
  it('noindex（meta と X-Robots-Tag）が付き、インラインスクリプトが無い', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await app.fetch(new Request(`${TEST_ORIGIN}/page00000001/report`))

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    const html = await res.text()
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]/)
    expect(html).toContain('data-page-id="page00000001"')
  })

  it('サービス名が config.serviceName から入り、送信ボタンは type="submit"（暗黙送信で GET にしないため method="post"）', async () => {
    const deps = buildFakeDeps({
      config: { ...buildFakeDeps().config, serviceName: 'テストサービス' },
    })
    await deps.pages.create(pageInput())
    const app = createApp(deps)

    const res = await app.fetch(new Request(`${TEST_ORIGIN}/page00000001/report`))
    const html = await res.text()

    expect(html).toContain('<title>不適切なページを報告 - テストサービス</title>')
    expect(html).toContain('method="post"')
    expect(html).toMatch(/<button type="submit" id="report-submit">/)
  })

  it('ID の形式が不正なら 404（ルートに一致しない）', async () => {
    const deps = buildFakeDeps()
    const findById = vi.spyOn(deps.pages, 'findById')
    const app = createApp(deps)

    // 13 文字は PAGE_ID_PATTERN（12 文字固定）に一致しない
    const res = await app.fetch(new Request(`${TEST_ORIGIN}/nonexistent01/report`))

    expect(res.status).toBe(404)
    expect(findById).not.toHaveBeenCalled()
  })

  it('ID の形式は正しいが存在しないページは 404（ルートには一致する）', async () => {
    const deps = buildFakeDeps()
    const findById = vi.spyOn(deps.pages, 'findById')
    const app = createApp(deps)

    const res = await app.fetch(new Request(`${TEST_ORIGIN}/zzzzzzzzzzzz/report`))

    expect(res.status).toBe(404)
    expect(findById).toHaveBeenCalledWith('zzzzzzzzzzzz')
  })

  it('hidden なページは 404', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput())
    const hiddenPages: PageRepository = {
      ...deps.pages,
      findById: async (id: string): Promise<PageRecord | null> => {
        const page = await deps.pages.findById(id)
        return page ? { ...page, status: 'hidden' } : null
      },
    }
    const app = createApp({ ...deps, pages: hiddenPages })

    const res = await app.fetch(new Request(`${TEST_ORIGIN}/page00000001/report`))

    expect(res.status).toBe(404)
  })

  it('期限切れのページは 404', async () => {
    const deps = buildFakeDeps()
    await deps.pages.create(pageInput({ expiresAt: new Date('2026-09-15T00:00:00.000Z') }))
    const app = createApp(deps)

    const res = await app.fetch(new Request(`${TEST_ORIGIN}/page00000001/report`))

    expect(res.status).toBe(404)
  })
})
