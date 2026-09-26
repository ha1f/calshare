import { expect, test } from './fixtures'

test('不正なid（生の // による open redirect）は / へ遷移する（シナリオ13）', async ({ page }) => {
  await page.goto('/done?id=//example.com')

  await page.waitForURL((url) => url.pathname === '/' && url.search === '')
  expect(new URL(page.url()).hostname).not.toBe('example.com')
})

test('不正なid（パーセントエンコードされた // による open redirect）は / へ遷移する（シナリオ13）', async ({
  page,
}) => {
  await page.goto('/done?id=%2F%2Fexample.com')

  await page.waitForURL((url) => url.pathname === '/' && url.search === '')
  expect(new URL(page.url()).hostname).not.toBe('example.com')
})

test('id が無い / 短すぎる不正な形式も / へ遷移する', async ({ page }) => {
  await page.goto('/done?id=short')

  await page.waitForURL((url) => url.pathname === '/' && url.search === '')
})

test('この端末の履歴に無い有効な形式のidは /:id へ遷移する（直リンク・別端末）', async ({
  page,
}) => {
  const idNotInHistory = '0123456789ab'

  await page.goto(`/done?id=${idNotInHistory}`)

  await page.waitForURL(new RegExp(`/${idNotInHistory}$`))
})

test('履歴項目の日時やexpiresAtが壊れていても例外にならず、この端末に無い扱いで /:id へ遷移する', async ({
  page,
}) => {
  const id = '0123456789ab'
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await page.evaluate((pageId) => {
    localStorage.setItem(
      'calshare.history',
      JSON.stringify([
        {
          id: pageId,
          url: `${location.origin}/${pageId}`,
          editToken: 't',
          fields: {
            title: '飲み会',
            location: null,
            memo: null,
            start: 'garbage',
            end: null,
            isAllDay: false,
          },
          expiresAt: 'not-a-date',
          createdAt: '2026-09-16T01:00:00.000Z',
          updatedAt: '2026-09-16T01:00:00.000Z',
        },
      ]),
    )
  }, id)

  await page.goto(`/done?id=${id}`)

  await page.waitForURL(new RegExp(`/${id}$`))
  expect(errors).toEqual([])
})
