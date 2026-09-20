import { fakeClock } from '../adapters/clock/fakeClock'
import { systemClock } from '../adapters/clock/systemClock'
import { consoleLogger } from '../adapters/logger/consoleLogger'
import { createMemoryReportRepository } from '../adapters/memory/memoryReportRepository'
import { createFakeNotifier } from '../adapters/notifier/fakeNotifier'
import { createFakeOgpRenderer } from '../adapters/ogp/fakeOgpRenderer'
import type { Clock } from '../ports/clock'
import type { IdGenerator } from '../ports/idGenerator'
import type { Logger } from '../ports/logger'
import type { Notifier } from '../ports/notifier'
import type { ObjectStorage } from '../ports/objectStorage'
import type { OgpRenderer } from '../ports/ogpRenderer'
import type { PageRepository } from '../ports/pageRepository'
import type { RateLimiter } from '../ports/rateLimiter'
import type { ReportRepository } from '../ports/reportRepository'
import type { Env } from './env'
import { notWired } from './lib/notWired'

export interface Deps {
  clock: Clock // 本番は systemClock。E2E_FIXED_NOW があり PUBLIC_ORIGIN のホスト名が localhost なら fakeClock で固定（§10.3）
  ids: IdGenerator
  pages: PageRepository
  reports: ReportRepository
  storage: ObjectStorage
  rateLimiter: RateLimiter
  ogpRenderer: OgpRenderer // T10 までは fakeOgpRenderer（固定 PNG）を使う
  notifier: Notifier // T12 までは fakeNotifier（no-op）。T12 以降も REPORT_WEBHOOK_URL が無ければ fakeNotifier（§9.4）
  logger: Logger
  config: {
    publicOrigin: string // env.PUBLIC_ORIGIN
    publicHost: string // new URL(env.PUBLIC_ORIGIN).host。ics の UID に使う（§7.2）
    serviceName: string // env.SERVICE_NAME
    ratePepper: string // env.RATE_LIMIT_PEPPER
  }
}

function buildClock(env: Env): Clock {
  if (!env.E2E_FIXED_NOW) return systemClock

  const hostname = new URL(env.PUBLIC_ORIGIN).hostname
  if (hostname !== 'localhost') {
    consoleLogger.warn('e2e_fixed_now_ignored', { hostname })
    return systemClock
  }

  const fixed = new Date(env.E2E_FIXED_NOW)
  if (Number.isNaN(fixed.getTime())) {
    consoleLogger.warn('e2e_fixed_now_invalid', { value: env.E2E_FIXED_NOW })
    return systemClock
  }
  return fakeClock(fixed)
}

/** Env → Deps。未実装のポート（ids / pages / storage / rateLimiter）は notWired() を登録し、T7 が本物に差し替える */
export function buildDeps(env: Env): Deps {
  return {
    clock: buildClock(env),
    ids: notWired<IdGenerator>('ids'),
    pages: notWired<PageRepository>('pages'),
    reports: createMemoryReportRepository(),
    storage: notWired<ObjectStorage>('storage'),
    rateLimiter: notWired<RateLimiter>('rateLimiter'),
    ogpRenderer: createFakeOgpRenderer(),
    notifier: createFakeNotifier(),
    logger: consoleLogger,
    config: {
      publicOrigin: env.PUBLIC_ORIGIN,
      publicHost: new URL(env.PUBLIC_ORIGIN).host,
      serviceName: env.SERVICE_NAME,
      ratePepper: env.RATE_LIMIT_PEPPER,
    },
  }
}
