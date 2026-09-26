import { defineConfig, devices } from '@playwright/test'

// 複数の作業ツリーで同時に e2e を走らせると、既定の 8787 を掴んだ別のサーバを
// reuseExistingServer が拾って別ビルドを検証してしまう。E2E_PORT で作業ツリーごとに分ける
const port = Number(process.env.E2E_PORT ?? 8787)

export default defineConfig({
  testDir: 'test/e2e',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    // PUBLIC_ORIGIN を上書きしないと wrangler.jsonc の既定値（8787）のままになり、
    // E2E_PORT で別ポートにしたときに API が返す url と実際のサーバのアドレスがずれる
    command: `npm run build && npx wrangler dev --port ${port} --var PUBLIC_ORIGIN:http://localhost:${port}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'line-ios',
      // iPhone 13 の既定は WebKit だが CI は chromium しか install しないので上書きする（isMobile / touch は Chromium でも効く）
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        userAgent: `${devices['iPhone 13'].userAgent} Line/14.0.0`,
      },
    },
  ],
})
