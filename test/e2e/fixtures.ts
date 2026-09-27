import type { Page } from '@playwright/test'
import { test as base, expect } from '@playwright/test'

// §10.3 の基準時刻。全 spec はこのファイルの test / expect を import する
export const E2E_FIXED_NOW = new Date('2026-09-16T01:00:00Z')

// プロセスごとに変わる salt。これが無いと testId だけで IP が決まり、.wrangler/state を使い回す
// 限り実行のたびに同じ IP のレート制限カウンタが積み上がる（tsconfig.web.json は types: [] なので node:crypto は使えない）
const PROCESS_SALT = crypto.randomUUID()

// wrangler dev は CF-Connecting-IP を付けないので、全テストが同じ送信元としてレート制限を共有し、
// 固定時刻では時間窓も進まない。テストごとに別の送信元 IP を名乗って避ける（本番では Cloudflare が上書きする）
function ipForTest(testId: string): string {
  let hash = 2166136261
  for (const ch of `${PROCESS_SALT}:${testId}`) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  }
  return `10.${(hash >>> 16) & 255}.${(hash >>> 8) & 255}.${hash & 255}`
}

// CSP 違反（require-trusted-types-for 'script' を含む）はブラウザが console.error に出す。
// 全 spec 共通でこれを拾い、テスト終了後にまとめて落とす（§9.1・§6.6）
const CSP_VIOLATION_PATTERN = /Refused to|Content Security Policy|Trusted ?(Types|HTML|Script)/

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': ipForTest(testInfo.testId) })
    await use(context)
  },
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(E2E_FIXED_NOW)
    const cspViolations: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error' && CSP_VIOLATION_PATTERN.test(message.text())) {
        cspViolations.push(message.text())
      }
    })
    await use(page)
    expect(cspViolations, 'CSP violation(s) logged to console').toEqual([])
  },
})

export { expect }

// /done への遷移先 URL。ID の文字種は core/id/crockford.ts の PAGE_ID_PATTERN と揃える
export const DONE_URL_PATTERN = /\/done\?id=([0-9a-hjkmnp-tv-z]{12})$/

/** トップから作成して /done に遷移させ、ページ ID を返す（複数の spec で使う共通手順） */
export async function createPage(page: Page, text: string): Promise<string> {
  await page.goto('/')
  await page.locator('#input').fill(text)
  await Promise.all([
    page.waitForURL(DONE_URL_PATTERN),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const match = DONE_URL_PATTERN.exec(page.url())
  const id = match?.[1]
  if (id === undefined) throw new Error('failed to extract page id from /done URL')
  return id
}

export function waitForCreateRequest(page: Page) {
  return page.waitForRequest((r) => r.url().endsWith('/api/pages') && r.method() === 'POST')
}
