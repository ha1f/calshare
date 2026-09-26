import { createPage, expect, test } from './fixtures'

test('通報フォームから送信すると受付メッセージが出る（シナリオ9）', async ({ page }) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.goto(`/${id}/report`)
  await page.locator('input[name="reason"][value="inappropriate"]').check()
  await page.locator('#comment').fill('不快な内容が含まれています')

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith(`/api/pages/${id}/reports`) && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '報告する' }).click(),
  ])

  // 受付メッセージは reason が妥当ならどの値でも出るため、本文が正しく組み立てられていることは別途見る必要がある
  expect(response.request().postDataJSON()).toEqual({
    reason: 'inappropriate',
    comment: '不快な内容が含まれています',
  })
  expect(response.status()).toBe(200)

  await expect(page.locator('#report-result')).toHaveText(
    '報告を受け付けました。ご協力ありがとうございます。',
  )
  await expect(page.locator('#report-form')).toBeHidden()
})

test('GET /done と GET /new のレスポンスヘッダに CSP と X-Content-Type-Options が付く（シナリオ14）', async ({
  request,
}) => {
  for (const path of ['/done', '/new']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'")
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
  }
})
