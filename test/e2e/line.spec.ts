import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'

// LINE 内蔵ブラウザの UA（`Line/` を含む）。Android・iOS 双方で見られる形
const LINE_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36 Line/12.6.0'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 既定の line-ios プロジェクトも LINE UA を持つため、UA を明示して結果を決定的にする
test.use({ userAgent: LINE_ANDROID_UA })

/**
 * `getAttribute('href')` は未加工の値（相対パスのことがある）をそのまま返すため、
 * `<a>` の `.href` プロパティ（常にドキュメント基準で絶対 URL に解決済み）を読む
 */
async function readHref(locator: Locator): Promise<string> {
  return locator.evaluate((el) => (el as HTMLAnchorElement).href)
}

/** 以後の画面遷移・リロードで参照する UA を上書きする */
async function overrideUserAgent(page: Page, userAgent: string): Promise<void> {
  await page.addInitScript((ua: string) => {
    Object.defineProperty(window.navigator, 'userAgent', { get: () => ua, configurable: true })
  }, userAgent)
  await page.reload()
}

async function expectCalendarUaHandling(
  page: Page,
  scope: string,
  expected: { openExternalBrowser: boolean; androidNotice: boolean },
): Promise<void> {
  const googleUrl = new URL(await readHref(page.locator(`${scope} [data-calendar="google"]`)))
  const icsUrl = new URL(await readHref(page.locator(`${scope} [data-calendar="ics"]`)))
  expect(googleUrl.searchParams.has('openExternalBrowser')).toBe(expected.openExternalBrowser)
  expect(googleUrl.searchParams.get('action')).toBe('TEMPLATE')
  expect(icsUrl.searchParams.has('openExternalBrowser')).toBe(expected.openExternalBrowser)
  // バナー・注記はカレンダーボタンのコンテナの前後の兄弟として挿入される（内側ではない）ため、
  // ページ全体から探す。1 ページに 1 箇所しかカレンダー欄が無いので曖昧さは無い
  await expect(page.locator('.line-banner')).toHaveCount(expected.openExternalBrowser ? 1 : 0)
  await expect(page.locator('.android-ics-notice')).toHaveCount(expected.androidNotice ? 1 : 0)
}

test('LINE / Android UA でカレンダーボタンの案内が完成画面・詳細ページの両方に出る（シナリオ10）', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')
  await Promise.all([
    page.waitForURL(/\/done\?id=/),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])

  // 完成画面: Android 版 LINE の UA では openExternalBrowser 付与・LINE バナー・Android 注記が両方出る
  await expectCalendarUaHandling(page, '#calendar-section', {
    openExternalBrowser: true,
    androidNotice: true,
  })

  const detailHref = await page.locator('#url-display').getAttribute('href')
  if (detailHref === null) throw new Error('detail href missing')
  // entry.url は wrangler.jsonc の PUBLIC_ORIGIN から組まれるため、E2E_PORT で別ポートのときは
  // ホストが実サーバと一致しない。パス部分だけ遷移させる
  await page.goto(new URL(detailHref).pathname)

  // 詳細ページでも同様に両方出る
  await expectCalendarUaHandling(page, '[data-section="calendar"]', {
    openExternalBrowser: true,
    androidNotice: true,
  })

  // Android のみ（LINE ではない）: ics 注記だけ出て、LINE バナーも openExternalBrowser も出ない
  await overrideUserAgent(page, ANDROID_UA)
  await expectCalendarUaHandling(page, '[data-section="calendar"]', {
    openExternalBrowser: false,
    androidNotice: true,
  })

  // どちらにも該当しない UA: 何も出ない
  await overrideUserAgent(page, DESKTOP_UA)
  await expectCalendarUaHandling(page, '[data-section="calendar"]', {
    openExternalBrowser: false,
    androidNotice: false,
  })
})
