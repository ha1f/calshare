// `cloudflare:workers` の env は Cloudflare.Env 型。テスト専用のバインディングと secrets をここでマージする。
import type { D1Migration } from '@cloudflare/vitest-pool-workers'

declare global {
  namespace Cloudflare {
    interface Env {
      RATE_LIMIT_PEPPER: string
      REPORT_WEBHOOK_URL?: string
      E2E_FIXED_NOW?: string
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
