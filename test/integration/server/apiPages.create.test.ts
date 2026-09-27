import { env, exports } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { isValidPageId } from '../../../src/core/id/crockford'
import { addMonths } from '../../../src/core/time/jst'
import type { CreatePageRequest, CreatePageResponse } from '../../../src/core/api/types'
import type { EventFieldsJson } from '../../../src/core/types'
import { createApp } from '../../../src/server/app'
import { InvariantViolation, type PageRepository } from '../../../src/ports/pageRepository'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { errorCode, jsonRequest, TEST_ORIGIN } from '../helpers/jsonRequest'

// buildFakeDeps の clock（fakeClock）が固定する現在時刻
const NOW = new Date('2026-09-16T01:00:00.000Z')

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

function createBody(overrides: Partial<CreatePageRequest> = {}): CreatePageRequest {
  return {
    rawText: '9/20 19時 渋谷で飲み会',
    fields: validFields(),
    source: 'direct',
    ...overrides,
  }
}

function postPages(body: unknown, headers?: Record<string, string>) {
  return jsonRequest('/api/pages', { method: 'POST', body, headers })
}

/** JSON.stringify を経由しない生の本文で POST する。壊れた JSON を送るテスト専用 */
function postRawBody(body: BodyInit | null, headers?: Record<string, string>) {
  return new Request(new URL('/api/pages', TEST_ORIGIN), {
    method: 'POST',
    headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/json', ...headers },
    body,
  })
}

