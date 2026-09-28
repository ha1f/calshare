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
  const id = match?.[1]
  if (id === undefined) throw new Error('failed to extract page id from /done URL')
  return id
}

// e2e は create API を叩くたびに、送信元ごとのレート制限の回数を消費する（§9.3・§10.4）ため、
// 1 テストにつき作成を 1 回に抑え、複数のシナリオをまとめて検証する
test('URL・コピー・カレンダーリンク・詳細ページへの遷移・送り直し案内（シナリオ1・2・3）', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await expect(page.locator('#url-display')).toHaveText(PAGE_URL_PATTERN)
  const url = await page.locator('#url-display').textContent()
  // API が返す url は wrangler dev に渡した PUBLIC_ORIGIN から組まれる。E2E_PORT で
  // ポートを変えても実際に配信しているサーバのアドレスと一致することを固定する
  expect(url?.startsWith(`${baseURL}/`)).toBe(true)

  await expect
    .poll(() => readHref(page.locator('#line-share-link')))
    .toBe(`https://line.me/R/share?text=${encodeURIComponent(url ?? '')}`)
  await expect(page.locator('#edit-link')).toHaveAttribute('href', `/${id}/edit`)
  // §10.3 の基準時刻の下で作成しているため、終了 9/20 20:00 JST から
  // RETENTION_DAYS_AFTER_LAST_EVENT 日後の暦日が期限表示に出る
  await expect(page.locator('#expires-notice')).toHaveText('9/27 まで表示されます')

  await page.getByRole('button', { name: 'コピー' }).click()
  await expect(page.locator('#copy-message')).toBeVisible()
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboardText).toBe(url)

  // 初期状態は href 属性が無く .href は空文字になるので、値が付くまで待ってから読む
  await expect.poll(() => readHref(page.locator('#google-calendar-link'))).not.toBe('')
  const googleUrl = new URL(await readHref(page.locator('#google-calendar-link')))
  expect(googleUrl.hostname).toBe('calendar.google.com')
  expect(googleUrl.searchParams.get('dates')).toBe('20260920T100000Z/20260920T110000Z')

  await expect
    .poll(async () => new URL(await readHref(page.locator('#ics-link'))).pathname)
    .toBe(`/${id}.ics`)

  // 初回作成時には「送り直してください」は出ない。編集完了後の状態は、履歴の
  // version を直接書き換えて再現してから再訪する（§6.2・§8）
  await expect(page.locator('#resend-notice')).toBeHidden()
  await page.evaluate((pageId) => {
    const raw = localStorage.getItem('calshare.history')
    const entries: Array<Record<string, unknown>> =
      raw === null ? [] : (JSON.parse(raw) as Array<Record<string, unknown>>)
    const updated = entries.map((entry) => (entry.id === pageId ? { ...entry, version: 2 } : entry))
    localStorage.setItem('calshare.history', JSON.stringify(updated))
  }, id)
  await page.goto(`/done?id=${id}`)
  await expect(page.locator('#resend-notice')).toBeVisible()

  await expect(page.locator('#url-display')).toHaveAttribute('href', /^https?:\/\//)
  const href = await page.locator('#url-display').getAttribute('href')
  if (href === null) throw new Error('url-display の href が無い')
  expect(new URL(href).origin).toBe(baseURL)
  await page.goto(href)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('飲み会')

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

test('version を持たない履歴項目は updatedAt が createdAt と違っても未編集として扱われる', async ({
  page,
}) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.evaluate((pageId) => {
    const raw = localStorage.getItem('calshare.history')
    const entries: Array<Record<string, unknown>> =
      raw === null ? [] : (JSON.parse(raw) as Array<Record<string, unknown>>)
    const updated = entries.map((entry) => {
      if (entry.id !== pageId) return entry
      const rest: Record<string, unknown> = { ...entry, updatedAt: '2026-09-20T00:00:00.000Z' }
      delete rest.version
      return rest
    })
    localStorage.setItem('calshare.history', JSON.stringify(updated))
  }, id)

  await page.goto(`/done?id=${id}`)
  await expect(page.locator('#resend-notice')).toBeHidden()
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
    // テスト用に window へ直接生やす。型を持たないグローバルなので unknown 経由でキャストする
    const withShareCalls = window as unknown as { __shareCalls: unknown[] }
    withShareCalls.__shareCalls = []
    Object.defineProperty(window.navigator, 'share', {
      value: (data: unknown) => {
        withShareCalls.__shareCalls.push(data)
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

test('クリップボードAPIもexecCommandも失敗すると失敗メッセージを表示する', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    })
    document.execCommand = () => false
  })

  await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.getByRole('button', { name: 'コピー' }).click()
  await expect(page.locator('#copy-error')).toBeVisible()
  await expect(page.locator('#copy-message')).toBeHidden()
})
