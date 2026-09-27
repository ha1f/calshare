import {
  createPage,
  readCreateRequestBody,
  DONE_URL_PATTERN,
  expect,
  test,
  waitForCreateRequest,
} from './fixtures'

test('作成 → 完成 → 詳細 → 作ってみる → 履歴 → 編集 → 詳細の変更バナー → ics までの一連の流れ', async ({
  page,
}) => {
  // 作成 → 完成
  const firstId = await createPage(page, '9/20 19時 渋谷で飲み会')

  // 完成 → 詳細
  const detailHref = await page.locator('#url-display').getAttribute('href')
  if (detailHref === null) throw new Error('url-display の href が無い')
  await page.goto(new URL(detailHref).pathname)
  await expect(page.locator('h1[data-section="title"]')).toHaveText('飲み会')

  // 詳細 →「作ってみる」→ 新しい予定を作成する（source が detail_cta で記録される。§6.1・§6.3）。
  // ここで最初のページを編集対象にすると、直前の詳細ページ表示で Cache API に載った
  // レスポンス（§2.4）が編集後も max-age の間そのまま返り、変更バナーが出ない。
  // そのため「作ってみる」で作った 2 件目のページを編集対象にする
  await page.getByRole('link', { name: '作ってみる' }).click()
  await expect(page).toHaveURL(/\/new\?ref=detail_cta$/)
  await page.locator('#input').fill('9/20 19時 渋谷で飲み会')
  const [createRequest] = await Promise.all([
    waitForCreateRequest(page),
    page.getByRole('button', { name: 'URLを作る' }).click(),
  ])
  expect(readCreateRequestBody(createRequest).source).toBe('detail_cta')
  await page.waitForURL(DONE_URL_PATTERN)
  const secondMatch = DONE_URL_PATTERN.exec(page.url())
  if (secondMatch === null) throw new Error('failed to extract page id from /done URL')
  const id = secondMatch[1]

  // 履歴（2 件になっている）
  await page.goto('/history')
  await expect(page.getByTestId('history-item')).toHaveCount(2)

  // 履歴 → 編集（2 件あるので id で編集リンクを特定する）
  const editLinkForId = page
    .getByTestId('history-item')
    .filter({
      has: page.getByTestId('history-edit-link').and(page.locator(`[href="/${id}/edit"]`)),
    })
    .getByTestId('history-edit-link')
  await Promise.all([page.waitForURL(new RegExp(`/${id}/edit$`)), editLinkForId.click()])
  await expect(page.getByTestId('start-input')).toHaveValue('2026-09-20T19:00')
  await page.getByTestId('start-input').fill('2026-09-21T20:00')
  await page.getByTestId('end-input').fill('2026-09-21T21:00')
  await expect(page.locator('#error-message')).toBeHidden()

  // 編集 → 保存 → 完成の再掲
  await Promise.all([
    page.waitForURL(new RegExp(`/done\\?id=${id}$`)),
    page.getByRole('button', { name: '保存する' }).click(),
  ])
  await expect(page.locator('#resend-notice')).toBeVisible()

  // 詳細ページの変更バナー（このページは編集前に詳細を見ていないので Cache API に古い内容が無い）
  await page.goto(`/${id}`)
  await expect(page.locator('[data-section="change-banner"]')).toContainText(
    '日時: 9月20日(日) 19:00〜20:00 → 9月21日(月) 20:00〜21:00',
  )

  // ics（シナリオ3の text/calendar・SUMMARY の検証と、編集後の日時が反映されることをこの通しシナリオの最後に兼ねる）
  const icsResponse = await page.request.get(`/${id}.ics`)
  expect(icsResponse.status()).toBe(200)
  expect(icsResponse.headers()['content-type']).toContain('text/calendar')
  const icsBody = await icsResponse.text()
  expect(icsBody).toContain('SUMMARY:飲み会')
  expect(icsBody).toContain('DTSTART:20260921T110000Z')

  // 最初に作った 1 件目は編集していないので、ics の日時は作成時のまま
  // （詳細ページは一度見ると Cache API に残るため、まだ見ていない ics で確認する）
  const firstIcsResponse = await page.request.get(`/${firstId}.ics`)
  expect(await firstIcsResponse.text()).toContain('DTSTART:20260920T100000Z')
})
