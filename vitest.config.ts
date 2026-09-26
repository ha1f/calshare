import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Vitest 4 の test.projects を 1 ファイルに書く。
// wrangler は .dev.vars を読むと "Using secrets defined in .dev.vars" を出す。CI では .dev.vars が無いため出ないが、
// ローカルでテスト出力を汚さないよう wrangler の log レベルを warn 以上に絞る（値自体は miniflare.bindings が優先する）
process.env.WRANGLER_LOG ??= 'warn'

export default defineConfig(async () => {
  const TEST_MIGRATIONS = await readD1Migrations('migrations')

  return {
    test: {
      projects: [
        { test: { name: 'unit', environment: 'node', include: ['test/unit/**/*.test.ts'] } },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              // .dev.vars に依存しないよう secrets はここで与える。E2E_FIXED_NOW は空文字で
              // 上書きし、.dev.vars に設定があっても buildDeps が systemClock を使うようにする
              miniflare: {
                bindings: { TEST_MIGRATIONS, RATE_LIMIT_PEPPER: 'test-pepper', E2E_FIXED_NOW: '' },
              },
            }),
          ],
          test: {
            name: 'integration',
            include: ['test/integration/**/*.test.ts'],
            setupFiles: ['test/integration/setup.ts'],
          },
        },
      ],
    },
  }
})
