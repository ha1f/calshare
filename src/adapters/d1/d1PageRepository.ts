import { D1_MAX_BIND_PARAMS } from '../../core/config/limits'
import type { ChangeSnapshot, CreateSource } from '../../core/types'
import {
  InvariantViolation,
  type EventRecord,
  type NewPageInput,
  type PagePatch,
  type PageRecord,
  type PageRepository,
} from '../../ports/pageRepository'

interface PageRow {
  id: string
  owner_id: string | null
  edit_token_hash: string
  raw_text: string
  issuer_name: string | null
  issuer_logo_url: string | null
  status: 'active' | 'hidden'
  report_count: number
  version: number
  previous_snapshot: string | null
  changed_at: string | null
  source: CreateSource
  creator_ip_hash: string
  creator_device_id: string
  created_at: string
  updated_at: string
  expires_at: string
}

interface EventRow {
  id: string
  page_id: string
  sort_order: number
  title: string
  location: string | null
  memo: string | null
  is_all_day: number
  start_at: string | null
  end_at: string | null
  created_at: string
  updated_at: string
}

interface ChangeSnapshotJson {
  start: string | null
  end: string | null
  isAllDay: boolean
  titleChanged: boolean
  locationChanged: boolean
}

function serializeChangeSnapshot(snapshot: ChangeSnapshot): string {
  const json: ChangeSnapshotJson = {
    start: snapshot.start ? snapshot.start.toISOString() : null,
    end: snapshot.end ? snapshot.end.toISOString() : null,
    isAllDay: snapshot.isAllDay,
    titleChanged: snapshot.titleChanged,
    locationChanged: snapshot.locationChanged,
  }
  return JSON.stringify(json)
}

function parseChangeSnapshot(json: string | null): ChangeSnapshot | null {
  if (json === null) return null
  const parsed = JSON.parse(json) as ChangeSnapshotJson
  return {
    start: parsed.start ? new Date(parsed.start) : null,
    end: parsed.end ? new Date(parsed.end) : null,
    isAllDay: parsed.isAllDay,
    titleChanged: parsed.titleChanged,
    locationChanged: parsed.locationChanged,
  }
}

function toEventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    sortOrder: row.sort_order,
    title: row.title,
    location: row.location,
    memo: row.memo,
    isAllDay: row.is_all_day === 1,
    start: row.start_at ? new Date(row.start_at) : null,
    end: row.end_at ? new Date(row.end_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function toPageRecord(row: PageRow, event: EventRecord): PageRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    editTokenHash: row.edit_token_hash,
    rawText: row.raw_text,
    issuerName: row.issuer_name,
    issuerLogoUrl: row.issuer_logo_url,
    status: row.status,
    reportCount: row.report_count,
    version: row.version,
    previousSnapshot: parseChangeSnapshot(row.previous_snapshot),
    changedAt: row.changed_at ? new Date(row.changed_at) : null,
    source: row.source,
    creatorIpHash: row.creator_ip_hash,
    creatorDeviceId: row.creator_device_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expiresAt: new Date(row.expires_at),
    event,
  }
}

/** D1 が投げる UNIQUE 制約違反が、指定した列（例: 'pages.id'）によるものかを判定する */
function isUniqueConstraintFailureOn(error: unknown, column: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes(column)
  )
}

