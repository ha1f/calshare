/**
 * Workers のバインディング・vars・secrets。`D1Database` `R2Bucket` `Fetcher` は
 * `wrangler types` が生成する `worker-configuration.d.ts` の型を使う（`env.ts` の `Env` はモジュール
 * スコープなので、生成ファイルが宣言するグローバルな `Env` とは衝突しない）。
 * secrets の optional 性（`?`）を表すためだけに手書きにしている。
 */
export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS: Fetcher
  PUBLIC_ORIGIN: string // vars
  SERVICE_NAME: string // vars
  RATE_LIMIT_PEPPER?: string // secret（ローカルは .dev.vars）。無い（または空文字）なら作成・通報 API は 503（§9.3）
  REPORT_WEBHOOK_URL?: string // secret。無い（または空文字）なら fakeNotifier を使う（§9.4）
  E2E_FIXED_NOW?: string // e2e の webServer が --var で渡す。ISO8601。PUBLIC_ORIGIN のホスト名が localhost のときだけ有効（§10.3）
}
