# calshare

予定を書くと URL になる。渡された人は、ボタンひとつで自分のカレンダーに入れられる。
ログイン不要、5秒、無料。Cloudflare Workers と Hono で作っている。

最初のリリースの機能はコードとしてそろっていて、手元で動く。本番環境はまだ無い。公開までの作業は Issue #24 にまとめてある。

## 手元で動かす

Node 22 系（22.13 以上）が必要（`.nvmrc`）。

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply calshare --local
npm run dev
```

`http://localhost:8787` で作成画面が開く。

```sh
npm run test          # unit + 結合 + scripts
npm run test:e2e      # e2e（上の手順の後で。初回は npx playwright install chromium が要る）
```

## ドキュメント

初めての人は [docs/onboarding.md](docs/onboarding.md) から読む。手元で動かす手順、テスト、どこに何があるかをまとめてある。

- [docs/architecture.md](docs/architecture.md) — 全体のしくみ。リクエストの流れ、データの置き場所、コードの層
- [docs/concept.md](docs/concept.md) — なぜ作るのか。原則、画面の流れ、スコープ

ほかの文書（書き方の決まり、詳細設計、運用の手順など）の一覧は docs/onboarding.md の末尾にある。

## ライセンス

オープンソースライセンスでは提供していません（All rights reserved）。閲覧と、Issue / Pull Request による本リポジトリへの貢献のみ許可します。詳細は [LICENSE](LICENSE)。第三者の成果物はそれぞれのライセンスに従います（[docs/licenses](docs/licenses)）。
