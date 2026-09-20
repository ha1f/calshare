import { test as base, expect } from '@playwright/test'

// §10.3 の基準時刻。全 spec はこのファイルの test / expect を import する
export const E2E_FIXED_NOW = new Date('2026-09-16T01:00:00Z')

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(E2E_FIXED_NOW)
    await use(page)
  },
})

export { expect }
