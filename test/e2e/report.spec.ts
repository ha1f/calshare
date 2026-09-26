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

test('通報フォームから送信すると受付メッセージが出る（シナリオ9）', async ({ page }) => {
  const id = await createPage(page, '9/20 19時 渋谷で飲み会')

  await page.goto(`/${id}/report`)
  await page.locator('input[name="reason"][value="inappropriate"]').check()
  await page.locator('#comment').fill('不快な内容が含まれています')

  await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith(`/api/pages/${id}/reports`) && res.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '報告する' }).click(),
  ])

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
