import { requireDefined } from '../../core/assert'
import { D1_MAX_BIND_PARAMS } from '../../core/config/limits'
import type { ChangeSnapshot, CreateSource, Jsonified } from '../../core/types'
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

type ChangeSnapshotJson = Jsonified<ChangeSnapshot>

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

// serializeChangeSnapshot が書き込むのは toISOString() の形だけなので、その形へ戻して一致するかで判定する。
// Date.parse は '2026' のような ISO8601 以外の文字列も受理するため、判定には使えない
function isNullableDateString(value: unknown): value is string | null {
  if (value === null) return true
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function isChangeSnapshotJson(value: unknown): value is ChangeSnapshotJson {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isNullableDateString(v.start) &&
    isNullableDateString(v.end) &&
    typeof v.isAllDay === 'boolean' &&
    typeof v.titleChanged === 'boolean' &&
    typeof v.locationChanged === 'boolean'
  )
}

/**
 * previous_snapshot はスキーマが中身を保証しない JSON なので unknown で受けて判定する（docs/guidelines.md §2.3）。
 * assertSingleEvent と違い例外にはせず、壊れていれば変更バナーを出さない扱いにする。
 * 項目を足したときに古い行で詳細ページ全体が 500 にならないようにするため
 */
function parseChangeSnapshot(json: string | null): ChangeSnapshot | null {
  if (json === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isChangeSnapshotJson(parsed)) return null
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

/** D1 が投げる UNIQUE 制約違反が、指定したテーブルによるものかを判定する。列名まで見ないのは、本番の D1 が返すエラーメッセージの列名表記を未確認のため */
function isUniqueConstraintFailureOnTable(error: unknown, table: string): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes(table)
  )
}

export function createD1PageRepository(db: D1Database): PageRepository {
  // LIMIT 2 で十分（1 件かどうかだけ見る）。COUNT(*) との 2 往復を避ける
  async function fetchEventRows(pageId: string): Promise<EventRow[]> {
    const result = await db
      .prepare('SELECT * FROM events WHERE page_id = ? LIMIT 2')
      .bind(pageId)
      .all<EventRow>()
    return result.results
  }

  /** 不変条件（events は 1 ページ 1 行）を検査してから、その 1 件を返す */
  function assertSingleEvent(pageId: string, rows: EventRow[]): EventRow {
    if (rows.length !== 1) {
      throw new InvariantViolation(`page ${pageId} does not have exactly 1 event`)
    }
    return requireDefined(rows[0], 'rows has exactly 1 element')
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
        // events 側が失敗したとき pages だけが残らないよう、2 つの INSERT を 1 トランザクションにする
        await db.batch([pagesStmt, eventsStmt])
      } catch (error) {
        if (isUniqueConstraintFailureOnTable(error, 'pages')) return 'id_conflict'
        throw error
      }
      return 'ok'
    },

    async findById(id: string) {
      const pageRow = await db.prepare('SELECT * FROM pages WHERE id = ?').bind(id).first<PageRow>()
      if (!pageRow) return null
      const eventRow = assertSingleEvent(id, await fetchEventRows(id))
      return toPageRecord(pageRow, toEventRecord(eventRow))
    },

    async update(id: string, patch: PagePatch) {
      const pageExists = await db.prepare('SELECT 1 FROM pages WHERE id = ?').bind(id).first()
      if (!pageExists) return 'not_found'
      assertSingleEvent(id, await fetchEventRows(id))

      const nowIso = patch.now.toISOString()
      // previousSnapshot が null（変更バナー対象の変更が無い）なら既存値を維持する。
      // version・previous_snapshot・changed_at の計算を SQL 側（COALESCE と version + 1）に任せることで、
      // 同一ページへの並行 update でも先に SELECT した値を書き戻して巻き戻ることがないようにする
      const previousSnapshotJson = patch.previousSnapshot
        ? serializeChangeSnapshot(patch.previousSnapshot)
        : null
      const changedAt = patch.previousSnapshot ? nowIso : null

      const pagesStmt = db
        .prepare(
          `UPDATE pages SET raw_text = ?, expires_at = ?, version = version + 1,
           previous_snapshot = COALESCE(?, previous_snapshot), changed_at = COALESCE(?, changed_at), updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          patch.rawText,
          patch.expiresAt.toISOString(),
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

      // 事前の SELECT と db.batch の間に GC の deleteByIds が同じページを消すと、
      // UPDATE は 0 行のまま成功してしまう。実際に更新できた行数で not_found を判定する
      const [pagesResult] = await db.batch([pagesStmt, eventsStmt])
      if (requireDefined(pagesResult, 'batch returns a result per statement').meta.changes === 0) {
        return 'not_found'
      }
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
        .prepare('SELECT id FROM pages WHERE expires_at < ? ORDER BY expires_at, id LIMIT ?')
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
