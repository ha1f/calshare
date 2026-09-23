import { fakeClock } from '../adapters/clock/fakeClock'
import { systemClock } from '../adapters/clock/systemClock'
import { createD1PageRepository } from '../adapters/d1/d1PageRepository'
import { createD1RateLimiter } from '../adapters/d1/d1RateLimiter'
import { createD1ReportRepository } from '../adapters/d1/d1ReportRepository'
import { createWebCryptoIdGenerator } from '../adapters/id/webCryptoIdGenerator'
import { consoleLogger } from '../adapters/logger/consoleLogger'
import { createFakeNotifier } from '../adapters/notifier/fakeNotifier'
import { createFakeOgpRenderer } from '../adapters/ogp/fakeOgpRenderer'
import { createR2ObjectStorage } from '../adapters/r2/r2ObjectStorage'
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

/** Env → Deps。ogpRenderer と notifier は本物のアダプタが無いため Fake のまま */
export function buildDeps(env: Env): Deps {
  const clock = buildClock(env)
  // origin は末尾スラッシュの有無に関わらず一致させたいので URL#origin で正規化する（§9.8 の比較対象）
  const publicOriginUrl = new URL(env.PUBLIC_ORIGIN)
  return {
    clock,
    ids: createWebCryptoIdGenerator(),
    pages: createD1PageRepository(env.DB),
    reports: createD1ReportRepository(env.DB),
    storage: createR2ObjectStorage(env.BUCKET, clock),
    rateLimiter: createD1RateLimiter(env.DB),
    ogpRenderer: createFakeOgpRenderer(),
    notifier: createFakeNotifier(),
    logger: consoleLogger,
    config: {
      publicOrigin: publicOriginUrl.origin,
      publicHost: publicOriginUrl.host,
      serviceName: env.SERVICE_NAME,
      ratePepper: env.RATE_LIMIT_PEPPER,
    },
  }
}
