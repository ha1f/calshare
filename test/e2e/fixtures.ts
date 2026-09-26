import { test as base, expect } from '@playwright/test'

// §10.3 の基準時刻。全 spec はこのファイルの test / expect を import する
export const E2E_FIXED_NOW = new Date('2026-09-16T01:00:00Z')

// wrangler dev は CF-Connecting-IP を付けないので、全テストが同じ送信元としてレート制限を共有し、
// 固定時刻では時間窓も進まない。テストごとに別の送信元 IP を名乗って避ける（本番では Cloudflare が上書きする）
function ipForTest(testId: string): string {
  let hash = 2166136261
  for (const ch of testId) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  }
  return `10.${(hash >>> 16) & 255}.${(hash >>> 8) & 255}.${hash & 255}`
}

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': ipForTest(testInfo.testId) })
    await use(context)
  },
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(E2E_FIXED_NOW)
    await use(page)
  },
})

export { expect }
