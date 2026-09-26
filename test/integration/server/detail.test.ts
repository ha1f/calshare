import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeClock } from '../../../src/adapters/clock/fakeClock'
import { createD1PageRepository } from '../../../src/adapters/d1/d1PageRepository'
import { createApp } from '../../../src/server/app'
import { buildChangeSnapshot } from '../../../src/core/change/buildChangeSnapshot'
import { CONTENT_SECURITY_POLICY } from '../../../src/server/lib/headers'
import type { ChangeSnapshot, EventFields } from '../../../src/core/types'
import type { NewPageInput, PageRepository } from '../../../src/ports/pageRepository'
import type { Deps } from '../../../src/server/deps'
import { buildFakeDeps } from '../helpers/fakeDeps'
import { TEST_ORIGIN } from '../helpers/jsonRequest'

const NOW = new Date('2026-09-16T01:00:00.000Z')
const CROCKFORD_CHARS = '0123456789abcdefghjkmnpqrstvwxyz'

/** PAGE_ID_PATTERN（Crockford Base32 小文字 12 文字）を満たすテスト用 ID を重複無く発行する */
function pageId(n: number): string {
  return CROCKFORD_CHARS[n].repeat(12)
}

function eventFields(overrides: Partial<EventFields> = {}): EventFields {
  return {
    title: '飲み会',
    location: '渋谷',
    memo: null,
    start: new Date('2026-09-20T10:00:00.000Z'),
    end: new Date('2026-09-20T11:00:00.000Z'),
    isAllDay: false,
    ...overrides,
  }
}

async function createPage(
  repo: PageRepository,
  id: string,
  options: { event?: Partial<EventFields>; now?: Date } = {},
): Promise<void> {
  const input: NewPageInput = {
    id,
    editTokenHash: 'token-hash',
    rawText: '9/20 19時 渋谷で飲み会',
    event: { id: `${id}-event`, ...eventFields(options.event) },
    expiresAt: new Date('2026-09-27T00:00:00.000Z'),
    source: 'direct',
    creatorIpHash: 'ip-hash',
    creatorDeviceId: 'device-1',
    now: options.now ?? NOW,
  }
  const result = await repo.create(input)
  if (result !== 'ok') throw new Error(`failed to create page: ${result}`)
}

async function hidePage(id: string): Promise<void> {
  await env.DB.prepare(`UPDATE pages SET status = 'hidden' WHERE id = ?`).bind(id).run()
}

async function expirePage(id: string, expiresAt: Date): Promise<void> {
  await env.DB.prepare('UPDATE pages SET expires_at = ? WHERE id = ?')
    .bind(expiresAt.toISOString(), id)
    .run()
}

/** update() 経由だと version・updated_at も動くため、変更バナー専用の状態は直接 SQL で作る */
async function setChangeSnapshot(
  id: string,
  snapshot: ChangeSnapshot,
  changedAt: Date,
): Promise<void> {
  const json = JSON.stringify({
    start: snapshot.start ? snapshot.start.toISOString() : null,
    end: snapshot.end ? snapshot.end.toISOString() : null,
    isAllDay: snapshot.isAllDay,
    titleChanged: snapshot.titleChanged,
    locationChanged: snapshot.locationChanged,
  })
  await env.DB.prepare('UPDATE pages SET previous_snapshot = ?, changed_at = ? WHERE id = ?')
    .bind(json, changedAt.toISOString(), id)
    .run()
}

async function markEdited(id: string, updatedAt: Date): Promise<void> {
  await env.DB.prepare('UPDATE pages SET updated_at = ? WHERE id = ?')
    .bind(updatedAt.toISOString(), id)
    .run()
}

function withFindByIdCounter(inner: PageRepository): {
  pages: PageRepository
  calls: () => number
} {
  let calls = 0
  const pages: PageRepository = {
    ...inner,
    async findById(id) {
      calls++
      return inner.findById(id)
    },
  }
  return { pages, calls: () => calls }
}

function buildDetailDeps(overrides: Partial<Deps> = {}): { deps: Deps; repo: PageRepository } {
  const repo = createD1PageRepository(env.DB)
  const deps = buildFakeDeps({ pages: repo, clock: fakeClock(NOW), ...overrides })
  return { deps, repo }
}

/** レスポンス本文から data-section 属性の出現順を取り出す。HTMLRewriter で実際の DOM 構造を解析する */
async function collectSections(html: string): Promise<string[]> {
  const sections: string[] = []
  const rewriter = new HTMLRewriter().on('[data-section]', {
    element(el) {
      sections.push(el.getAttribute('data-section') ?? '')
    },
  })
  await rewriter.transform(new Response(html)).text()
  return sections
}

async function get(deps: Deps, path: string): Promise<{ res: Response; text: string }> {
  const app = createApp(deps)
  const ctx = createExecutionContext()
  const res = await app.fetch(new Request(new URL(path, TEST_ORIGIN)), env, ctx)
  await waitOnExecutionContext(ctx)
  return { res, text: await res.clone().text() }
}

