import { expect, test } from './fixtures'
import { E2E_FIXED_NOW } from './fixedNow'

test('/ が 200 で textarea を表示する', async ({ page }) => {
  const response = await page.goto('/')

  expect(response?.status()).toBe(200)
  await expect(page.locator('#input')).toBeVisible()
  expect(await page.evaluate(() => Date.now())).toBe(E2E_FIXED_NOW.getTime())
})