describe('POST /api/pages', () => {
  it('正常系: pages/events が保存され、R2 に ics が置かれ、Set-Cookie と editToken を含むレスポンスが返る', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(postPages(createBody({ source: 'prefill' })))

    expect(res.status).toBe(200)
    const json = await res.json<CreatePageResponse>()
    expect(Object.keys(json).sort()).toEqual(
      ['createdAt', 'editToken', 'expiresAt', 'fields', 'id', 'updatedAt', 'url', 'version'].sort(),
    )
    expect(isValidPageId(json.id)).toBe(true)
    expect(json.url).toBe(`${TEST_ORIGIN}/${json.id}`)
    expect(json.version).toBe(1)
    expect(json.editToken).toHaveLength(43)
    expect(json.fields).toEqual(validFields())
    expect(json.createdAt).toBe(NOW.toISOString())
    // end（2026-09-20T11:00:00Z）+ 7 日（§3.2）
    expect(json.expiresAt).toBe('2026-09-27T11:00:00.000Z')

    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/^cs_device=[0-9a-f-]{36}/)
    expect(setCookie).toContain('HttpOnly')

    const page = await deps.pages.findById(json.id)
    expect(page?.source).toBe('prefill')
    expect(page?.creatorIpHash).toBeTruthy()
    expect(page?.creatorDeviceId).toBeTruthy()
    expect(page?.event.title).toBe('飲み会')

    const ics = await deps.storage.getIcs(json.id)
    expect(ics).toContain('SUMMARY:飲み会')
    expect(ics).toContain(`SEQUENCE:0`)
  })

  it('下書き（日時なし）は ics を R2 に置かず、7 日後に期限切れになる', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)

    const res = await app.fetch(
      postPages(createBody({ fields: validFields({ start: null, end: null }) })),
    )

    expect(res.status).toBe(200)
    const json = await res.json<CreatePageResponse>()
    expect(json.expiresAt).toBe('2026-09-23T01:00:00.000Z') // NOW + 7 日
    expect(await deps.storage.getIcs(json.id)).toBeNull()
  })

  it('Cookie に既存の device_id があれば Set-Cookie を返さず、その ID を creatorDeviceId に使う', async () => {
    const deps = buildFakeDeps()
    const app = createApp(deps)
    const existingDeviceId = '11111111-1111-4111-8111-111111111111'

    const res = await app.fetch(
      postPages(createBody(), { Cookie: `cs_device=${existingDeviceId}` }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    const json = await res.json<CreatePageResponse>()
    const page = await deps.pages.findById(json.id)
    expect(page?.creatorDeviceId).toBe(existingDeviceId)
  })

  it.each([
    ['UUID 形式でない値', 'abc'],
    ['大文字の UUID', 'aaaaaaaa-1111-4111-8111-111111111111'.toUpperCase()],
  ])(
    'Cookie の device_id が%sなら再発行され、新しい ID が creatorDeviceId に入る',
    async (_label, cookieValue) => {
      const deps = buildFakeDeps()
      const app = createApp(deps)

      const res = await app.fetch(postPages(createBody(), { Cookie: `cs_device=${cookieValue}` }))

      expect(res.status).toBe(200)
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).toMatch(/^cs_device=[0-9a-f-]{36}/)
      const newDeviceId = setCookie?.split(';')[0]?.split('=')[1]
      expect(newDeviceId).not.toBe(cookieValue)
      const json = await res.json<CreatePageResponse>()
      const page = await deps.pages.findById(json.id)
      expect(page?.creatorDeviceId).toBe(newDeviceId)
    },
  )

  it('R2 への ics 保存が失敗しても 200 が返り、ページは D1 に残り、logger.error が 1 回呼ばれる', async () => {
    const deps = buildFakeDeps()
    const errorSpy = vi.spyOn(deps.logger, 'error')
    deps.storage.putIcs = () => Promise.reject(new Error('r2 down'))
    const app = createApp(deps)

    const res = await app.fetch(postPages(createBody()))

    expect(res.status).toBe(200)
    const json = await res.json<CreatePageResponse>()
    expect(await deps.pages.findById(json.id)).not.toBeNull()
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledWith('create_page_put_ics_failed', expect.anything())
  })

  describe('§5.7 のバリデーション', () => {
    it.each([
      ['EMPTY_INPUT', createBody({ fields: validFields({ title: '  ' }) })],
      ['INPUT_TOO_LONG', createBody({ fields: validFields({ title: 'a'.repeat(201) }) })],
      [
        'INVALID_RANGE',
        createBody({
          fields: validFields({
            start: '2026-09-20T11:00:00.000Z',
            end: '2026-09-20T10:00:00.000Z',
          }),
        }),
      ],
      [
        'PAST_EVENT',
        createBody({
          fields: validFields({
            start: '2026-09-01T10:00:00.000Z',
            end: '2026-09-01T11:00:00.000Z',
          }),
        }),
      ],
      [
        'BEYOND_MAX_LEAD_TIME',
        createBody({
          fields: validFields({
            start: '2028-01-01T10:00:00.000Z',
            end: '2028-01-01T11:00:00.000Z',
          }),
        }),
      ],
      [
        'TOO_MANY_URLS',
        createBody({
          fields: validFields({
            memo: 'http://a.example http://b.example http://c.example http://d.example',
          }),
        }),
      ],
      ['INVALID_REQUEST', createBody({ source: 'not_a_source' as never })],
      ['INVALID_REQUEST', { rawText: '飲み会', fields: validFields() }], // source が無い
    ])('%s は 400 になる', async (code, body) => {
      const app = createApp(buildFakeDeps())
      const res = await app.fetch(postPages(body))

      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe(code)
    })

    it.each([
      ['title が数値', createBody({ fields: { ...validFields(), title: 123 } as never })],
      ['fields が配列', createBody({ fields: [] as never })],
      [
        'start が ISO8601 として存在しない日時',
        createBody({ fields: validFields({ start: '2026-02-30T00:00:00.000Z' }) }),
      ],
    ])(
      'fields の形式が不正（%s）なら 400 INVALID_REQUEST で、レート制限カウンタが進まない',
      async (_label, body) => {
        const deps = buildFakeDeps()
        const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
        const app = createApp(deps)

        const res = await app.fetch(postPages(body))

        expect(res.status).toBe(400)
        expect(await errorCode(res)).toBe('INVALID_REQUEST')
        expect(consumeSpy).not.toHaveBeenCalled()
      },
    )

    it.each([
      ['壊れた JSON', '{"rawText": '],
      ['トップレベルが文字列', '"str"'],
      ['トップレベルが null', 'null'],
      ['トップレベルが配列', '[]'],
      ['空文字', ''],
      // TextDecoder は既定で先頭の BOM を取り除く。BOM だけの本文はデコード後に空文字になり、他の空文字と同じ扱いになる
      ['BOM のみ', String.fromCharCode(0xfeff)],
    ])(
      '本文が JSON として壊れている（%s）なら 400 INVALID_REQUEST で、レート制限カウンタが進まない',
      async (_label, body) => {
        const deps = buildFakeDeps()
        const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
        const app = createApp(deps)

        const res = await app.fetch(postRawBody(body))

        expect(res.status).toBe(400)
        expect(await errorCode(res)).toBe('INVALID_REQUEST')
        expect(consumeSpy).not.toHaveBeenCalled()
      },
    )

    it('本文が無い（body なし）なら 400 INVALID_REQUEST で、レート制限カウンタが進まない', async () => {
      const deps = buildFakeDeps()
      const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
      const app = createApp(deps)

      const res = await app.fetch(postRawBody(null))

      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('INVALID_REQUEST')
      expect(consumeSpy).not.toHaveBeenCalled()
    })

    it('start が now + 13 ヶ月ちょうどなら 200 になる', async () => {
      const limit = addMonths(NOW, 13)
      const app = createApp(buildFakeDeps())

      const res = await app.fetch(
        postPages(
          createBody({
            fields: validFields({
              start: limit.toISOString(),
              end: new Date(limit.getTime() + 60 * 60 * 1000).toISOString(),
            }),
          }),
        ),
      )

      expect(res.status).toBe(200)
    })

    it('start が now + 13 ヶ月を 1 分でも超えると 400 BEYOND_MAX_LEAD_TIME になる', async () => {
      const limit = new Date(addMonths(NOW, 13).getTime() + 60 * 1000)
      const app = createApp(buildFakeDeps())

      const res = await app.fetch(
        postPages(
          createBody({
            fields: validFields({
              start: limit.toISOString(),
              end: new Date(limit.getTime() + 60 * 60 * 1000).toISOString(),
            }),
          }),
        ),
      )

      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('BEYOND_MAX_LEAD_TIME')
    })

    it('end が now とちょうど同じなら過去扱いにならず 200 になる', async () => {
      const app = createApp(buildFakeDeps())

      const res = await app.fetch(
        postPages(
          createBody({
            fields: validFields({
              start: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
              end: NOW.toISOString(),
            }),
          }),
        ),
      )

      expect(res.status).toBe(200)
    })

    it('rawText が MAX_INPUT_LENGTH 超過なら 400 INPUT_TOO_LONG になり、レート制限カウンタが進まない', async () => {
      const deps = buildFakeDeps()
      const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
      const app = createApp(deps)

      const res = await app.fetch(postPages(createBody({ rawText: 'a'.repeat(2001) })))

      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('INPUT_TOO_LONG')
      expect(consumeSpy).not.toHaveBeenCalled()
    })

    it('本文が MAX_BODY_BYTES(32KB) を超えると 400 INVALID_REQUEST になり、D1 に書かれずレート制限カウンタも進まない', async () => {
      const deps = buildFakeDeps()
      const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
      const createSpy = vi.spyOn(deps.pages, 'create')
      const app = createApp(deps)

      const res = await app.fetch(
        postPages(createBody({ fields: validFields({ memo: 'a'.repeat(40000) }) })),
      )

      expect(res.status).toBe(400)
      expect(await errorCode(res)).toBe('INVALID_REQUEST')
      expect(consumeSpy).not.toHaveBeenCalled()
      expect(createSpy).not.toHaveBeenCalled()
    })
  })

  it('Content-Type が application/json 以外は 415 で、D1 に書かれずレート制限カウンタも進まない', async () => {
    const deps = buildFakeDeps()
    const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
    const createSpy = vi.spyOn(deps.pages, 'create')
    const app = createApp(deps)

    const res = await app.fetch(postPages(createBody(), { 'Content-Type': 'text/plain' }))

    expect(res.status).toBe(415)
    expect(await errorCode(res)).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(consumeSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('Origin が別ドメインなら 403 で、D1 に書かれずレート制限カウンタも進まない', async () => {
    const deps = buildFakeDeps()
    const consumeSpy = vi.spyOn(deps.rateLimiter, 'consume')
    const createSpy = vi.spyOn(deps.pages, 'create')
    const app = createApp(deps)

    const res = await app.fetch(postPages(createBody(), { Origin: 'https://evil.example' }))

    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN_ORIGIN')
    expect(consumeSpy).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  describe('ID 衝突時の再採番（§4.2）', () => {
    it('1 回目の生成 ID が既存と衝突しても、再採番した ID で作成できる', async () => {
      const deps = buildFakeDeps()
      // fakeIdGenerator は呼ぶたびに連番を返すので、先に 1 件作って最初の ID を使い切っておく
      await deps.pages.create({
        id: 'page00000001',
        editTokenHash: 'existing-hash',
        rawText: '既存ページ',
        event: {
          id: 'existing-event',
          title: '既存の予定',
          location: null,
          memo: null,
          start: null,
          end: null,
          isAllDay: false,
        },
        expiresAt: new Date('2026-09-23T00:00:00.000Z'),
        source: 'direct',
        creatorIpHash: 'existing-ip',
        creatorDeviceId: 'existing-device',
        now: NOW,
      })
      const app = createApp(deps)

      const res = await app.fetch(postPages(createBody()))

      expect(res.status).toBe(200)
      const json = await res.json<CreatePageResponse>()
      expect(json.id).toBe('page00000002')
    })

    it('再採番しても衝突し続ける場合は 500 になり、logger.error が 1 回呼ばれる', async () => {
      const deps = buildFakeDeps({
        ids: {
          generatePageId: () => 'page00000001',
          generateEditToken: () => 'x'.repeat(43),
          generateUuid: () => '00000000-0000-4000-8000-000000000001',
        },
      })
      const errorSpy = vi.spyOn(deps.logger, 'error')
      await deps.pages.create({
        id: 'page00000001',
        editTokenHash: 'existing-hash',
        rawText: '既存ページ',
        event: {
          id: 'existing-event',
          title: '既存の予定',
          location: null,
          memo: null,
          start: null,
          end: null,
          isAllDay: false,
        },
        expiresAt: new Date('2026-09-23T00:00:00.000Z'),
        source: 'direct',
        creatorIpHash: 'existing-ip',
        creatorDeviceId: 'existing-device',
        now: NOW,
      })
      const app = createApp(deps)

      const res = await app.fetch(postPages(createBody()))

      expect(res.status).toBe(500)
      expect(await errorCode(res)).toBe('INTERNAL')
      expect(errorSpy).toHaveBeenCalledOnce()
    })
  })

  it('events 不変条件が破れている（InvariantViolation）と 500 になり、logger.error が 1 回呼ばれる', async () => {
    const deps = buildFakeDeps()
    const errorSpy = vi.spyOn(deps.logger, 'error')
    const brokenPages: PageRepository = {
      ...deps.pages,
      findById: async () => {
        throw new InvariantViolation('page does not have exactly 1 event')
      },
    }
    const app = createApp({ ...deps, pages: brokenPages })

    const res = await app.fetch(postPages(createBody()))

    expect(res.status).toBe(500)
    expect(await errorCode(res)).toBe('INTERNAL')
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('deps.pages.create が想定外の例外を投げると 500 になり、logger.error が 1 回呼ばれる', async () => {
    const deps = buildFakeDeps()
    const errorSpy = vi.spyOn(deps.logger, 'error')
    deps.pages.create = () => Promise.reject(new Error('D1_ERROR: database is locked'))
    const app = createApp(deps)

    const res = await app.fetch(postPages(createBody()))

    expect(res.status).toBe(500)
    expect(await errorCode(res)).toBe('INTERNAL')
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  describe('レート制限（§9.3）', () => {
    it('同一 IP からの作成が 31 回目で 429 になる。Cookie（device）を毎回変えても IP 側で弾かれる', async () => {
      const deps = buildFakeDeps()
      const warnSpy = vi.spyOn(deps.logger, 'warn')
      const app = createApp(deps)
      const ip = { 'CF-Connecting-IP': '203.0.113.1' }

      for (let i = 0; i < 30; i++) {
        const res = await app.fetch(postPages(createBody(), ip))
        expect(res.status).toBe(200)
      }

      const res = await app.fetch(postPages(createBody(), ip))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(warnSpy).toHaveBeenCalledWith(
        'rate_limited',
        expect.objectContaining({
          scope: 'create',
          exceeded: expect.arrayContaining([{ bucket: 'ip', window: 'hour' }]) as unknown[],
        }),
      )
    })

    it('同一 device からの作成が 21 回目で 429 になる。IP を毎回変えても device 側で弾かれる', async () => {
      const deps = buildFakeDeps()
      const warnSpy = vi.spyOn(deps.logger, 'warn')
      const app = createApp(deps)
      const deviceId = '22222222-2222-4222-8222-222222222222'
      const headersFor = (i: number) => ({
        Cookie: `cs_device=${deviceId}`,
        'CF-Connecting-IP': `198.51.100.${i}`,
      })

      for (let i = 0; i < 20; i++) {
        const res = await app.fetch(postPages(createBody(), headersFor(i)))
        expect(res.status).toBe(200)
      }

      const res = await app.fetch(postPages(createBody(), headersFor(20)))
      expect(res.status).toBe(429)
      expect(await errorCode(res)).toBe('RATE_LIMITED')
      expect(warnSpy).toHaveBeenCalledWith(
        'rate_limited',
        expect.objectContaining({
          scope: 'create',
          exceeded: expect.arrayContaining([{ bucket: 'device', window: 'day' }]) as unknown[],
        }),
      )
    })
  })

  it('exports.default.fetch（本物のアダプタ）でも作成でき、D1 に pages/events が 1 行ずつ、R2 に ics が置かれる', async () => {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const body = createBody({
      fields: validFields({ start: start.toISOString(), end: end.toISOString() }),
    })

    const res = await exports.default.fetch(`${TEST_ORIGIN}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
      body: JSON.stringify(body),
    })

    expect(res.status).toBe(200)
    const json = await res.json<CreatePageResponse>()
    expect(isValidPageId(json.id)).toBe(true)

    const pageRow = await env.DB.prepare('SELECT * FROM pages WHERE id = ?').bind(json.id).first()
    expect(pageRow).toMatchObject({ id: json.id, source: 'direct' })
    const eventRows = await env.DB.prepare('SELECT * FROM events WHERE page_id = ?')
      .bind(json.id)
      .all()
    expect(eventRows.results).toHaveLength(1)

    const icsObject = await env.BUCKET.get(`ics/${json.id}.ics`)
    expect(icsObject).not.toBeNull()
    expect(await icsObject?.text()).toContain('SUMMARY:飲み会')
  })
})
