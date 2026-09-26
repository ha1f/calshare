# calshare

予定を書くと URL になる。渡された人は、ボタンひとつで自分のカレンダーに入れられる。
ログイン不要、5秒、無料。Cloudflare Workers + Hono で動いている。

状態: 詳細設計まで完了、Phase 1 を実装中。

## ローカルで動かす

Node 22 が必要（`.nvmrc` 参照）。

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply calshare --local
npm run dev
```

テスト:

```sh
npm run test          # unit + integration + scripts
npm run test:e2e      # e2e（他の作業ツリーと同時に動かす場合は E2E_PORT でポートを変える）
```

## ドキュメント

- [docs/concept.md](docs/concept.md) — コンセプト、画面構成、スコープ、未決事項。詳細設計の入力になる資料
- [docs/design.md](docs/design.md) — Phase 1 の詳細設計。技術スタック、データモデル、日時パース仕様、モジュール構成、実装タスク分解
- [docs/runbooks/README.md](docs/runbooks/README.md) — 運用手順（公開までの作業、通報対応、使用量監視など）
- [.claude/skills](.claude/skills) — このリポジトリで使っている AI エージェント向けスキル（監査・レビュー観点の定義）

## ライセンス

オープンソースライセンスでは提供していません（All rights reserved）。閲覧と、Issue / Pull Request による本リポジトリへの貢献のみ許可します。詳細は [LICENSE](LICENSE)。第三者の成果物はそれぞれのライセンスに従います（[docs/licenses](docs/licenses)）。
