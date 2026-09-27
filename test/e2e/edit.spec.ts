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
  const id = match?.[1]
  if (id === undefined) throw new Error('failed to extract page id from /done URL')
  return id
}

interface HistoryEntry {
  id: string
  url: string
  editToken: string
  fields: { title: string; location: string | null; start: string | null }
  expiresAt: string
  createdAt: string
  updatedAt: string
  version: number
}

async function readHistoryEntry(
  page: import('@playwright/test').Page,
  id: string,
): Promise<HistoryEntry | undefined> {
  return page.evaluate((pageId) => {
    const raw = localStorage.getItem('calshare.history')
    const entries: HistoryEntry[] = raw === null ? [] : (JSON.parse(raw) as HistoryEntry[])
    return entries.find((entry) => entry.id === pageId)
  }, id)
}

test('履歴から編集して保存すると /done に再掲され、履歴と詳細ページに変更が反映される（シナリオ7）', async ({
  page,
}) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')
  const originalEntry = await readHistoryEntry(page, id)

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

  // E2E_FIXED_NOW の下では作成と更新の now() が同一になり updatedAt は変わらないため、
  // 「同じ URL を送り直してください」は version で判定する（§6.2・§8）
  await expect(page.locator('#resend-notice')).toBeVisible()

  // 履歴の fields / expiresAt が新しい日時・場所で上書きされる。expiresAt は
  // 新しい終了（9/21 21:00 JST）+ RETENTION_DAYS_AFTER_LAST_EVENT(7日) で、
  // 作成時の expiresAt（9/27 まで）とは異なる値になるため、上書きされたことの証拠になる。
  // 作成時の url・editToken・createdAt は変えない（§6.4）
  const entry = await readHistoryEntry(page, id)
  expect(entry?.fields.location).toBe('新宿')
  expect(entry?.fields.start).toBe('2026-09-21T11:00:00.000Z')
  expect(entry?.expiresAt).toBe('2026-09-28T12:00:00.000Z')
  expect(entry?.expiresAt).not.toBe(originalEntry?.expiresAt)
  expect(entry?.url).toBe(originalEntry?.url)
  expect(entry?.editToken).toBe(originalEntry?.editToken)
  expect(entry?.createdAt).toBe(originalEntry?.createdAt)
  expect(entry?.version).toBe(2)

  await page.goto(`/${id}`)
  await expect(page.locator('[data-section="datetime"]')).toHaveText('9月21日(月) 20:00〜21:00')
  await expect(page.locator('[data-section="location"]')).toContainText('新宿')
  await expect(page.locator('.change-banner')).toContainText(
    '日時: 9月20日(日) 19:00〜20:00 → 9月21日(月) 20:00〜21:00',
  )
  await expect(page.locator('.change-banner')).toContainText('場所が変更されました')
  await expect(page.locator('.change-banner')).not.toContainText('タイトルが変更されました')
  await expect(page.locator('body')).not.toContainText('渋谷')

  // version > 1 になったページは「最終更新」とカレンダーボタン直下の免責が出る（§6.3・§8）
  await expect(page.locator('[data-section="footer"]')).toContainText('最終更新:')
  await expect(page.locator('[data-section="calendar"] .calendar-notice')).toBeVisible()
})

test('保存ボタンを連打しても PATCH は 1 回しか送られない', async ({ page }) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.goto(`/${id}/edit`)
  await expect(page.getByTestId('input-location')).toHaveValue('渋谷')

  const patchRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH') patchRequests.push(request.url())
  })

  // 通常のクリックは別タスクに分かれ disabled が間に合うため、同一タスク内で
  // click() を直接 3 回呼んで多重送信を再現する
  await page.evaluate(() => {
    const button = document.getElementById('submit') as HTMLButtonElement
    button.click()
    button.click()
    button.click()
  })
  await page.waitForURL(new RegExp(`/done\\?id=${id}$`))

  expect(patchRequests).toHaveLength(1)
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

test('編集画面でも場所欄は自動表示中は view ボタン、タップ後は input が同じラベルで解決する', async ({
  page,
}) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.goto(`/${id}/edit`)
  await expect(page.getByTestId('input-location')).toHaveValue('渋谷')

  await page.getByTestId('reset-location').click()
  const labeledLocation = page.getByLabel('場所').filter({ visible: true })
  await expect(labeledLocation).toHaveAttribute('data-testid', 'view-location')

  await labeledLocation.click()
  await expect(labeledLocation).toHaveAttribute('data-testid', 'input-location')
})
