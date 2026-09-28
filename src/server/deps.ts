import { fakeClock } from '../adapters/clock/fakeClock'
import { systemClock } from '../adapters/clock/systemClock'
import { createD1PageRepository } from '../adapters/d1/d1PageRepository'
import { createD1RateLimiter } from '../adapters/d1/d1RateLimiter'
import { createD1ReportRepository } from '../adapters/d1/d1ReportRepository'
import { createWebCryptoIdGenerator } from '../adapters/id/webCryptoIdGenerator'
import { consoleLogger } from '../adapters/logger/consoleLogger'
import { createFakeNotifier } from '../adapters/notifier/fakeNotifier'
import { createWebhookNotifier } from '../adapters/notifier/webhookNotifier'
import { createSatoriOgpRenderer } from '../adapters/ogp/satoriOgpRenderer'
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
  ogpRenderer: OgpRenderer
  notifier: Notifier // REPORT_WEBHOOK_URL が無ければ fakeNotifier（no-op）。§9.4
  logger: Logger
  config: {
    publicOrigin: string // env.PUBLIC_ORIGIN
    publicHost: string // new URL(env.PUBLIC_ORIGIN).host。ics の UID に使う（§7.2）
    serviceName: string // env.SERVICE_NAME
    ratePepper: string // env.RATE_LIMIT_PEPPER。未設定なら空文字
    ogpRendering: boolean // env.OGP_RENDERING === 'true'。既定は無効（Workers Free の CPU 時間上限のため。§2.5）
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

// OGP 用フォントの R2 キー（docs/runbooks/fonts.md・scripts/seed-local-r2.mjs と一致させる。§2.5）
const OGP_FONT_KEY = 'fonts/NotoSansJP-Regular.subset.otf'

/** Env → Deps。notifier は REPORT_WEBHOOK_URL があるときだけ webhookNotifier、無ければ fakeNotifier（§9.4） */
export function buildDeps(env: Env): Deps {
  const clock = buildClock(env)
  // origin は末尾スラッシュの有無に関わらず一致させたいので URL#origin で正規化する（§9.8 の比較対象）
  const publicOriginUrl = new URL(env.PUBLIC_ORIGIN)
  const storage = createR2ObjectStorage(env.BUCKET, clock)
  return {
    clock,
    ids: createWebCryptoIdGenerator(),
    pages: createD1PageRepository(env.DB),
    reports: createD1ReportRepository(env.DB),
    storage,
    rateLimiter: createD1RateLimiter(env.DB),
    ogpRenderer: createSatoriOgpRenderer({
      // `.wasm` の import は `test/unit`（Node、pool-workers を使わない）が deps.ts を読み込めるよう
      // 動的 import にする。パスがリテラルなので wrangler・vitest-pool-workers のバンドラは静的解析
      // でき、実行時に新しいモジュールを取りに行くわけではない（§2.5 の「トップレベルで重い初期化をしない」
      // にも合う。初期化自体は createSatoriOgpRenderer が初回 render 時に遅延実行する）
      loadWasm: async () => {
        const [{ default: yoga }, { default: resvg }] = await Promise.all([
          import('satori/yoga.wasm'),
          import('@resvg/resvg-wasm/index_bg.wasm'),
        ])
        return { yoga, resvg }
      },
      loadFont: async () => {
        const font = await storage.getFont(OGP_FONT_KEY)
        if (font === null) throw new Error(`OGP font not found in R2: ${OGP_FONT_KEY}`)
        return font
      },
    }),
    notifier: env.REPORT_WEBHOOK_URL
      ? createWebhookNotifier(env.REPORT_WEBHOOK_URL, consoleLogger)
      : createFakeNotifier(),
    logger: consoleLogger,
    config: {
      publicOrigin: publicOriginUrl.origin,
      publicHost: publicOriginUrl.host,
      serviceName: env.SERVICE_NAME,
      ratePepper: env.RATE_LIMIT_PEPPER ?? '',
      ogpRendering: env.OGP_RENDERING === 'true',
    },
  }
}
