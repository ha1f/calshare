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
  6. `wrangler.jsonc` の `name` から Worker 名を決める（`scripts/cf/worker-name.mjs`）
  7. デプロイと同時に登録する secrets を決め、`$RUNNER_TEMP/worker-secrets.json` に書き出す
     （`scripts/cf/ensure-secret.mjs --secrets-file`）。
     - `RATE_LIMIT_PEPPER` が未登録なら生成する（H6 の作業を初回デプロイの中で完結させる。
       登録済みなら値を変えない）
     - `REPORT_WEBHOOK_URL` の GitHub Secret が設定されていれば、同じ値にする（`--force`。H7。
       GitHub Secret が無ければ何もしない。provision の `secrets` ジョブは Worker 未デプロイの間は
       この登録をスキップするため、初回デプロイではここが唯一の登録経路になる）
     - 登録済みかどうかは `wrangler secret list` で判定する。一覧を取れないときは Cloudflare API で
       Worker の有無を確かめ、まだ無いと確認できたとき（初回）だけ未登録として扱う。それ以外は
       既存の値を上書きしないよう、何も書き出さずに失敗する
  8. `npx wrangler d1 migrations apply calshare --remote`
  9. `npx wrangler deploy --var "PUBLIC_ORIGIN:https://$PUBLIC_DOMAIN"`。手順 7 で書き出したものが
     あれば `--secrets-file` を付け、新しいバージョンと secrets を同時に有効にする（含めなかった
     登録済みの secrets はそのまま引き継がれる）。`wrangler secret put` を使わない理由:
     デプロイの後に行うと、その間の Worker は `RATE_LIMIT_PEPPER` 無しで動き、作成と通報が失敗
     する。Worker がまだ無い初回にデプロイの前に行うと、wrangler が中身の無い Worker を先に作る
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
  H2〜H5（Cloudflare アカウント作成、D1/R2 作成、API トークン発行）が完了していること。
  `OGP_RENDERING` は既定で無効なので、H8（フォントの配置）は初回デプロイの前提ではない
  （OGP 画像生成を有効にするときだけ必要。docs/runbooks/provisioning.md「有料プランへ移って
  OGP 画像生成を有効にする」）。`RATE_LIMIT_PEPPER`（H6）と、GitHub Secret `REPORT_WEBHOOK_URL`
  を設定済みなら `REPORT_WEBHOOK_URL`（H7、任意）の Worker シークレットへの登録は、どちらも
  `wrangler deploy` と同時に自動登録されるため事前の準備は不要。
- デプロイ後、`npx wrangler secret list` で `RATE_LIMIT_PEPPER`（と、設定したなら
  `REPORT_WEBHOOK_URL`）が登録されていることを確認する（下記「要検証」）。
- デプロイ後、design.md §14.1 が挙げる「Workers の起動時間制限（グローバルスコープの評価 1 秒）」で失敗していないか
  Actions のログを確認する（`wrangler deploy` 自体は成功しても、初回リクエストで isolate が
  落ちることがある。§2.5 の遅延初期化が効いているかは実機で見るしかない）。
- `wrangler.jsonc` の `workers_dev` が `false` になっているか（H3 完了後の前提。`true` のままだと
  `*.workers.dev` でも同じ内容が見えてしまう）。
- Cloudflare ダッシュボードの Workers Logs で、アプリのログ（`request_completed` など）と
  invocation logs を 1 件ずつ開き、IP アドレス・User-Agent・Cookie などのヘッダや、クエリ文字列を
  含む URL が記録されていないかを見る。記録されていれば、docs/legal/privacy.md のアクセスログの項
  （記録しないと書いた項目）と食い違うので、`wrangler.jsonc` の `observability` の設定で止めるか、
  privacy.md を直す。

## 判断が必要な事項

- **公開してよいか**（H9 そのもの）。H1〜H5・H7〜H8 の前提が整っているかはこのワークフローは
  検証しない。

## 失敗したときの見方

- Actions タブの `deploy` ワークフローの実行を開き、`gate` / `deploy` どちらのジョブで
  止まっているかを見る。`deploy` が灰色（skipped）なら `DEPLOY_ENABLED` が `true` になっていない。
- `npm ci` / `npm run build` で失敗する場合はコード側（他 PR）の問題。ログのエラーメッセージを
  該当 PR にそのまま貼る。
- 公開後に作成と通報だけが 503 になるなら、Worker に `RATE_LIMIT_PEPPER` が無い（design.md §9.3）。
  `npx wrangler secret list` で確かめる。同じ `deploy` workflow を `Run workflow` で再実行すると
  登録される。
- `wrangler d1 migrations apply` で失敗する場合、`CLOUDFLARE_API_TOKEN` の権限不足か、
  D1 データベース `calshare`（`wrangler.jsonc` の `database_id`）が本番に存在しない（H4 未完了）
  可能性が高い。
- `PUBLIC_DOMAIN が設定されていることを確認する` で失敗する場合、上記「オーナーが行う最小の
  作業」の `gh variable set PUBLIC_DOMAIN` を実行してから再実行する。
- `wrangler deploy` で失敗する場合、スクリプトサイズ上限（uncompressed 64 MiB、design.md §1.2）超過か、
  起動時間制限（グローバルスコープの評価 1 秒、design.md §14.1）超過の可能性がある。
- `Worker 名を決める` で失敗する場合、`wrangler.jsonc` に `"name"` が無い。
- `デプロイと同時に登録する secrets を決める` で失敗する場合、`wrangler secret list` の出力を
  判定できず、Worker がまだ無いとも確認できていない（`scripts/cf/ensure-secret.mjs` は既存の値を
  守るため、何も書き出さずに失敗する）。ログを確認し、`CLOUDFLARE_API_TOKEN` の権限か wrangler の
  出力形式の変化を疑う。この時点ではマイグレーションもデプロイもまだ行われておらず、公開中の Worker
  （あれば）は前のバージョンのまま動いている。原因を直したら同じ `deploy` workflow を
  `Run workflow` で再実行する（`DEPLOY_ENABLED` を false に戻す必要はない）。

## 要検証

- Worker がまだ無い初回に、`wrangler deploy --secrets-file` で secrets 付きの Worker が作られること。
  手元では `wrangler deploy --dry-run --secrets-file` でフラグが受け付けられ、`RATE_LIMIT_PEPPER` が
  バインディングに載ることまでしか確認できていない。wrangler 4.141.0 は、まだ無い Worker に secrets を
  渡す方法としてこのフラグを案内している（設定の `secrets.required` に挙げた secret が無いときの
  エラーメッセージ）。初回デプロイの後に `npx wrangler secret list` で確認し、結果を Issue に残す。
- Worker が無いときに `GET /accounts/{account_id}/workers/scripts/{name}/secrets` がエラーコード 10007 を
  返すこと。wrangler 4.141.0 の `wrangler secret list` が同じエンドポイントと同じコードで「Worker が無い」と
  判定していることはソースで確認した。
