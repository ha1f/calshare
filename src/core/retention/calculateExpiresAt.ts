import {
  MAX_EVENT_LEAD_TIME_MONTHS,
  RETENTION_DAYS_AFTER_LAST_EVENT,
  RETENTION_DAYS_FOR_DRAFT,
} from '../config/limits'
import { addDays, addMonths } from '../time/jst'

export interface EventTiming {
  endAt: Date | null
}

/**
 * 保持期限を返す（§3.2）。
 * @param baseDate 日時の無い下書きの基準日。作成時は createdAt、更新時は now を渡す
 */
export function calculateExpiresAt(events: EventTiming[], baseDate: Date): Date {
  const ends = events.map((e) => e.endAt).filter((d): d is Date => d !== null)
  if (ends.length === 0) return addDays(baseDate, RETENTION_DAYS_FOR_DRAFT)
  const last = new Date(Math.max(...ends.map((d) => d.getTime())))
  return addDays(last, RETENTION_DAYS_AFTER_LAST_EVENT)
}

/** 作成できる開始日時の上限（now + MAX_EVENT_LEAD_TIME_MONTHS、同日同時刻まで許容） */
export function maxLeadTimeLimit(now: Date): Date {
  return addMonths(now, MAX_EVENT_LEAD_TIME_MONTHS)
}

export function isWithinMaxLeadTime(eventStart: Date, now: Date): boolean {
  return eventStart.getTime() <= maxLeadTimeLimit(now).getTime()
}