export function createD1PageRepository(db: D1Database): PageRepository {
  async function countEvents(pageId: string): Promise<number> {
    const row = await db
      .prepare('SELECT COUNT(*) as count FROM events WHERE page_id = ?')
      .bind(pageId)
      .first<{ count: number }>()
    return row?.count ?? 0
  }

  /** Phase 1 の不変条件（events は 1 ページ 1 行）を検査してから、その 1 件を返す */
  async function loadEvent(pageId: string): Promise<EventRecord> {
    const count = await countEvents(pageId)
    if (count !== 1) {
      throw new InvariantViolation(`page ${pageId} has ${count} events`)
    }
    const row = await db
      .prepare('SELECT * FROM events WHERE page_id = ?')
      .bind(pageId)
      .first<EventRow>()
    return toEventRecord(row as EventRow)
  }

  return {
    async create(input: NewPageInput) {
      const nowIso = input.now.toISOString()
      const pagesStmt = db
        .prepare(
          `INSERT INTO pages (id, edit_token_hash, raw_text, source, creator_ip_hash, creator_device_id, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.editTokenHash,
          input.rawText,
          input.source,
          input.creatorIpHash,
          input.creatorDeviceId,
          nowIso,
          nowIso,
          input.expiresAt.toISOString(),
        )
      const eventsStmt = db
        .prepare(
          `INSERT INTO events (id, page_id, title, location, memo, is_all_day, start_at, end_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.event.id,
          input.id,
          input.event.title,
          input.event.location,
          input.event.memo,
          input.event.isAllDay ? 1 : 0,
          input.event.start ? input.event.start.toISOString() : null,
          input.event.end ? input.event.end.toISOString() : null,
          nowIso,
          nowIso,
        )

      try {
        // 2 つの INSERT を 1 トランザクションにする。events 側が失敗しても pages を残さない（§3.1）
        await db.batch([pagesStmt, eventsStmt])
      } catch (error) {
        if (isUniqueConstraintFailureOn(error, 'pages.id')) return 'id_conflict'
        throw error
      }
      return 'ok'
    },

    async findById(id: string) {
      const pageRow = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>()
      if (!pageRow) return null
      const event = await loadEvent(id)
      return toPageRecord(pageRow, event)
    },

    async update(id: string, patch: PagePatch) {
      const current = await db
        .prepare('SELECT version, previous_snapshot, changed_at FROM pages WHERE id = ?')
        .bind(id)
        .first<Pick<PageRow, 'version' | 'previous_snapshot' | 'changed_at'>>()
      if (!current) return 'not_found'

      const eventCount = await countEvents(id)
      if (eventCount !== 1) {
        throw new InvariantViolation(`page ${id} has ${eventCount} events`)
      }

      const nowIso = patch.now.toISOString()
      // previousSnapshot が null（変更バナー対象の変更が無い）なら既存値を維持する
      const previousSnapshotJson = patch.previousSnapshot
        ? serializeChangeSnapshot(patch.previousSnapshot)
        : current.previous_snapshot
      const changedAt = patch.previousSnapshot ? nowIso : current.changed_at

      const pagesStmt = db
        .prepare(
          `UPDATE pages SET raw_text = ?, expires_at = ?, version = ?, previous_snapshot = ?, changed_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          patch.rawText,
          patch.expiresAt.toISOString(),
          current.version + 1,
          previousSnapshotJson,
          changedAt,
          nowIso,
          id,
        )
      const eventsStmt = db
        .prepare(
          `UPDATE events SET title = ?, location = ?, memo = ?, is_all_day = ?, start_at = ?, end_at = ?, updated_at = ?
           WHERE page_id = ?`,
        )
        .bind(
          patch.event.title,
          patch.event.location,
          patch.event.memo,
          patch.event.isAllDay ? 1 : 0,
          patch.event.start ? patch.event.start.toISOString() : null,
          patch.event.end ? patch.event.end.toISOString() : null,
          nowIso,
          id,
        )

      await db.batch([pagesStmt, eventsStmt])
      return 'ok'
    },

    async incrementReportCount(id: string) {
      const row = await db
        .prepare(
          'UPDATE pages SET report_count = report_count + 1 WHERE id = ? RETURNING report_count',
        )
        .bind(id)
        .first<{ report_count: number }>()
      return row?.report_count ?? 0
    },

    async countActiveByCreator(creatorIpHash: string, creatorDeviceId: string) {
      const row = await db
        .prepare(
          `SELECT COUNT(*) as count FROM pages WHERE status = 'active' AND (creator_ip_hash = ? OR creator_device_id = ?)`,
        )
        .bind(creatorIpHash, creatorDeviceId)
        .first<{ count: number }>()
      return row?.count ?? 0
    },

    async listExpired(before: Date, limit: number) {
      const result = await db
        .prepare('SELECT id FROM pages WHERE expires_at < ? ORDER BY expires_at LIMIT ?')
        .bind(before.toISOString(), limit)
        .all<{ id: string }>()
      return result.results.map((row) => row.id)
    },

    async deleteByIds(ids: string[]) {
      if (ids.length === 0) return
      const statements: D1PreparedStatement[] = []
      for (let i = 0; i < ids.length; i += D1_MAX_BIND_PARAMS) {
        const chunk = ids.slice(i, i + D1_MAX_BIND_PARAMS)
        const placeholders = chunk.map(() => '?').join(', ')
        statements.push(
          db.prepare(`DELETE FROM pages WHERE id IN (${placeholders})`).bind(...chunk),
        )
      }
      await db.batch(statements)
    },

    async clearExpiredSnapshots(before: Date) {
      const result = await db
        .prepare(
          'UPDATE pages SET previous_snapshot = NULL, changed_at = NULL WHERE changed_at IS NOT NULL AND changed_at < ?',
        )
        .bind(before.toISOString())
        .run()
      return result.meta.changes
    },
  }
}
