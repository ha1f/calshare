import { env, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { hashEditToken } from '../../../src/core/token/hashEditToken'
import type {
  CreatePageRequest,
  CreatePageResponse,
  GetPageResponse,
  UpdatePageResponse,
} from '../../../src/core/api/types'
import type { EventFieldsJson } from '../../../src/core/types'
import type { NewPageInput, PageRepository } from '../../../src/ports/pageRepository'
import { createApp } from '../../../src/server/app'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { errorCode, jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'

const NOW = new Date('2026-09-16T01:00:00.000Z')
const TOKEN = 'x'.repeat(43)
const PAGE_ID = 'page00000001'

function validFields(overrides: Partial<EventFieldsJson> = {}): EventFieldsJson {
  return {
    title: '飲み会',
    location: '渋谷',
    memo: null,
    start: '2026-09-20T10:00:00.000Z',
    end: '2026-09-20T11:00:00.000Z',
    isAllDay: false,
    ...overrides,
  }
}

type SeedPageOverrides = Partial<Omit<NewPageInput, 'event'>> & {
  event?: Partial<NewPageInput['event']>
}

/** 編集用のページを 1 件直接 D1（Fake）に挿入する。POST を経由しないので editTokenHash を自分で計算する */
async function seedPage(pages: PageRepository, overrides: SeedPageOverrides = {}): Promise<void> {
  const { event: eventOverrides, ...rest } = overrides
  const input: NewPageInput = {
    id: PAGE_ID,
    editTokenHash: await hashEditToken(TOKEN),
    rawText: '9/20 19時 渋谷で飲み会',
    event: {
      id: 'event00000001',
      title: '飲み会',
      location: '渋谷',
      memo: null,
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
      ...eventOverrides,
    },
    expiresAt: new Date('2026-09-27T11:00:00.000Z'),
    source: 'direct',
    creatorIpHash: 'ip-hash',
    creatorDeviceId: 'device-id',
    now: NOW,
    ...rest,
  }
  const result = await pages.create(input)
  if (result !== 'ok') throw new Error(`seedPage failed: ${result}`)
}

function getPage(id: string, token?: string) {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers.Authorization = `Bearer ${token}`
  return new Request(new URL(`/api/pages/${id}`, TEST_ORIGIN), { headers })
}

function patchPage(
  id: string,
  body: unknown,
  options: { token?: string; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...options.headers }
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`
  return jsonRequest(`/api/pages/${id}`, { method: 'PATCH', body, headers })
}

describe('GET /api/pages/:id', () => {
  it('Bearer が一致すれば 200 で rawText を含む GetPageResponse を返す', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(getPage(PAGE_ID, TOKEN))

    expect(res.status).toBe(200)
    const json = (await res.json()) as GetPageResponse
    expect(Object.keys(json).sort()).toEqual(
      ['createdAt', 'expiresAt', 'fields', 'id', 'rawText', 'updatedAt', 'url', 'version'].sort(),
    )
    expect(json.rawText).toBe('9/20 19時 渋谷で飲み会')
    expect(json.fields).toEqual(validFields())
    expect(json.url).toBe(`${TEST_ORIGIN}/${PAGE_ID}`)
    expect(json.version).toBe(1)
  })

  it('Bearer が不一致なら 401', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(getPage(PAGE_ID, 'y'.repeat(43)))

    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  it('Authorization ヘッダが無ければ 401', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(getPage(PAGE_ID))

    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  it('Bearer 形式でないヘッダは 401', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      new Request(new URL(`/api/pages/${PAGE_ID}`, TEST_ORIGIN), {
        headers: { Authorization: `Basic ${TOKEN}` },
      }),
    )

    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  it('存在しないページは 404', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(getPage(PAGE_ID, TOKEN))

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('hidden なページは Bearer が一致しても 404', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const hiddenPages: PageRepository = {
      ...deps.pages,
      findById: async (id) => {
        const page = await deps.pages.findById(id)
        return page ? { ...page, status: 'hidden' } : null
      },
    }
    const app = createApp({ ...deps, pages: hiddenPages })

    const res = await app.fetch(getPage(PAGE_ID, TOKEN))

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('期限切れのページは 404', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages, { expiresAt: NOW })
    const app = createApp(deps)

    const res = await app.fetch(getPage(PAGE_ID, TOKEN))

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('不正な ID 形式は 404', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(getPage('short-id', TOKEN))

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/pages/:id', () => {
  it('正常系: version が +1 になり、fields と rawText が更新され、R2 の ics が新しい SEQUENCE で上書きされる', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    await deps.storage.putIcs(PAGE_ID, 'SEQUENCE:0 の古い内容')
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        {
          rawText: '9/21 20時 新宿で飲み会',
          fields: validFields({
            title: '新宿飲み会',
            location: '新宿',
            start: '2026-09-21T11:00:00.000Z',
            end: '2026-09-21T12:00:00.000Z',
          }),
        },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as UpdatePageResponse
    expect(json.version).toBe(2)
    expect(json.fields.title).toBe('新宿飲み会')
    expect(json.expiresAt).toBe('2026-09-28T12:00:00.000Z') // 新しい end 2026-09-21T12:00:00.000Z + 7 日
    expect(Object.keys(json)).not.toContain('rawText')

    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.rawText).toBe('9/21 20時 新宿で飲み会')
    expect(page?.version).toBe(2)

    const ics = await deps.storage.getIcs(PAGE_ID)
    expect(ics).toContain('SEQUENCE:1')
    expect(ics).not.toContain('SEQUENCE:0')
  })

  it('previous_snapshot と changed_at: 日時を変えると変更前の日時が入る', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        {
          rawText: '9/21 20時 渋谷で飲み会',
          fields: validFields({
            start: '2026-09-21T11:00:00.000Z',
            end: '2026-09-21T12:00:00.000Z',
          }),
        },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.previousSnapshot).toEqual({
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
      titleChanged: false,
      locationChanged: false,
    })
    expect(page?.changedAt).toEqual(NOW)
  })

  it('previous_snapshot と changed_at: タイトルだけ変えても titleChanged が立つ', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '9/20 19時 渋谷で新宿飲み会', fields: validFields({ title: '新宿飲み会' }) },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.previousSnapshot).toEqual({
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
      titleChanged: true,
      locationChanged: false,
    })
    expect(page?.changedAt).toEqual(NOW)
  })

  it('前後の空白だけの場所変更は同一視され、previous_snapshot も changed_at も変わらない', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '9/20 19時 渋谷で飲み会', fields: validFields({ location: ' 渋谷 ' }) },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.previousSnapshot).toBeNull()
    expect(page?.changedAt).toBeNull()
  })

  it('メモだけの変更では previous_snapshot も changed_at も変わらない', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        {
          rawText: '9/20 19時 渋谷で飲み会 持ち物: なし',
          fields: validFields({ memo: '持ち物: なし' }),
        },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.previousSnapshot).toBeNull()
    expect(page?.changedAt).toBeNull()
  })

  it('expires_at 再計算: 日時を消した下書きへの編集は now + 7 日になる', async () => {
    const deps = buildFakeDeps()
    // 作成から 10 日以上経っている状態を再現する（createdAt を基準にすると即座に期限切れになってしまうケース）。
    // expiresAt は上書きせず、PATCH の時点ではまだ有効なページにしておく
    await seedPage(deps.pages, { now: new Date('2026-09-01T00:00:00.000Z') })
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: 'まだ未定', fields: validFields({ start: null, end: null }) },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as UpdatePageResponse
    expect(json.expiresAt).toBe('2026-09-23T01:00:00.000Z') // NOW + 7 日
  })

  it('終了済みイベントのメモだけの編集は 200（日時が不変なら PAST_EVENT を検証しない）', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages, {
      event: {
        start: new Date('2026-09-15T10:00:00.000Z'),
        end: new Date('2026-09-15T11:00:00.000Z'),
      },
    })
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        {
          rawText: '9/15 19時 渋谷で飲み会 持ち物: なし',
          fields: validFields({
            start: '2026-09-15T10:00:00.000Z',
            end: '2026-09-15T11:00:00.000Z',
            memo: '持ち物: なし',
          }),
        },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
  })

  it('タイトルを空にすると 400 EMPTY_INPUT', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '9/20 19時 渋谷で飲み会', fields: validFields({ title: '' }) },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('EMPTY_INPUT')
  })

  it('日時を過去に変えると 400 PAST_EVENT', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        {
          rawText: '9/1 に変更',
          fields: validFields({
            start: '2026-09-01T10:00:00.000Z',
            end: '2026-09-01T11:00:00.000Z',
          }),
        },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('PAST_EVENT')
  })

  it('status と report_count は変更しない', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    await deps.pages.incrementReportCount(PAGE_ID)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '更新', fields: validFields({ title: '更新後' }) },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.status).toBe('active')
    expect(page?.reportCount).toBe(1)
  })

  it('同一ページへの 2 連続 PATCH は両方 200 になり、最後の保存が勝つ', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res1 = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '1回目', fields: validFields({ title: '1回目のタイトル' }) },
        { token: TOKEN },
      ),
    )
    const res2 = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '2回目', fields: validFields({ title: '2回目のタイトル' }) },
        { token: TOKEN },
      ),
    )

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const page = await deps.pages.findById(PAGE_ID)
    expect(page?.event.title).toBe('2回目のタイトル')
    expect(page?.version).toBe(3)
  })

  it('Bearer が不一致なら 401', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(PAGE_ID, { rawText: '更新', fields: validFields() }, { token: 'y'.repeat(43) }),
    )

    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  it('Authorization ヘッダが無ければ 401', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(patchPage(PAGE_ID, { rawText: '更新', fields: validFields() }))

    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  it('hidden なページは 404', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const hiddenPages: PageRepository = {
      ...deps.pages,
      findById: async (id) => {
        const page = await deps.pages.findById(id)
        return page ? { ...page, status: 'hidden' } : null
      },
    }
    const app = createApp({ ...deps, pages: hiddenPages })

    const res = await app.fetch(
      patchPage(PAGE_ID, { rawText: '更新', fields: validFields() }, { token: TOKEN }),
    )

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('期限切れのページは 404', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages, { expiresAt: NOW })
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(PAGE_ID, { rawText: '更新', fields: validFields() }, { token: TOKEN }),
    )

    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('NOT_FOUND')
  })

  it('Content-Type が application/json 以外は 415', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '更新', fields: validFields() },
        {
          token: TOKEN,
          headers: { 'Content-Type': 'text/plain' },
        },
      ),
    )

    expect(res.status).toBe(415)
    expect(await errorCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('Origin が別ドメインなら 403', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '更新', fields: validFields() },
        {
          token: TOKEN,
          headers: { Origin: 'https://evil.example' },
        },
      ),
    )

    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN_ORIGIN')
  })

  it('rawText が MAX_INPUT_LENGTH 超過なら 400 INPUT_TOO_LONG', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(PAGE_ID, { rawText: 'a'.repeat(2001), fields: validFields() }, { token: TOKEN }),
    )

    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('INPUT_TOO_LONG')
  })

  it('本文が JSON として壊れているなら 400 INVALID_REQUEST', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const app = createApp(deps)

    const res = await app.fetch(
      new Request(new URL(`/api/pages/${PAGE_ID}`, TEST_ORIGIN), {
        method: 'PATCH',
        headers: {
          Origin: TEST_ORIGIN,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKEN}`,
        },
        body: '{"rawText": ',
      }),
    )

    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('INVALID_REQUEST')
  })

  it('不正な ID 形式は 404', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage('short-id', { rawText: '更新', fields: validFields() }, { token: TOKEN }),
    )

    expect(res.status).toBe(404)
  })

  it('R2 への ics 保存が失敗しても 200 が返り、logger.error が 1 回呼ばれる', async () => {
    const deps = buildFakeDeps()
    await seedPage(deps.pages)
    const errorSpy = vi.spyOn(deps.logger, 'error')
    deps.storage.putIcs = () => Promise.reject(new Error('r2 down'))
    const app = createApp(deps)

    const res = await app.fetch(
      patchPage(
        PAGE_ID,
        { rawText: '更新', fields: validFields({ title: '更新後' }) },
        { token: TOKEN },
      ),
    )

    expect(res.status).toBe(200)
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith('update_page_put_ics_failed', expect.anything())
  })

  it('SELF.fetch（本物のアダプタ）でも更新でき、D1 の version・changed_at と R2 の ics が更新される', async () => {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const createBody: CreatePageRequest = {
      rawText: '9/20 19時 渋谷で飲み会',
      fields: validFields({ start: start.toISOString(), end: end.toISOString() }),
      source: 'direct',
    }
    const createRes = await SELF.fetch(`${TEST_ORIGIN}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
      body: JSON.stringify(createBody),
    })
    expect(createRes.status).toBe(200)
    const created = (await createRes.json()) as CreatePageResponse

    const newStart = new Date(start.getTime() + 60 * 60 * 1000)
    const newEnd = new Date(newStart.getTime() + 60 * 60 * 1000)
    const patchRes = await SELF.fetch(`${TEST_ORIGIN}/api/pages/${created.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: TEST_ORIGIN,
        Authorization: `Bearer ${created.editToken}`,
      },
      body: JSON.stringify({
        rawText: '9/20 20時 渋谷で新宿飲み会',
        fields: validFields({
          title: '新宿飲み会',
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        }),
      }),
    })

    expect(patchRes.status).toBe(200)
    const pageRow = await env.DB.prepare('SELECT version, changed_at FROM pages WHERE id = ?')
      .bind(created.id)
      .first<{ version: number; changed_at: string }>()
    expect(pageRow?.version).toBe(2)
    expect(pageRow?.changed_at).not.toBeNull()

    const icsObject = await env.BUCKET.get(`ics/${created.id}.ics`)
    expect(await icsObject?.text()).toContain('SEQUENCE:1')
  })
})
