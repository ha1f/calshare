import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  use: { baseURL: 'http://localhost:8787' },
  webServer: {
    command: 'npm run build && npx wrangler dev --port 8787',
    url: 'http://localhost:8787/api/health',
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
