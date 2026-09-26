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

  // rawText を変えても manual にした日時は上書きされない
  await input.fill('9/20 19時 渋谷で飲み会。会費500円')
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
