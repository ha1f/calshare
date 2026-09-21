import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { createD1ReportRepository } from '../../../src/adapters/d1/d1ReportRepository'
import { createMemoryReportRepository } from '../../../src/adapters/memory/memoryReportRepository'
import type { NewReportInput, ReportRepository } from '../../../src/ports/reportRepository'

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
async function seedD1Page(id: string): Promise<void> {
  const now = new Date('2026-09-01T00:00:00.000Z').toISOString()
  await env.DB.prepare(
    `INSERT INTO pages (id, edit_token_hash, raw_text, source, creator_ip_hash, creator_device_id, created_at, updated_at, expires_at)
     VALUES (?, 'token-hash', 'raw', 'direct', 'ip-hash', 'device-id', ?, ?, ?)`,
  )
    .bind(id, now, now, now)
    .run()
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
    expect(result).toBe('inserted')
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
    expect(result).toBe('duplicate')
  })

  it('別ページなら inserted', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(buildReport({ id: 'report-a', pageId: 'page-1' }), dedupeSince)

    const result = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-b', pageId: 'page-2' }),
      dedupeSince,
    )
    expect(result).toBe('inserted')
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
    expect(result).toBe('inserted')
  })

  it('dedupeSince と同じ created_at は duplicate 扱い', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')
    await repo.insertIfNotDuplicate(buildReport({ id: 'report-a', now: dedupeSince }), dedupeSince)

    const result = await repo.insertIfNotDuplicate(
      buildReport({ id: 'report-b', now: new Date('2026-09-16T00:00:00.000Z') }),
      dedupeSince,
    )
    expect(result).toBe('duplicate')
  })

  it('同一キーで並行に呼んでも inserted は 1 件だけ', async () => {
    const repo = createRepo()
    const dedupeSince = new Date('2026-09-15T00:00:00.000Z')

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        repo.insertIfNotDuplicate(buildReport({ id: `report-concurrent-${i}` }), dedupeSince),
      ),
    )

    expect(results.filter((r) => r === 'inserted')).toHaveLength(1)
  })
}

describe('D1ReportRepository', () => {
  // D1 のストレージ分離はテストファイル単位で、同じファイル内の it() 間ではテーブルの中身が残る。
  // pages を消せば reports も CASCADE で消える
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM pages').run()
  })

  runReportRepositoryTests(() => createD1ReportRepository(env.DB), seedD1Page)

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
})

describe('memoryReportRepository（足場の実装を同じ契約テストで検証する）', () => {
  runReportRepositoryTests(
    () => createMemoryReportRepository(),
    async () => {},
  )
})
