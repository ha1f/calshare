import type { ChangeSnapshot, CreateSource, EventFields } from '../core/types'

/** Phase 1 の不変条件（events は 1 ページ 1 行）が破れているときに PageRepository が投げる。ルート側で 500 にする */
export class InvariantViolation extends Error {}

export interface PageRecord {
  id: string
  ownerId: string | null
  editTokenHash: string
  rawText: string
  issuerName: string | null
  issuerLogoUrl: string | null
  status: 'active' | 'hidden'
  reportCount: number
  version: number
  previousSnapshot: ChangeSnapshot | null
  changedAt: Date | null
  source: CreateSource
  creatorIpHash: string
  creatorDeviceId: string
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  event: EventRecord // Phase 1 は常に 1 件。複数行あれば PageRepository が InvariantViolation を投げる
}
export interface EventRecord extends EventFields {
  id: string
  pageId: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}
export interface NewPageInput {
  id: string
  editTokenHash: string
  rawText: string
  event: { id: string } & EventFields
  expiresAt: Date
  source: CreateSource
  creatorIpHash: string
  creatorDeviceId: string
  now: Date
}
export interface PagePatch {
  rawText: string
  event: EventFields
  expiresAt: Date
  previousSnapshot: ChangeSnapshot | null // 変更バナー対象の変更が無ければ null（既存値を維持）
  now: Date
}
export interface PageRepository {
  /** pages と events の INSERT を db.batch() で 1 トランザクションにする（§3.1） */
  create(input: NewPageInput): Promise<'ok' | 'id_conflict'>
  findById(id: string): Promise<PageRecord | null>
  /** version+1 で更新する。楽観ロックは持たず最後の保存が勝つ（§6.5）。status / report_count は触らない */
  update(id: string, patch: PagePatch): Promise<'ok' | 'not_found'>
  incrementReportCount(id: string): Promise<number> // 更新後の件数
  /** 同一送信元（ip_hash または device_id が一致）の active なページ数。通報通知に載せる（§9.4） */
  countActiveByCreator(creatorIpHash: string, creatorDeviceId: string): Promise<number>
  listExpired(before: Date, limit: number): Promise<string[]>
  /** D1_MAX_BIND_PARAMS 件ずつに分割して db.batch() に載せる。101 件以上でも動く */
  deleteByIds(ids: string[]): Promise<void>
  /** changed_at が before より古い行の previous_snapshot / changed_at を NULL にする（§2.6） */
  clearExpiredSnapshots(before: Date): Promise<number>
}
