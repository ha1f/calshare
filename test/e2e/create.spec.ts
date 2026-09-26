import { expect, test } from './fixtures'

const DONE_URL_PATTERN = /\/done\?id=[0-9a-hjkmnp-tv-z]{12}$/

function waitForCreateRequest(page: import('@playwright/test').Page) {
  return page.waitForRequest((r) => r.url().endsWith('/api/pages') && r.method() === 'POST')
}

test('入力〜プレビュー〜作成〜/done への遷移まで（シナリオ1）', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')

  await expect(page.getByTestId('view-title')).toHaveText('飲み会')
  await expect(page.getByTestId('view-datetime')).toHaveText('9月20日(日) 19:00〜20:00')
  await expect(page.getByTestId('view-location')).toHaveText('渋谷')

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const body = request.postDataJSON()
  expect(body.source).toBe('direct')
  expect(body.fields.title).toBe('飲み会')

  await page.waitForURL(DONE_URL_PATTERN)
})

test('日時を手動修正すると入力欄を変えても上書きされず、自動に戻すで戻る（シナリオ4前半）', async ({
  page,
}) => {
  await page.goto('/')
  const input = page.locator('#input')
  await input.fill('9/20 19時 渋谷で飲み会')
  await expect(page.getByTestId('view-datetime')).toHaveText('9月20日(日) 19:00〜20:00')

  await page.getByTestId('view-datetime').click()
  await page.getByTestId('start-input').fill('2026-09-21T10:00')
  await page.getByTestId('end-input').fill('2026-09-21T11:00')

  // rawText を変えても manual にした日時は上書きされない。再解釈が完了したことを
  // メモの更新で確認してから start-input を見る（デバウンス前に見ると検証にならない）
  await input.fill('9/20 19時 渋谷で飲み会\n会費5000円')
  await expect(page.getByTestId('view-memo')).toHaveText('会費5000円')
  await expect(page.getByTestId('start-input')).toHaveValue('2026-09-21T10:00')

  await page.getByTestId('reset-datetime').click()
  await expect(page.getByTestId('view-datetime')).toHaveText('9月20日(日) 19:00〜20:00')
})

test('場所を空にすると場所なしとして作成される（シナリオ4後半: 空にすると使わない）', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')
  await expect(page.getByTestId('view-location')).toHaveText('渋谷')

  await page.getByTestId('view-location').click()
  await page.getByTestId('input-location').fill('')

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const body = request.postDataJSON()
  expect(body.fields.location).toBeNull()

  await page.waitForURL(DONE_URL_PATTERN)
})

test('「場所にする」で場所とタイトルが入れ替わる（シナリオ5）', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷')

  await expect(page.getByTestId('view-title')).toHaveText('渋谷')
  await expect(page.getByTestId('use-as-location')).toBeVisible()

  await page.getByTestId('use-as-location').click()

  await expect(page.getByTestId('input-location')).toHaveValue('渋谷')
  await expect(page.getByTestId('input-title')).toHaveValue('9月20日(日) 19:00〜20:00')
})

test('2 行目がメモに入る（シナリオ6前半）', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会\n会費5000円')

  await expect(page.getByTestId('view-memo')).toHaveText('会費5000円')
})

test('13 ヶ月超の日付は下書きとして作成できる（シナリオ11）', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('2028/1/1 予定')

  await expect(page.getByTestId('view-datetime')).toHaveText('作成できるのは13ヶ月先までです')

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const body = request.postDataJSON()
  expect(body.fields.start).toBeNull()
  expect(body.fields.end).toBeNull()

  await page.waitForURL(DONE_URL_PATTERN)
})

