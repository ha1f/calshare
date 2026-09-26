import { expect, test } from './fixtures'

const DONE_URL_PATTERN = /\/done\?id=([0-9a-hjkmnp-tv-z]{12})$/

/** トップから作成して /done に遷移させ、ページ ID を返す（他の spec と同じ手順） */
async function createPage(page: import('@playwright/test').Page, text: string): Promise<string> {
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

interface HistoryEntry {
  id: string
  fields: { title: string; location: string | null; start: string | null }
  createdAt: string
  updatedAt: string
}

async function readHistoryEntry(
  page: import('@playwright/test').Page,
  id: string,
): Promise<HistoryEntry | undefined> {
  return page.evaluate((pageId) => {
    const raw = localStorage.getItem('calshare.history')
    const entries: HistoryEntry[] = raw === null ? [] : JSON.parse(raw)
    return entries.find((entry) => entry.id === pageId)
  }, id)
}

// e2e は create API を叩くたびに ip:unknown のレート制限バケットを共有で消費する（§9.3・§10.4）ため、
// この spec 全体で作成は 1 回だけにする
test('履歴から編集して保存すると /done に再掲され、履歴と詳細ページに変更が反映される（シナリオ7）', async ({
  page,
}) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.goto('/history')
  await Promise.all([
    page.waitForURL(new RegExp(`/${id}/edit$`)),
    page.getByTestId('history-edit-link').click(),
  ])

  // GET の現在値が manual としてそのまま埋まる（§6.5）
  await expect(page.locator('#input')).toHaveValue('9/20 19時 渋谷で飲み会')
  await expect(page.getByTestId('input-title')).toHaveValue('飲み会')
  await expect(page.getByTestId('start-input')).toHaveValue('2026-09-20T19:00')
  await expect(page.getByTestId('input-location')).toHaveValue('渋谷')

  await page.getByTestId('start-input').fill('2026-09-21T20:00')
  await page.getByTestId('end-input').fill('2026-09-21T21:00')
  await page.getByTestId('input-location').fill('新宿')
  await expect(page.locator('#error-message')).toBeHidden()

  await Promise.all([
    page.waitForURL(new RegExp(`/done\\?id=${id}$`)),
    page.getByRole('button', { name: '保存する' }).click(),
  ])

  // 履歴の fields / updatedAt が更新される（作成時の url・editToken・createdAt は変えない。§6.4）
  const entry = await readHistoryEntry(page, id)
  expect(entry?.fields.location).toBe('新宿')
  expect(entry?.fields.start).toBe('2026-09-21T11:00:00.000Z')
  expect(entry?.updatedAt).toBe('2026-09-16T01:00:00.000Z')

  await page.goto(`/${id}`)
  await expect(page.locator('[data-section="datetime"]')).toHaveText('9月21日(月) 20:00〜21:00')
  await expect(page.locator('[data-section="location"]')).toContainText('新宿')
  await expect(page.locator('.change-banner')).toContainText(
    '日時: 9月20日(日) 19:00〜20:00 → 9月21日(月) 20:00〜21:00',
  )
  await expect(page.locator('.change-banner')).toContainText('場所が変更されました')
  await expect(page.locator('.change-banner')).not.toContainText('タイトルが変更されました')
  await expect(page.locator('body')).not.toContainText('渋谷')
})

test('localStorage にトークンが無ければ「この端末では編集できません」と出る（シナリオ8）', async ({
  page,
}) => {
  const idNotInHistory = '0123456789ab'

  await page.goto(`/${idNotInHistory}/edit`)

  await expect(page.locator('#cannot-edit-message')).toHaveText(
    'この端末では編集できません。作成した端末で開いてください',
  )
  await expect(page.locator('#edit-form')).toBeHidden()
})

test('pathname に id が無い（直接 /edit を開く）と / へ遷移する', async ({ page }) => {
  await page.goto('/edit')

  await page.waitForURL((url) => url.pathname === '/' && url.search === '')
})
