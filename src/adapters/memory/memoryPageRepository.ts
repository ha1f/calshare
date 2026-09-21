import type { ChangeSnapshot } from '../../core/types'
import type {
  EventRecord,
  NewPageInput,
  PagePatch,
  PageRecord,
  PageRepository,
} from '../../ports/pageRepository'

function cloneChangeSnapshot(snapshot: ChangeSnapshot | null): ChangeSnapshot | null {
  return snapshot ? { ...snapshot } : null
}

function clonePage(page: PageRecord): PageRecord {
  return {
    ...page,
    previousSnapshot: cloneChangeSnapshot(page.previousSnapshot),
    event: { ...page.event },
  }
}

/** D1PageRepository と同じ契約を Map で再現するインメモリ実装。D1 実装と同じテストスイートで検証する */
export function createMemoryPageRepository(): PageRepository {
  const pages = new Map<string, PageRecord>()
  const eventIds = new Set<string>()

  return {
    async create(input: NewPageInput) {
      if (pages.has(input.id)) return 'id_conflict'
      if (eventIds.has(input.event.id)) {
        // D1 は events.id の UNIQUE 制約違反でバッチ全体を失敗させ pages も残らない（§3.1）。同じ挙動にする
        throw new Error(`event id already exists: ${input.event.id}`)
      }

      const event: EventRecord = {
        id: input.event.id,
        pageId: input.id,
        sortOrder: 0,
        title: input.event.title,
        location: input.event.location,
        memo: input.event.memo,
        isAllDay: input.event.isAllDay,
        start: input.event.start,
        end: input.event.end,
        createdAt: input.now,
        updatedAt: input.now,
      }
      pages.set(input.id, {
        id: input.id,
        ownerId: null,
        editTokenHash: input.editTokenHash,
        rawText: input.rawText,
        issuerName: null,
        issuerLogoUrl: null,
        status: 'active',
        reportCount: 0,
        version: 1,
        previousSnapshot: null,
        changedAt: null,
        source: input.source,
        creatorIpHash: input.creatorIpHash,
        creatorDeviceId: input.creatorDeviceId,
        createdAt: input.now,
        updatedAt: input.now,
        expiresAt: input.expiresAt,
        event,
      })
      eventIds.add(input.event.id)
      return 'ok'
    },

    async findById(id: string) {
      const page = pages.get(id)
      return page ? clonePage(page) : null
    },

    async update(id: string, patch: PagePatch) {
      const current = pages.get(id)
      if (!current) return 'not_found'

      pages.set(id, {
        ...current,
        rawText: patch.rawText,
        expiresAt: patch.expiresAt,
        version: current.version + 1,
        // previousSnapshot が null（変更バナー対象の変更が無い）なら既存値を維持する
        previousSnapshot: patch.previousSnapshot
          ? cloneChangeSnapshot(patch.previousSnapshot)
          : current.previousSnapshot,
        changedAt: patch.previousSnapshot ? patch.now : current.changedAt,
        updatedAt: patch.now,
        event: {
          ...current.event,
          title: patch.event.title,
          location: patch.event.location,
          memo: patch.event.memo,
          isAllDay: patch.event.isAllDay,
          start: patch.event.start,
          end: patch.event.end,
          updatedAt: patch.now,
        },
      })
      return 'ok'
    },

    async incrementReportCount(id: string) {
      const current = pages.get(id)
      if (!current) return 0
      current.reportCount += 1
      return current.reportCount
    },

    async countActiveByCreator(creatorIpHash: string, creatorDeviceId: string) {
      let count = 0
      for (const page of pages.values()) {
        if (page.status !== 'active') continue
        if (page.creatorIpHash === creatorIpHash || page.creatorDeviceId === creatorDeviceId)
          count++
      }
      return count
    },

    async listExpired(before: Date, limit: number) {
      return [...pages.values()]
        .filter((page) => page.expiresAt < before)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
        .slice(0, limit)
        .map((page) => page.id)
    },

    async deleteByIds(ids: string[]) {
      for (const id of ids) {
        const page = pages.get(id)
        if (page) eventIds.delete(page.event.id)
        pages.delete(id)
      }
    },

    async clearExpiredSnapshots(before: Date) {
      let count = 0
      for (const page of pages.values()) {
        if (page.changedAt !== null && page.changedAt < before) {
          page.previousSnapshot = null
          page.changedAt = null
          count++
        }
      }
      return count
    },
  }
}
