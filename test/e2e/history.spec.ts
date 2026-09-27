import { expect, test } from './fixtures'

const DONE_URL_PATTERN = /\/done\?id=[0-9a-hjkmnp-tv-z]{12}$/
const PAGE_ID_PATTERN = /^[0-9a-hjkmnp-tv-z]{12}$/

function waitForCreateRequest(page: import('@playwright/test').Page) {
  return page.waitForRequest((r) => r.url().endsWith('/api/pages') && r.method() === 'POST')
}

test('作成すると履歴の一覧に出る', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')

  await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  await page.waitForURL(DONE_URL_PATTERN)

  await page.goto('/history')

  const item = page.getByTestId('history-item')
  await expect(item).toHaveCount(1)
  await expect(item).not.toHaveClass(/is-expired/)
  await expect(page.getByTestId('history-title-link')).toHaveText('飲み会')
  await expect(page.getByTestId('history-title-link')).toHaveAttribute(
    'href',
    /^\/[0-9a-hjkmnp-tv-z]{12}$/,
  )
  await expect(page.getByTestId('history-edit-link')).toHaveAttribute(
    'href',
    /^\/[0-9a-hjkmnp-tv-z]{12}\/edit$/,
  )
  await expect(page.getByTestId('history-datetime')).toHaveText('9月20日(日) 19:00〜20:00')
  await expect(page.getByTestId('empty-message')).toBeHidden()
})

test('期限切れの項目はグレー表示になる', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const expired = {
      id: 'abcdefghjkmn',
      url: 'https://example.test/abcdefghjkmn',
      editToken: '0'.repeat(43),
      fields: {
        title: '期限切れの予定',
        location: null,
        memo: null,
        start: '2026-01-01T10:00:00.000Z',
        end: '2026-01-01T11:00:00.000Z',
        isAllDay: false,
      },
      expiresAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2025-12-01T00:00:00.000Z',
    }
    localStorage.setItem('calshare.history', JSON.stringify([expired]))
  })

  await page.goto('/history')

  const item = page.getByTestId('history-item')
  await expect(item).toHaveCount(1)
  await expect(item).toHaveClass(/is-expired/)
  await expect(page.getByTestId('history-expired-badge')).toHaveText('期限切れ')
  await expect(page.getByTestId('history-title-link')).toHaveCSS('color', 'rgb(117, 117, 117)')
})

test('履歴が無いときは空状態の文言が出る', async ({ page }) => {
  await page.goto('/history')

  await expect(page.getByTestId('empty-message')).toBeVisible()
  await expect(page.getByTestId('empty-message')).toHaveText('まだ作成した予定はありません')
  await expect(page.getByTestId('history-item')).toHaveCount(0)
})

test('ヘッダの見え方が / と揃っている', async ({ page }) => {
  await page.goto('/history')

  await expect(page.getByRole('banner')).toHaveCSS('display', 'flex')
  await expect(page.getByRole('link', { name: 'calshare' })).toHaveCSS(
    'text-decoration-line',
    'none',
  )
})

test('localStorage に不正な id を仕込んでもリンクが生成されない', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const validEntry = {
      id: 'abcdefghjkmn',
      url: 'https://example.test/abcdefghjkmn',
      editToken: '0'.repeat(43),
      fields: {
        title: '正しい予定',
        location: null,
        memo: null,
        start: null,
        end: null,
        isAllDay: false,
      },
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2025-12-01T00:00:00.000Z',
    }
    // 表示に使われるのは fields.title なので、ここを書き換えないと
    // 不正な項目が漏れて表示されても検出できない
    const invalidEntries = ['../evil-path', '//evil.example', '//evil.examp'].map((id) => ({
      ...validEntry,
      id,
      fields: { ...validEntry.fields, title: '不正な予定' },
    }))
    localStorage.setItem(
      'calshare.history',
      JSON.stringify([invalidEntries[0], validEntry, invalidEntries[1], invalidEntries[2]]),
    )
  })

  await page.goto('/history')

  // 不正な id の項目は表示自体されず、正しい項目だけが残る
  await expect(page.getByTestId('history-item')).toHaveCount(1)
  await expect(page.getByTestId('history-title-link')).toHaveText('正しい予定')
  await expect(page.getByTestId('empty-message')).toBeHidden()

  const hrefs = await page
    .getByRole('link')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href')))
  for (const href of hrefs) {
    if (href === '/') continue
    expect(href).toMatch(new RegExp(`^/${PAGE_ID_PATTERN.source.slice(1, -1)}(/edit)?$`))
  }
})

test('id は有効だが fields や expiresAt が壊れている項目は表示から除外される', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const validEntry = {
      id: 'abcdefghjkmn',
      url: 'https://example.test/abcdefghjkmn',
      editToken: '0'.repeat(43),
      fields: {
        title: '正しい予定',
        location: null,
        memo: null,
        start: null,
        end: null,
        isAllDay: false,
      },
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2025-12-01T00:00:00.000Z',
    }
    const brokenFields = {
      ...validEntry,
      id: 'bbcdefghjkmn',
      fields: { ...validEntry.fields, start: 'not-a-date' },
    }
    const brokenExpiresAt = { ...validEntry, id: 'cbcdefghjkmn', expiresAt: 'not-a-date' }
    localStorage.setItem(
      'calshare.history',
      JSON.stringify([brokenFields, validEntry, brokenExpiresAt]),
    )
  })

  await page.goto('/history')

  // 壊れた 2 件は握りつぶされ、正しい項目だけが残る（画面全体は白画面にならない）
  await expect(page.getByTestId('history-item')).toHaveCount(1)
  await expect(page.getByTestId('history-title-link')).toHaveText('正しい予定')
  await expect(page.getByTestId('empty-message')).toBeHidden()
})

test('空白を含まない長いタイトルでも一覧が横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/')
  await page.evaluate(() => {
    const entry = {
      id: 'abcdefghjkmn',
      url: 'https://example.test/abcdefghjkmn',
      editToken: '0'.repeat(43),
      fields: {
        title: 'a'.repeat(200),
        location: null,
        memo: null,
        start: null,
        end: null,
        isAllDay: false,
      },
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2025-12-01T00:00:00.000Z',
      updatedAt: '2025-12-01T00:00:00.000Z',
    }
    localStorage.setItem('calshare.history', JSON.stringify([entry]))
  })

  await page.goto('/history')

  await expect(page.getByTestId('history-item')).toHaveCount(1)
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
})
