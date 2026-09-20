import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeEach } from 'vitest'

// applyD1Migrations は適用済みのマイグレーションを飛ばすので beforeEach でも二重適用にならない
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
