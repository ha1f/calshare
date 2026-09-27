import type { ChangeSnapshot } from '../../core/types'
import type {
  EventRecord,
  NewPageInput,
  PagePatch,
  PageRecord,
  PageRepository,
} from '../../ports/pageRepository'

function cloneNullableDate(date: Date | null): Date | null {
  return date ? new Date(date) : null
}

// D1 実装は previous_snapshot を JSON 経由で 5 フィールドだけ保存する。
// スプレッドで丸ごとコピーすると、呼び出し側が余分なプロパティを持つ値を渡したときに
// メモリ実装だけそれを保持してしまい、D1 実装との差異を結合テストで検出できなくなる
function cloneChangeSnapshot(snapshot: ChangeSnapshot | null): ChangeSnapshot | null {
  if (!snapshot) return null
  return {
    start: cloneNullableDate(snapshot.start),
    end: cloneNullableDate(snapshot.end),
    isAllDay: snapshot.isAllDay,
    titleChanged: snapshot.titleChanged,
    locationChanged: snapshot.locationChanged,
  }
}

function cloneEvent(event: EventRecord): EventRecord {
  return {
    ...event,
    start: cloneNullableDate(event.start),
    end: cloneNullableDate(event.end),
    createdAt: new Date(event.createdAt),
    updatedAt: new Date(event.updatedAt),
  }
}

// D1 実装は ISO 文字列を経由するので毎回新しい Date になる。ここで複製しないと、
// 呼び出し側が create/update に渡した Date や findById が返した Date を後から書き換えたときに
// ストアの中身までつられて変わってしまう
function clonePage(page: PageRecord): PageRecord {
  return {
    ...page,
    previousSnapshot: cloneChangeSnapshot(page.previousSnapshot),
    changedAt: cloneNullableDate(page.changedAt),
    createdAt: new Date(page.createdAt),
    updatedAt: new Date(page.updatedAt),
    expiresAt: new Date(page.expiresAt),
    event: cloneEvent(page.event),
  }
}

/** memoryPageRepository と memoryReportRepository が report_count を通じて共有する Map */
export type MemoryPageStore = Map<string, PageRecord>

export function createMemoryPageStore(): MemoryPageStore {
  return new Map()
}

/** D1PageRepository と同じ契約を Map で再現するインメモリ実装。D1 実装と同じテストスイートで検証する */
export function createMemoryPageRepository(
  pages: MemoryPageStore = createMemoryPageStore(),
): PageRepository {
  const eventIds = new Set<string>()

  return {
    async create(input: NewPageInput) {
      if (pages.has(input.id)) return 'id_conflict'
      if (eventIds.has(input.event.id)) {
        // D1 は events.id の UNIQUE 制約違反でバッチ全体を失敗させ pages も残らない。同じ挙動にする
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
        start: cloneNullableDate(input.event.start),
        end: cloneNullableDate(input.event.end),
        createdAt: new Date(input.now),
        updatedAt: new Date(input.now),
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
        createdAt: new Date(input.now),
        updatedAt: new Date(input.now),
        expiresAt: new Date(input.expiresAt),
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
        expiresAt: new Date(patch.expiresAt),
        version: current.version + 1,
        // previousSnapshot が null（変更バナー対象の変更が無い）なら既存値を維持する
        previousSnapshot: patch.previousSnapshot
          ? cloneChangeSnapshot(patch.previousSnapshot)
          : current.previousSnapshot,
        changedAt: patch.previousSnapshot ? new Date(patch.now) : current.changedAt,
        updatedAt: new Date(patch.now),
        event: {
          ...current.event,
          title: patch.event.title,
          location: patch.event.location,
          memo: patch.event.memo,
          isAllDay: patch.event.isAllDay,
          start: cloneNullableDate(patch.event.start),
          end: cloneNullableDate(patch.event.end),
          updatedAt: new Date(patch.now),
        },
      })
      return 'ok'
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
      // id の tie-break は UTF-16 コードユニット順。D1 の ORDER BY id は UTF-8 バイト順で、
      // 非 ASCII の id では順序が食い違いうるが、ページ id は Crockford base32（§4.2）で ASCII のみなので一致する
      return [...pages.values()]
        .filter((page) => page.expiresAt < before)
        .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || (a.id < b.id ? -1 : 1))
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