test('プリフィルされた項目は manual 表示になり、API は押すまで呼ばれない（シナリオ12前半）', async ({
  page,
}) => {
  let apiCalled = false
  page.on('request', (r) => {
    if (r.url().endsWith('/api/pages')) apiCalled = true
  })

  const search = new URLSearchParams({
    text: '飲み会',
    dates: '20260920T100000Z/20260920T110000Z',
    location: '渋谷',
  })
  await page.goto(`/new?${search.toString()}`)

  await expect(page.getByTestId('input-title')).toHaveValue('飲み会')
  await expect(page.getByTestId('input-location')).toHaveValue('渋谷')
  await expect(page.getByTestId('start-input')).toHaveValue('2026-09-20T19:00')
  await expect(page.getByTestId('end-input')).toHaveValue('2026-09-20T20:00')

  expect(apiCalled).toBe(false)

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const body = request.postDataJSON()
  expect(body.source).toBe('prefill')

  await page.waitForURL(DONE_URL_PATTERN)
})

test('ref=detail_cta からの作成は source が detail_cta になる（シナリオ12後半）', async ({
  page,
}) => {
  await page.goto('/new?ref=detail_cta')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const body = request.postDataJSON()
  expect(body.source).toBe('detail_cta')

  await page.waitForURL(DONE_URL_PATTERN)
})

test('不正な dates だけのプリフィルは何も反映されず source は direct になる', async ({ page }) => {
  await page.goto('/new?dates=garbage')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  expect(request.postDataJSON().source).toBe('direct')

  await page.waitForURL(DONE_URL_PATTERN)
})

test('時刻ありの予定を終日にすると単日の終日として作成できる', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')
  await expect(page.getByTestId('view-datetime')).toHaveText('9月20日(日) 19:00〜20:00')

  await page.getByTestId('view-datetime').click()
  await page.getByTestId('all-day-checkbox').check()
  await expect(page.getByTestId('start-input')).toHaveValue('2026-09-20')
  await expect(page.getByTestId('end-input')).toHaveValue('2026-09-20')
  await expect(page.locator('#error-message')).toBeHidden()

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const fields = request.postDataJSON().fields
  expect(fields.start).toBe('2026-09-19T15:00:00.000Z')
  expect(fields.end).toBe('2026-09-20T15:00:00.000Z')

  await page.waitForURL(DONE_URL_PATTERN)
})

test('日時未定の下書きで終日にチェックしても外れず、日付欄に切り替わる', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('予定')
  await expect(page.getByTestId('view-datetime')).toHaveText(
    '日時を認識できませんでした。タップして直せます（このままだと7日で消えます）',
  )

  await page.getByTestId('view-datetime').click()
  await page.getByTestId('all-day-checkbox').check()

  await expect(page.getByTestId('all-day-checkbox')).toBeChecked()
  await expect(page.getByTestId('start-input')).toHaveAttribute('type', 'date')
  await expect(page.locator('#error-message')).toBeHidden()

  // 開始日を入れないまま送信しても下書き（日時未定）として作成できる
  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const fields = request.postDataJSON().fields
  expect(fields.start).toBeNull()
  expect(fields.end).toBeNull()

  await page.waitForURL(DONE_URL_PATTERN)
})

test('日時未定の下書きで開始だけ入力しても既定の1時間で作成できる', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('予定')

  await page.getByTestId('view-datetime').click()
  await page.getByTestId('start-input').fill('2026-09-20T19:00')
  await expect(page.locator('#error-message')).toBeHidden()

  const [request] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  const fields = request.postDataJSON().fields
  expect(fields.start).toBe('2026-09-20T10:00:00.000Z')
  expect(fields.end).toBe('2026-09-20T11:00:00.000Z')

  await page.waitForURL(DONE_URL_PATTERN)
})

test('日時未定では「場所にする」を出さない', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('渋谷')

  await expect(page.getByTestId('view-title')).toHaveText('渋谷')
  await expect(page.getByTestId('use-as-location')).toBeHidden()
})

test('先頭の空白を消さずに場所欄へ入力できる', async ({ page }) => {
  await page.goto('/')
  await page.locator('#input').fill('9/20 19時 飲み会')

  await page.getByTestId('view-location').click()
  const locationInput = page.getByTestId('input-location')
  await locationInput.pressSequentially(' 渋谷')
  await expect(locationInput).toHaveValue(' 渋谷')
})
