import {
  CHANGE_BANNER_HOURS,
  GC_BATCH_SIZE,
  GC_MAX_BATCHES_PER_RUN,
  RATE_LIMIT_COUNTER_RETENTION_DAYS,
} from '../../core/config/limits'
import type { Deps } from '../deps'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * 期限切れページの削除・レート制限カウンタの掃除・変更バナー用スナップショットの失効を行う（§2.6）。
 * Cron Trigger から呼ばれる。ロックは持たず、二重実行しても各手順が冪等なため安全（§2.6）。
 */
export async function runGc(deps: Deps): Promise<void> {
  const startedAt = Date.now()
  const now = deps.clock.now()

  let deletedPageCount = 0
  let batchCount = 0
  let deletionError: unknown
  try {
    while (batchCount < GC_MAX_BATCHES_PER_RUN) {
      const ids = await deps.pages.listExpired(now, GC_BATCH_SIZE)
      if (ids.length === 0) break
      batchCount++
      // R2 の削除が失敗しても pages 行は残るので、次回の GC が同じページを拾って再試行する
      await Promise.all(ids.map((id) => deps.storage.deleteAllForPage(id)))
      await deps.pages.deleteByIds(ids)
      deletedPageCount += ids.length
      if (ids.length < GC_BATCH_SIZE) break
    }
  } catch (error) {
    // ページ削除に失敗しても rate_limit_counters の掃除と previous_snapshot の失効は続ける。
    // ここで止めると前者が延々と積み上がる（§14.1）
    deletionError = error
  }

  await deps.rateLimiter.deleteExpired(
    new Date(now.getTime() - RATE_LIMIT_COUNTER_RETENTION_DAYS * DAY_MS),
  )
  const clearedSnapshotCount = await deps.pages.clearExpiredSnapshots(
    new Date(now.getTime() - CHANGE_BANNER_HOURS * HOUR_MS),
  )
  const durationMs = Date.now() - startedAt

  if (deletionError) {
    deps.logger.error('gc_failed', {
      error: deletionError,
      deletedPageCount,
      batchCount,
      durationMs,
    })
    throw deletionError
  }
  deps.logger.info('gc_completed', {
    deletedPageCount,
    batchCount,
    clearedSnapshotCount,
    durationMs,
  })
}