describe('GET /:id（詳細ページ、§6.3）', () => {
  beforeEach(async () => {
    // pageRepository.test.ts と同様、テーブル全体を走査しうる操作の前に掃除する（§11.7 の実測メモ）
    await env.DB.prepare('DELETE FROM events').run()
    await env.DB.prepare('DELETE FROM pages').run()
  })

  it('要素の順序が §6.3 のとおり（発行者スロットは Phase 1 では空のため出ない）', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(0)
    await createPage(repo, id, { event: { memo: '会場は変更なし' } })

    const { res, text } = await get(deps, `/${id}`)

    expect(res.status).toBe(200)
    expect(await collectSections(text)).toEqual([
      'title',
      'datetime',
      'location',
      'calendar',
      'memo',
      'divider',
      'cta',
      'footer',
      'report',
    ])
  })

  it('OGP メタが正しい（og:image は publicOrigin 由来の絶対 URL で ?v=version 付き）', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(1)
    await createPage(repo, id)

    const { text } = await get(deps, `/${id}`)

    expect(text).toContain('<meta property="og:title" content="飲み会"/>')
    expect(text).toContain(`<meta property="og:image" content="${TEST_ORIGIN}/${id}/ogp.png?v=1"/>`)
    expect(text).toContain(`<meta property="og:url" content="${TEST_ORIGIN}/${id}"/>`)
    expect(text).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    expect(text).toContain('<meta name="robots" content="noindex, nofollow"/>')
  })

  it('存在しない・hidden・期限切れのページは同じ本文で 404（存在を区別させない、§4.1）', async () => {
    const missingId = pageId(2)
    const hiddenId = pageId(14)
    const expiredId = pageId(15)
    const { deps: missingDeps } = buildDetailDeps()
    const { deps: hiddenDeps, repo: hiddenRepo } = buildDetailDeps()
    const { deps: expiredDeps, repo: expiredRepo } = buildDetailDeps()
    await createPage(hiddenRepo, hiddenId)
    await hidePage(hiddenId)
    await createPage(expiredRepo, expiredId)
    await expirePage(expiredId, NOW) // isServable は expiresAt > now を要求するのでちょうど now は期限切れ扱い

    const missing = await get(missingDeps, `/${missingId}`)
    const hidden = await get(hiddenDeps, `/${hiddenId}`)
    const expired = await get(expiredDeps, `/${expiredId}`)

    expect(missing.res.status).toBe(404)
    expect(hidden.res.status).toBe(404)
    expect(expired.res.status).toBe(404)
    expect(hidden.text).toBe(missing.text)
    expect(expired.text).toBe(missing.text)
  })

  it('不正な ID 形式は 404 で、D1 には問い合わせない', async () => {
    const inner = createD1PageRepository(env.DB)
    const { pages, calls } = withFindByIdCounter(inner)
    const deps = buildFakeDeps({ pages, clock: fakeClock(NOW) })

    const res = await createApp(deps).fetch(new Request(new URL('/not-a-valid-id', TEST_ORIGIN)))

    expect(res.status).toBe(404)
    expect(calls()).toBe(0)
  })

  it('XSS 回帰: タイトルに <script> を含んでもエスケープされる', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(4)
    await createPage(repo, id, { event: { title: '<script>alert(1)</script>' } })

    const { res, text } = await get(deps, `/${id}`)

    expect(res.status).toBe(200)
    expect(text).not.toContain('<script>alert(1)</script>')
    expect(text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('メモの改行は <br> になり、URL は自動リンクされない', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(5)
    await createPage(repo, id, { event: { memo: '1行目\nhttps://example.com/path' } })

    const { text } = await get(deps, `/${id}`)

    expect(text).toContain('1行目<br/>')
    expect(text).toContain('https://example.com/path')
    expect(text).not.toContain('<a href="https://example.com/path">')
  })

  it('空文字の場所・メモは「無し」として扱う（編集画面が空欄を "" で送ることがある、§3.5 と同じ扱い）', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(17)
    await createPage(repo, id, { event: { location: '', memo: '' } })

    const { text } = await get(deps, `/${id}`)

    expect(await collectSections(text)).not.toContain('location')
    expect(await collectSections(text)).not.toContain('memo')
    expect(text).not.toContain('google.com/maps')
  })

  it('Cache API がヒットする（クエリが違っても D1 の findById は 1 回だけ）', async () => {
    const inner = createD1PageRepository(env.DB)
    const { pages, calls } = withFindByIdCounter(inner)
    const deps = buildFakeDeps({ pages, clock: fakeClock(NOW) })
    const id = pageId(6)
    await inner.create({
      id,
      editTokenHash: 'hash',
      rawText: '9/20 19時 渋谷で飲み会',
      event: { id: `${id}-event`, ...eventFields() },
      expiresAt: new Date('2026-09-27T00:00:00.000Z'),
      source: 'direct',
      creatorIpHash: 'ip-hash',
      creatorDeviceId: 'device-1',
      now: NOW,
    })

    const first = await get(deps, `/${id}?x=1`)
    const second = await get(deps, `/${id}?x=2`)

    expect(first.res.status).toBe(200)
    expect(second.res.status).toBe(200)
    expect(calls()).toBe(1)
    // キャッシュから返っても §9.1/§9.5 のヘッダと Cache-Control が保たれる
    expect(second.res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(second.res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(second.res.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it('CSP・Referrer-Policy・X-Robots-Tag が固定で付く', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(7)
    await createPage(repo, id)

    const { res } = await get(deps, `/${id}`)

    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY)
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  describe('変更バナー（48 時間境界、§8）', () => {
    const snapshot: ChangeSnapshot = {
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T11:00:00.000Z'),
      isAllDay: false,
      titleChanged: false,
      locationChanged: false,
    }

    it('ちょうど 48 時間前の変更は表示される', async () => {
      const { deps, repo } = buildDetailDeps()
      const id = pageId(8)
      await createPage(repo, id, {
        event: {
          start: new Date('2026-09-21T10:00:00.000Z'),
          end: new Date('2026-09-21T11:00:00.000Z'),
        },
      })
      const changedAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000)
      await setChangeSnapshot(id, snapshot, changedAt)

      const { text } = await get(deps, `/${id}`)

      expect(text).toContain(
        'この予定は変更されました 日時: 9月20日(日) 19:00〜20:00 → 9月21日(月) 19:00〜20:00',
      )
    })

    it('48 時間を過ぎた変更は表示されない', async () => {
      const { deps, repo } = buildDetailDeps()
      const id = pageId(9)
      await createPage(repo, id)
      const changedAt = new Date(NOW.getTime() - 48 * 60 * 60 * 1000 - 1)
      await setChangeSnapshot(id, snapshot, changedAt)

      const { text } = await get(deps, `/${id}`)

      expect(text).not.toContain('この予定は変更されました')
    })

    it('タイトル・場所の変更は事実だけを示し、旧値は DOM に出ない', async () => {
      const { deps, repo } = buildDetailDeps()
      const id = pageId(10)
      const previous = eventFields({ title: '旧タイトル', location: '旧場所' })
      const next = eventFields({ title: '新タイトル', location: '新宿' }) // 日時は previous と同じ
      await createPage(repo, id, { event: next })
      const changeSnapshot = buildChangeSnapshot(previous, next)
      if (changeSnapshot === null) throw new Error('expected a change snapshot')
      await setChangeSnapshot(id, changeSnapshot, new Date(NOW.getTime() - 60 * 60 * 1000))

      const { text } = await get(deps, `/${id}`)

      expect(text).toContain('タイトルが変更されました')
      expect(text).toContain('場所が変更されました')
      expect(text).not.toContain('この予定は変更されました') // 日時は変わっていない
      expect(text).not.toContain('旧タイトル')
      expect(text).not.toContain('旧場所')
    })

    it('バナー表示時は title の直後・datetime の直前に入る（§6.3 の順序）', async () => {
      const { deps, repo } = buildDetailDeps()
      const id = pageId(16)
      const previous = eventFields()
      const next = eventFields({
        start: new Date('2026-09-21T10:00:00.000Z'),
        end: new Date('2026-09-21T11:00:00.000Z'),
      })
      await createPage(repo, id, { event: next })
      const changeSnapshot = buildChangeSnapshot(previous, next)
      if (changeSnapshot === null) throw new Error('expected a change snapshot')
      await setChangeSnapshot(id, changeSnapshot, new Date(NOW.getTime() - 60 * 60 * 1000))

      const { text } = await get(deps, `/${id}`)

      expect(await collectSections(text)).toEqual([
        'title',
        'change-banner',
        'datetime',
        'location',
        'calendar',
        'divider',
        'cta',
        'footer',
        'report',
      ])
    })
  })

  describe('免責の位置（§8）', () => {
    it('未編集のページはフッターにだけ免責が出る', async () => {
      const { deps, repo } = buildDetailDeps()
      const id = pageId(11)
      await createPage(repo, id)

      const { text } = await get(deps, `/${id}`)

      expect(text).toContain('カレンダーに追加した後の変更は自動では反映されません')
      expect(text).not.toContain('最新はこのページで確認してください')
    })

    it('編集済みのページはカレンダーボタン直下にも免責が出る', async () => {
      const { deps, repo } = buildDetailDeps()
      const id = pageId(12)
      await createPage(repo, id)
      await markEdited(id, new Date(NOW.getTime() + 60 * 1000))

      const { text } = await get(deps, `/${id}`)

      expect(text).toContain(
        'カレンダーに追加した後の変更は自動では反映されません。最新はこのページで確認してください',
      )
      expect(text).toContain('最終更新:')
    })
  })

  it('日時未定の下書きはカレンダーボタンを出さず案内文を出す', async () => {
    const { deps, repo } = buildDetailDeps()
    const id = pageId(13)
    await createPage(repo, id, { event: { start: null, end: null } })

    const { text } = await get(deps, `/${id}`)

    expect(text).toContain('日時が決まったら追加できます')
    expect(text).not.toContain('Googleカレンダー')
  })
})
