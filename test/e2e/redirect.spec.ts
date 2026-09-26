import type { Page } from '@playwright/test'
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

const BROKEN_ENTRY_ID = '0123456789ab'

interface HistoryEntryOverrides {
  url?: string
  fields?: Record<string, unknown>
  expiresAt?: string
}

/** 有効な履歴項目を土台に、1 箇所だけ壊した項目を localStorage に置く */
async function setHistoryEntry(page: Page, overrides: HistoryEntryOverrides): Promise<void> {
  await page.goto('/')
  await page.evaluate(
    ({ id, overrides: o }) => {
      const entry = {
        id,
        url: o.url ?? `${location.origin}/${id}`,
        editToken: 't',
        fields: o.fields ?? {
          title: '飲み会',
          location: null,
          memo: null,
          start: null,
          end: null,
          isAllDay: false,
        },
        expiresAt: o.expiresAt ?? '2026-09-23T01:00:00.000Z',
        createdAt: '2026-09-16T01:00:00.000Z',
        updatedAt: '2026-09-16T01:00:00.000Z',
      }
      localStorage.setItem('calshare.history', JSON.stringify([entry]))
    },
    { id: BROKEN_ENTRY_ID, overrides },
  )
}

// 他のフィールドは全て有効な値のまま、1 箇所だけ壊す。他の検査を外しても
// このケースは通らないように、壊す箇所ごとにテストを分ける
const BROKEN_ENTRY_CASES: Array<[string, HistoryEntryOverrides]> = [
  [
    '日時の文字列がISO8601でない',
    {
      fields: {
        title: '飲み会',
        location: null,
        memo: null,
        start: 'garbage',
        end: null,
        isAllDay: false,
      },
    },
  ],
  ['expiresAtが日付として解釈できない', { expiresAt: 'not-a-date' }],
  ['urlがhttp/https以外のスキームになっている', { url: 'javascript:alert(1)' }],
]

for (const [label, overrides] of BROKEN_ENTRY_CASES) {
  test(`履歴項目が壊れている（${label}）と例外にならず、この端末に無い扱いで /:id へ遷移する`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await setHistoryEntry(page, overrides)
    await page.goto(`/done?id=${BROKEN_ENTRY_ID}`)

    await page.waitForURL(new RegExp(`/${BROKEN_ENTRY_ID}$`))
    expect(errors).toEqual([])
  })
}
