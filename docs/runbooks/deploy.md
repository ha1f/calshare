# デプロイと公開承認（H9）

## 目的

calshare の本番デプロイと、それを「公開してよい」というオーナーの承認に直結させる。
`.github/workflows/deploy.yml` は `main` への push と手動実行（`workflow_dispatch`）の両方で走るが、
リポジトリ変数 `DEPLOY_ENABLED` が `true` でなければ実際のデプロイ処理（ビルド・マイグレーション・
`wrangler deploy`）は一切実行されない。**この変数を `true` にする 1 回の操作が、Phase 1 の公開承認**
（design.md §13 H9）になる。

## 自動化されていること

- `main` へマージされるたびに `deploy.yml` の `gate` ジョブが必ず走り、`DEPLOY_ENABLED` の状態を
  ジョブサマリ（Actions の実行結果画面）に出す。
- `DEPLOY_ENABLED=true` のときだけ `deploy` ジョブが走り、次を順に実行する。
  1. `actions/checkout`（SHA 固定、`persist-credentials: false`）
  2. `actions/setup-node`（`node-version-file: .nvmrc`、`cache: npm`）
  3. `PUBLIC_DOMAIN` が未設定ならここで失敗して止まる（下記「オーナーが行う最小の作業」参照。
     `npm ci` やマイグレーション適用より前に確認するため、未設定のまま本番 D1 に
     マイグレーションだけ適用されることはない）
  4. `npm ci`
  5. `npm run build`
  6. `npx wrangler d1 migrations apply calshare --remote`
  7. `npx wrangler deploy --var "PUBLIC_ORIGIN:https://$PUBLIC_DOMAIN"`
  8. `RATE_LIMIT_PEPPER` が未登録なら生成して登録する（`scripts/cf/ensure-secret.mjs`。
     H6 の作業を初回デプロイの中で完結させる。登録済みなら何もしない）
  9. `REPORT_WEBHOOK_URL` の GitHub Secret が設定されていれば、同じ値で Worker のシークレットに
     登録する（`--force`。H7。GitHub Secret が無ければ何もせず終了する。provision の
     `secrets` ジョブは Worker 未デプロイの間はこの登録をスキップするため、初回デプロイでは
     ここが唯一の登録経路になる）
- `concurrency: production` により、デプロイは常に直列実行される（実行中のデプロイを取り消して
  マイグレーションとデプロイの間で状態が壊れることを避けるため、進行中のジョブはキャンセルしない）。

## オーナーが行う最小の作業

### 公開する（初回・以降とも共通）

`PUBLIC_DOMAIN` が未設定のままデプロイすると、sameOrigin の検証（design.md §9.8）が本番の
Origin と一致せず、作成・編集・通報がすべて 403 になる。そのため `PUBLIC_DOMAIN` の設定は
`DEPLOY_ENABLED` を有効にするより前の必須手順にする。

```sh
gh variable set PUBLIC_DOMAIN --body "example.com"   # 本番ドメイン、または workers.dev のホスト名
gh variable set DEPLOY_ENABLED --body true
```

実行後、次の `main` への push（または Actions タブから `deploy` ワークフローを `Run workflow` で
手動実行）でデプロイが走る。ドメインが未定のまま workers.dev で先に公開したい場合は、
`PUBLIC_DOMAIN` に `<worker名>.<account>.workers.dev` を設定する。

### 緊急停止する（デプロイを一時的に止めたいとき）

```sh
gh variable set DEPLOY_ENABLED --body false
```

以降の push は `gate` ジョブだけが走り、デプロイ処理はスキップされる。

### 手動でデプロイし直す（コードは変えず再デプロイしたいとき）

GitHub の Actions タブ → `deploy` ワークフロー → `Run workflow` から `main` を指定して実行する
（`workflow_dispatch` で起動できる）。`DEPLOY_ENABLED=true` になっている必要がある。

### 初回デプロイで確認すること

- H1（サービス名の決定。独自ドメインは workers.dev で先行公開する場合は未取得のままでよい）・
  H2〜H5・H8（Cloudflare 契約、D1/R2 作成、API トークン発行、フォントの配置）が完了していること。
  `RATE_LIMIT_PEPPER`（H6）と、GitHub Secret `REPORT_WEBHOOK_URL` を設定済みなら
  `REPORT_WEBHOOK_URL`（H7、任意）の Worker シークレットへの登録は、どちらもデプロイの中で
  自動登録されるため事前の準備は不要。
- デプロイ後、design.md §14.1 が挙げる「Workers の起動時間制限（グローバルスコープの評価 1 秒）」で失敗していないか
  Actions のログを確認する（`wrangler deploy` 自体は成功しても、初回リクエストで isolate が
  落ちることがある。§2.5 の遅延初期化が効いているかは実機で見るしかない）。
- `wrangler.jsonc` の `workers_dev` が `false` になっているか（H3 完了後の前提。`true` のままだと
  `*.workers.dev` でも同じ内容が見えてしまう）。

## 判断が必要な事項

- **公開してよいか**（H9 そのもの）。H1〜H5・H7〜H8 の前提が整っているかはこのワークフローは
  検証しない。

## 失敗したときの見方

- Actions タブの `deploy` ワークフローの実行を開き、`gate` / `deploy` どちらのジョブで
  止まっているかを見る。`deploy` が灰色（skipped）なら `DEPLOY_ENABLED` が `true` になっていない。
- `npm ci` / `npm run build` で失敗する場合はコード側（他 PR）の問題。ログのエラーメッセージを
  該当 PR にそのまま貼る。
- `wrangler d1 migrations apply` で失敗する場合、`CLOUDFLARE_API_TOKEN` の権限不足か、
  D1 データベース `calshare`（`wrangler.jsonc` の `database_id`）が本番に存在しない（H4 未完了）
  可能性が高い。
- `PUBLIC_DOMAIN が設定されていることを確認する` で失敗する場合、上記「オーナーが行う最小の
  作業」の `gh variable set PUBLIC_DOMAIN` を実行してから再実行する。
- `wrangler deploy` で失敗する場合、スクリプトサイズ上限（uncompressed 64 MiB）超過か、
  起動時間制限（グローバルスコープの評価 1 秒）超過の可能性がある（design.md §14.1）。
- `RATE_LIMIT_PEPPER を確認・登録する` で失敗する場合、`wrangler secret list` の出力を
  判定できていない（`scripts/cf/ensure-secret.mjs` は判定できないと既存の値を守るため
  登録せずに失敗する）。ログを確認し、`CLOUDFLARE_API_TOKEN` の権限か wrangler の出力形式の
  変化を疑う。**この時点で Worker は `wrangler deploy` まで完了して公開済みだが、
  RATE_LIMIT_PEPPER が無いまま動いている**。原因を直したら同じ `deploy` workflow を
  `Run workflow` で再実行し、登録を完了させる（`DEPLOY_ENABLED` を false に戻す必要はない）。
- `REPORT_WEBHOOK_URL を確認・登録する` で失敗する場合も同様に、Worker は既に公開済みのまま
  Webhook 未登録（通報通知が届かない状態）で動いている。原因を直して `deploy` workflow を
  再実行する。
