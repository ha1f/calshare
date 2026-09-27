import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import { createD1ReportRepository } from '../../../src/adapters/d1/d1ReportRepository'
import {
  createMemoryPageRepository,
  createMemoryPageStore,
} from '../../../src/adapters/memory/memoryPageRepository'
import type { MemoryPageStore } from '../../../src/adapters/memory/memoryPageRepository'
import { createMemoryReportRepository } from '../../../src/adapters/memory/memoryReportRepository'
import type { NewPageInput } from '../../../src/ports/pageRepository'
import type { NewReportInput, ReportRepository } from '../../../src/ports/reportRepository'
import { insertPageRow } from '../helpers/insertPageRow'

function buildReport(overrides: Partial<NewReportInput> = {}): NewReportInput {
  return {
    id: 'report-1',
    pageId: 'page-1',
    reason: 'spam',
    comment: null,
    ipHash: 'ip-hash-1',
    now: new Date('2026-09-16T01:00:00.000Z'),
    ...overrides,
  }
}

/** reports.page_id は pages(id) の FK。D1 は外部キー制約が有効なので先にページ行を用意する */
function seedD1Page(id: string): Promise<void> {
  return insertPageRow(env.DB, id, new Date('2026-09-01T00:00:00.000Z'))
}

/** report_count は pages 側の列なので、memory でも insertIfNotDuplicate が読み書きできるようページ行を用意する */
function seedMemoryPage(store: MemoryPageStore, id: string): Promise<void> {
  const input: NewPageInput = {
    id,
    editTokenHash: 'token-hash',
    rawText: 'raw',
    event: {
      id: `${id}-event`,
      title: 'x',
      location: null,
      memo: null,
      start: null,
      end: null,
      isAllDay: false,
    },
    expiresAt: new Date('2026-09-27T00:00:00.000Z'),
    source: 'direct',
    creatorIpHash: 'ip-hash',
    creatorDeviceId: 'device-id',
    now: new Date('2026-09-01T00:00:00.000Z'),
  }
  return createMemoryPageRepository(store)
    .create(input)
    .then(() => {})
}

/** D1ReportRepository と memoryReportRepository の両方に流す契約テスト */
function runReportRepositoryTests(
  createRepo: () => ReportRepository,
  seedPage: (id: string) => Promise<void>,
) {
  beforeEach(async () => {
    await seedPage('page-1')
    await seedPage('page-2')
  })

  it('初回は inserted', async () => {
    const repo = createRepo()
    const result = await repo.insertIfNotDuplicate(
      buildReport(),
      new Date('2026-09-15T00:00:00.000Z'),
    )
    expect(result.kind).toBe('inserted')
  })

  it('同一 pageId・ipHash で dedupeSince 以降に既にあれば duplicate', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-a', now: new Date('2026-09-16T00:00:00.000Z') }),
      dedupeSince,
    )

    const result = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-b', now: new Date('2026-09-16T02:00:00.000Z') }),
      dedupeSince,
    )
    expect(result.kind).toBe('duplicate')
  })

  it('別ページなら inserted', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(buildReport({ id: 'report-a', pageId: 'page-1' }), dedupeSince)

    const result = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-b', pageId: 'page-2' }),
      dedupeSince,
    )
    expect(result.kind).toBe('inserted')
  })

  it('dedupeSince より前の通報は対象にならず inserted', async () => {
    const repo = createRepo()
    await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-a', now: new Date('2026-09-14T00:00:00.000Z') }),
      new Date('2026-09-13T00:00:00.000Z'),
    )

    const result = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-b', now: new Date('2026-09-16T00:00:00.000Z') }),
      new Date('2026-09-15T00:00:00.000Z'),
    )
    expect(result.kind).toBe('inserted')
  })

  it('dedupeSince と同じ created_at は duplicate 扱い', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(buildReport({ id: 'report-a', now: dedupeSince }), dedupeSince)

    const result = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-b', now: new Date('2026-09-16T00:00:00.000Z') }),
      dedupeSince,
    )
    expect(result.kind).toBe('duplicate')
  })

  it('同一キーで並行に呼んでも inserted は 1 件だけ', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        repo.insertIfNotDuplicate(buildReport({ id: `report-concurrent-${i}` }), dedupeSince),
      ),
    )

    expect(results.filter((r) => r.kind === 'inserted')).toHaveLength(1)
  })

  it('inserted なら report_count が 1 増える。duplicate では増えない（§4.3 の batch）', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')

    const first = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-count-a' }),
      dedupeSince,
    )
    expect(first).toEqual({ kind: 'inserted', reportCount: 1 })

    const duplicate = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-count-b', now: new Date('2026-09-16T02:00:00.000Z') }),
      dedupeSince,
    )
    expect(duplicate).toEqual({ kind: 'duplicate' })

    const secondInsert = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-count-c', pageId: 'page-2' }),
      dedupeSince,
    )
    expect(secondInsert).toEqual({ kind: 'inserted', reportCount: 1 })
  })
}

describe('D1ReportRepository', () => {
  runReportRepositoryTests(() => createD1ReportRepository(env.DB), seedD1Page)

  it('inserted のときは pages.report_count が reports の行数と一致する', async () => {
    const repo = createD1ReportRepository(env.DB)
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(buildReport({ id: 'report-consistency-1' }), dedupeSince)
    await repo.insertIfNotDuplicate(
      buildReport({
        id: 'report-consistency-2',
        ipHash: 'ip-hash-2',
        now: new Date('2026-09-16T02:00:00.000Z'),
      }),
      dedupeSince,
    )

    const reportsRow = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM reports WHERE page_id = ?',
    )
      .bind('page-1')
      .first<{ count: number }>()
    const pageRow = await env.DB.prepare('SELECT report_count FROM pages WHERE id = ?')
      .bind('page-1')
      .first<{ report_count: number }>()
    expect(pageRow?.report_count).toBe(reportsRow?.count)
    expect(pageRow?.report_count).toBe(2)
  })

  it('inserted のときだけ reports の行が増える', async () => {
    const repo = createD1ReportRepository(env.DB)
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(buildReport({ id: 'report-count-1' }), dedupeSince)
    await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-count-2', now: new Date('2026-09-16T02:00:00.000Z') }),
      dedupeSince,
    )

    const row = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE page_id = ?')
      .bind('page-1')
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })

  it('同一キーの並行 3 本でも reports の行数は 1', async () => {
    const repo = createD1ReportRepository(env.DB)
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')

    await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        repo.insertIfNotDuplicate(buildReport({ id: `report-row-count-${i}` }), dedupeSince),
      ),
    )

    const row = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE page_id = ?')
      .bind('page-1')
      .first<{ count: number }>()
    expect(row?.count).toBe(1)
  })

  // reports.page_id は pages(id) への FK。存在しないページへの通報は呼び出し側（ルート）が
  // 先に findById で 404 を返す想定で、ここに来る前提が崩れている異常系として FK 違反で失敗する
  it('存在しないページへの通報は FK 違反で失敗する', async () => {
    const repo = createD1ReportRepository(env.DB)

    await expect(
      repo.insertIfNotDuplicate(
        buildReport({ id: 'report-ghost', pageId: 'no-such-page' }),
        new Date('2026-09-15T00:00:00.000Z'),
      ),
    ).rejects.toThrow()
  })
})

describe('memoryReportRepository（足場の実装を同じ契約テストで検証する）', () => {
  let store: MemoryPageStore
  beforeEach(() => {
    store = createMemoryPageStore()
  })

  runReportRepositoryTests(
    () => createMemoryReportRepository(store),
    (id) => seedMemoryPage(store, id),
  )
})
