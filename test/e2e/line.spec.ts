import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

// LINE 内蔵ブラウザの UA（`Line/` を含む）。Android・iOS 双方で見られる形
const LINE_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36 Line/12.6.0'

// 既定の line-ios プロジェクトも LINE UA を持つため、UA を明示して結果を決定的にする
test.use({ userAgent: LINE_ANDROID_UA })

async function createPageAndOpenDetail(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')
  await Promise.all([
    page.waitForURL(/\/done\?id=/),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  await expect(page.locator('#url-display')).toHaveAttribute('href', /^https?:/)
  const detailHref = await page.locator('#url-display').getAttribute('href')
  if (detailHref === null) throw new Error('detail href missing')
  // entry.url は wrangler.jsonc の PUBLIC_ORIGIN から組まれるため、E2E_PORT で別ポートのときは
  // ホストが実サーバと一致しない。パス部分だけ遷移させる
  await page.goto(new URL(detailHref).pathname)
}

test('LINE UA でカレンダーボタンのhrefにopenExternalBrowser=1が付き案内バナーが出る（シナリオ10）', async ({
  page,
}) => {
  await createPageAndOpenDetail(page)

  await expect(page.locator('[data-calendar="google"]')).toHaveAttribute(
    'href',
    /openExternalBrowser=1/,
  )
  const googleHref = await page.locator('[data-calendar="google"]').getAttribute('href')
  const googleUrl = new URL(googleHref ?? '')
  expect(googleUrl.searchParams.get('openExternalBrowser')).toBe('1')
  expect(googleUrl.searchParams.get('action')).toBe('TEMPLATE')

  const icsHref = await page.locator('[data-calendar="ics"]').getAttribute('href')
  expect(new URL(icsHref ?? '').searchParams.get('openExternalBrowser')).toBe('1')

  await expect(page.locator('.line-banner')).toBeVisible()
})
