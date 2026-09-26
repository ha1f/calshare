import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'

const DONE_URL_PATTERN = /\/done\?id=([0-9a-hjkmnp-tv-z]{12})$/
const PAGE_URL_PATTERN = /\/([0-9a-hjkmnp-tv-z]{12})$/

/**
 * `getAttribute('href')` は JS が書き込んだ生の値（相対パスのことがある）をそのまま返すため、
 * `<a>` の `.href` プロパティ（常にドキュメント基準で絶対 URL に解決済み）を読む
 */
async function readHref(locator: Locator): Promise<string> {
  return locator.evaluate((el) => (el as HTMLAnchorElement).href)
}

/** トップから作成して /done に遷移させ、ページ ID を返す */
async function createPage(page: Page, text: string): Promise<string> {
  await page.goto('/')
  await page.locator('#input').fill(text)
  await Promise.all([
    page.waitForURL(DONE_URL_PATTERN),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const match = DONE_URL_PATTERN.exec(page.url())
  if (match === null) throw new Error('failed to extract page id from /done URL')
  return match[1]
}

// e2e は create API を叩くたびに ip:unknown のレート制限バケットを共有で消費する（§9.3・§10.4）ため、
// 1 テストにつき作成を 1 回に抑え、複数のシナリオをまとめて検証する
test('URL・コピー・カレンダーリンク・詳細ページへの遷移・送り直し案内（シナリオ1・2・3）', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  const url = await page.locator('#url-display').textContent()
  expect(url).toMatch(PAGE_URL_PATTERN)

  await page.getByRole('button', { name: 'コピー' }).click()
  await expect(page.locator('#copy-message')).toBeVisible()
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboardText).toBe(url)

  // main() の href 書き換えは非同期に走るため、値が付くまで待ってから読む
  await expect.poll(() => readHref(page.locator('#google-calendar-link'))).not.toBe('')
  const googleUrl = new URL(await readHref(page.locator('#google-calendar-link')))
  expect(googleUrl.hostname).toBe('calendar.google.com')
  expect(googleUrl.searchParams.get('dates')).toBe('20260920T100000Z/20260920T110000Z')

  const icsUrl = new URL(await readHref(page.locator('#ics-link')))
  expect(icsUrl.pathname).toBe(`/${id}.ics`)

  // 初回作成時には「送り直してください」は出ない。編集画面（T16）はまだ無いため、
  // 編集完了後の状態を履歴の直接書き換えで再現してから再訪する（§6.2）
  await expect(page.locator('#resend-notice')).toBeHidden()
  await page.evaluate((pageId) => {
    const raw = localStorage.getItem('calshare.history')
    const entries: Array<Record<string, unknown>> = raw === null ? [] : JSON.parse(raw)
    const updated = entries.map((entry) =>
      entry.id === pageId ? { ...entry, updatedAt: '2026-09-17T00:00:00.000Z' } : entry,
    )
    localStorage.setItem('calshare.history', JSON.stringify(updated))
  }, id)
  await page.goto(`/done?id=${id}`)
  await expect(page.locator('#resend-notice')).toBeVisible()

  // entry.url は config.publicOrigin（wrangler.jsonc の PUBLIC_ORIGIN、既定 8787）から組まれるため、
  // E2E_PORT で別ポートで動かしている場合は絶対 URL のホストが実際のサーバと一致しない。
  // パス部分だけを baseURL 相手に遷移させる
  const href = await page.locator('#url-display').getAttribute('href')
  if (href === null) throw new Error('url-display の href が無い')
  await page.goto(new URL(href).pathname)
  await expect(page.locator('h1[data-section="title"]')).toHaveText('飲み会')

  const sections = await page
    .locator('[data-section]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-section')))
  expect(sections).toEqual([
    'title',
    'datetime',
    'location',
    'calendar',
    'divider',
    'cta',
    'footer',
    'report',
  ])

  await page.getByRole('link', { name: '作ってみる' }).click()
  await expect(page).toHaveURL(/\/new\?ref=detail_cta$/)
})

test('日時未定の下書きではカレンダー欄の代わりに案内が出て、共有ボタンも出ない', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true })
  })

  await createPage(page, '予定')

  await expect(page.locator('#calendar-section')).toBeHidden()
  await expect(page.locator('#draft-notice')).toBeVisible()
  await expect(page.locator('#share-button')).toBeHidden()
})

test('navigator.share 対応の環境では共有ボタンが出てtitleとurlを渡す', async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error テスト用に window へ直接生やす
    window.__shareCalls = []
    Object.defineProperty(window.navigator, 'share', {
      value: (data: unknown) => {
        // @ts-expect-error 上と同じ
        window.__shareCalls.push(data)
        return Promise.resolve()
      },
      configurable: true,
    })
  })

  await createPage(page, '9/20 19時 渋谷で飲み会')

  await expect(page.locator('#share-button')).toBeVisible()
  await page.getByRole('button', { name: '共有' }).click()

  const calls = await page.evaluate(
    () => (window as unknown as { __shareCalls: unknown[] }).__shareCalls,
  )
  expect(calls).toHaveLength(1)
  expect((calls[0] as { title: string }).title).toBe('飲み会')
})
