import { describe, expect, it } from 'vitest'
import { createMemoryPageStore } from '../../../../src/adapters/memory/memoryPageRepository'
import { createMemoryReportRepository } from '../../../../src/adapters/memory/memoryReportRepository'
import type { NewReportInput } from '../../../../src/ports/reportRepository'

function report(overrides: Partial<NewReportInput> = {}): NewReportInput {
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

describe('memoryReportRepository', () => {
  it('初回は inserted', async () => {
    const repo = createMemoryReportRepository(createMemoryPageStore())
    const dedupeSince = new Date('2026-09-15T01:00:00.000Z')

    expect((await repo.insertIfNotDuplicate(report(), dedupeSince)).kind).toBe('inserted')
  })

  it('同一 pageId・ipHash で dedupeSince 以降に既にあれば duplicate', async () => {
    const repo = createMemoryReportRepository(createMemoryPageStore())
    await repo.insertIfNotDuplicate(
      report({ now: new Date('2026-09-16T01:00:00.000Z') }),
      new Date('2026-09-15T00:00:00.000Z'),
    )

    const result = await repo.insertIfNotDuplicate(
      report({ id: 'report-2', now: new Date('2026-09-16T02:00:00.000Z') }),
      new Date('2026-09-15T00:00:00.000Z'),
    )
    expect(result.kind).toBe('duplicate')
  })

  it('別ページなら inserted', async () => {
    const repo = createMemoryReportRepository(createMemoryPageStore())
    await repo.insertIfNotDuplicate(
      report({ pageId: 'page-1' }),
      new Date('2026-09-15T00:00:00.000Z'),
    )

    const result = await repo.insertIfNotDuplicate(
      report({ id: 'report-2', pageId: 'page-2' }),
      new Date('2026-09-15T00:00:00.000Z'),
    )
    expect(result.kind).toBe('inserted')
  })

  it('dedupeSince より前の通報なら inserted', async () => {
    const repo = createMemoryReportRepository(createMemoryPageStore())
    await repo.insertIfNotDuplicate(
      report({ now: new Date('2026-09-14T00:00:00.000Z') }),
      new Date('2026-09-13T00:00:00.000Z'),
    )

    const result = await repo.insertIfNotDuplicate(
      report({ id: 'report-2', now: new Date('2026-09-16T00:00:00.000Z') }),
      new Date('2026-09-15T00:00:00.000Z'),
    )
    expect(result.kind).toBe('inserted')
  })
})
