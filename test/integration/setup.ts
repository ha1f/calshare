import { applyD1Migrations, reset } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach } from 'vitest'

// reset() は D1 のテーブル定義まで消すので、直後に applyD1Migrations で作り直す。
// it() ごとのデータ分離はここで行う。各テストファイルで行を消す必要はない
beforeEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
