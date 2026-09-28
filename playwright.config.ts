import { defineConfig, devices } from '@playwright/test'
import { E2E_FIXED_NOW } from './test/e2e/fixedNow'

// 既定を npm run dev の 8787 と分ける。同じポートだと、実時計で動いている dev サーバを
// reuseExistingServer が拾い、固定時刻を前提にしたシナリオが落ちる。
// 複数の作業ツリーで同時に走らせるときも E2E_PORT で分ける
const port = Number(process.env.E2E_PORT ?? 8788)

export default defineConfig({
  testDir: 'test/e2e',
  // failOnFlakyTests が再試行後の成功も flaky として job を落とすため、retries は
  // 原因調査用の trace・スクリーンショットを残す目的だけに使う
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // PUBLIC_ORIGIN を上書きしないと wrangler.jsonc の vars.PUBLIC_ORIGIN のままになり、
    // E2E_PORT で別ポートにしたときに API が返す url と実際のサーバのアドレスがずれる。
    // E2E_FIXED_NOW は .dev.vars に置かない。置くと npm run dev のサーバの時計まで止まる。
    // wrangler dev はローカル R2 にフォントを自動投入しないため、起動前に seed-local-r2.mjs を挟む（§2.5）
    command: `node scripts/seed-local-r2.mjs && npm run build && npx wrangler dev --port ${port} --var PUBLIC_ORIGIN:http://localhost:${port} --var E2E_FIXED_NOW:${E2E_FIXED_NOW.toISOString()}`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    // フォント投入 + build + wrangler dev の起動を毎回まとめて行うため、CI の遅いランナーでは
    // 既定の 60 秒に収まらないことがある。実測の数倍の余裕を持たせる
    timeout: 120_000,
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
