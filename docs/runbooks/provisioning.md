# Cloudflare リソースの provisioning

## 目的

design.md §13 の H2〜H8・H13 のうち、Cloudflare 側のリソース作成とシークレット登録を
自動化し、オーナーに残る作業を「契約・トークン発行・1 回のコマンド実行・Actions の実行」
だけに絞る。

## 全体の流れ

```
1. (人) Cloudflare アカウント作成 + Workers Paid 契約                      … H2
2. (人) API トークン発行                                                   … H5
   docs/runbooks/cloudflare-api-token.md
3. (人) scripts/cf/set-github-secrets.sh を 1 回実行
   → CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / REPORT_WEBHOOK_URL(任意) を登録
4. (人) GitHub Actions で provision workflow を実行（workflow_dispatch）
   → preflight: トークン検証、domain 入力の検証
   → resources: D1 / R2 を作成 or 流用、wrangler.jsonc に反映する PR を自動作成 … H4
   → secrets:   RATE_LIMIT_PEPPER を Worker デプロイ済みなら登録、REPORT_WEBHOOK_URL を登録
                （Worker 未デプロイの間はスキップ。初回デプロイでは deploy workflow が
                wrangler deploy と同時に登録するため、H9 の後にもう一度 provision を実行する
                必要は無い）                                                   … H6 / H7
   → zone_and_waf（domain 指定時）: ゾーン作成、WAF レート制限ルール作成、
                ゾーンが active なら routes の PR を自動作成                 … H3 / H13
   → font（with_font=true）: フォントサブセットを R2 に配置                   … H8 のアップロード
5. (人) resources が出した PR (chore/provision-ids) をレビューしてマージ
6. (人) 初回 wrangler deploy（deploy.yml で DEPLOY_ENABLED を true にする。docs/runbooks/deploy.md）
   → wrangler deploy と同時に RATE_LIMIT_PEPPER が自動で登録される（H6 完了）
7. (人) ドメインが決まったら --domain 付きで provision を再実行             … H3（ゾーン作成）
8. (人) レジストラでネームサーバーを変更                                    … H3
9. (人) ゾーンが active になるまで手順 7 を繰り返す。active になった回に
   routes の PR（chore/wrangler-domain）が自動作成されるので、レビューしてマージする
```

手順 4 と 7・9 は同じ workflow（`provision.yml`）の再実行で、`domain` 入力を後から埋めるだけでよい。
`with_font` は既定で true。`wrangler.jsonc` または `scripts/fonts/download-noto-sans-jp.mjs`・
`scripts/fonts/subset.sh` が無ければ `font` ジョブは自動でスキップされる。

## オーナーが行う最小の作業

1. Cloudflare アカウント作成 + Workers Paid（$5/月）契約（H2）。
2. API トークン発行（H5）: `docs/runbooks/cloudflare-api-token.md` の手順どおり。
3. `scripts/cf/set-github-secrets.sh` を 1 回実行する:
   ```sh
   scripts/cf/set-github-secrets.sh
   ```
   引数無しで実行すると対話的にプロンプトが出る（トークンをシェル履歴に残さないため）。
   CI など非対話環境向けに環境変数で渡すこともできる:
   `CLOUDFLARE_API_TOKEN=xxxx CLOUDFLARE_ACCOUNT_ID=xxxx scripts/cf/set-github-secrets.sh`
   （`REPORT_WEBHOOK_URL` は任意）
4. GitHub の Actions タブから `Provision Cloudflare resources` を Run workflow する。
   ドメイン未定なら `domain` は空のまま、`with_font` は既定の true のままでよい。
5. `resources` ジョブが `wrangler.jsonc` を書き換える PR（`chore/provision-ids`）を作ったら
   内容を確認してマージする。
   - 初回のみ: リポジトリの **Settings → Actions → General → Workflow permissions** で
     **Allow GitHub Actions to create and approve pull requests** を有効にしておくこと。
     無効のままだと `gh pr create` が失敗する（H4 に付随する一度限りの設定）。
   - この PR は `GITHUB_TOKEN` で作られるため `pull_request` トリガーの CI は自動で走らない
     （GitHub の仕様）。必須チェックを設定している場合は、PR を一度 close → reopen するか
     空コミットを push してから CI を走らせる。
6. 初回デプロイ（H9。`docs/runbooks/deploy.md` の手順で `DEPLOY_ENABLED` を `true` にする）。
   `RATE_LIMIT_PEPPER` は deploy workflow が `wrangler deploy` と同時に自動で登録するので、
   これ以上の作業は不要（H6 完了）。
7. ドメイン決定後: `Provision Cloudflare resources` を `domain` 付きで実行し、
   `zone_and_waf` ジョブが出すネームサーバーをレジストラに設定する（H3。手順は
   `docs/runbooks/custom-domain.md`）。ゾーンが `active` になるまで同じ `domain` で
   再実行し、`active` になった回に自動作成される routes の PR をレビューしてマージする。
8. （任意）Discord/Slack の Incoming Webhook URL を発行して GitHub Secrets の
   `REPORT_WEBHOOK_URL` に設定する（H7）。設定済みなら次の provision 実行、または次回の
   デプロイで自動的に Worker のシークレットへ反映される。

これ以外（D1/R2 の作成、`database_id` の書き換え、`RATE_LIMIT_PEPPER` の生成と登録、
ゾーン作成、WAF レート制限ルールの作成、`routes` の設定、フォントの R2 アップロード）は
provision / deploy の各 workflow が行う。

## Workers Paid 契約が要る根拠

design.md §1.2 のとおり、OGP 画像生成（satori + resvg）は 1 リクエストあたり 100〜300ms 級の
CPU 時間を要し、Workers Free の上限（1 リクエスト 10ms）を超える。超過は例外ではなく isolate の
強制終了（エラー 1102）になるため、フォールバックも効かない。OGP は認知獲得の主経路
（concept §03）なので、Paid 契約（$5/月）を Phase 1 の唯一の固定費として受け入れる
（concept §09 の「無料枠のまま放置できる」からの意図的な逸脱。§14.2 の未決事項 7）。

## Paid 契約前に provision を実行した場合に何が起きるか

- `scripts/cf/check-token.mjs` と `ensure-resources.mjs`（D1・R2 の作成）は、プランに関わらず
  成功する（D1・R2 の作成自体は Paid 限定機能ではない）。
- ただし、その状態で Worker を本番デプロイして OGP 生成が呼ばれると、Free プランの CPU 時間
  上限（10ms）を超えて isolate が強制終了し、OGP 画像が生成できない（design §1.2）。
- つまり provisioning は Paid 契約前でも進められるが、実際にサービスとして動かす前には
  Paid への契約が必須。手順としては H2 を最初に済ませてから H9（初回デプロイ）に進むこと。

## RATE_LIMIT_PEPPER 登録のタイミングについて

`secrets` ジョブは、Cloudflare API で Worker（`calshare`）がデプロイ済みかを確認してから
`RATE_LIMIT_PEPPER` を登録する（`scripts/cf/ensure-secret.mjs --require-deployed`）。
未デプロイの間は登録せず、理由を step summary に出して正常終了する。Worker が無い状態で
`wrangler secret put` を実行すると、wrangler が中身の無い Worker を作ってしまうため。

`RATE_LIMIT_PEPPER` が無いまま公開されると、HMAC 鍵が無いため作成と通報の API が失敗する。
そのため初回デプロイでは、`deploy.yml` が `RATE_LIMIT_PEPPER` を生成し、
`wrangler deploy --secrets-file` でコードと同時に登録する（`docs/runbooks/deploy.md`）。
provision の再実行を待たずに初回デプロイの中で登録が終わり、pepper の無いバージョンが
公開される時間は無い。provision の `secrets` ジョブは、その後の再実行で（例えばドメイン確定時に
手順 7 を実行したとき）既に登録済みであることを確認するだけになる。

provision の `secrets` ジョブが先に `RATE_LIMIT_PEPPER` を登録している場合（Worker を手動で
デプロイした後に provision を実行した場合など）も、deploy workflow は登録済みの値を
`wrangler secret list` で見つけて変えない。一度登録した値は、どちらの workflow も上書きしない
（`--force` を付けない）。

## 判断が必要な事項

- ドメイン（H1）が決まるまでは `zone_and_waf` はスキップされる。ドメインが仮決めの間は
  `domain` 入力を空のまま運用してよい。
- `with_font` を false にして手動でフォントを配置する場合は、H8 のライセンス確認
  （SIL OFL）の責任がオーナーに残る。

## 失敗したときの見方

- 各ジョブの GitHub Actions 実行ログと、実行のまとめ（Step Summary）に各スクリプトの
  Markdown 表出力が残る。
- `preflight` が失敗したら `docs/runbooks/cloudflare-api-token.md` の権限テンプレートを見直す。
- `resources` の PR 作成が失敗したら、上記「Allow GitHub Actions to create and approve pull
  requests」設定を確認する。
- `secrets` がスキップされた場合は上記「RATE_LIMIT_PEPPER 登録のタイミング」を参照する。
  初回デプロイ（H9）が終わっていれば `deploy.yml` 側で登録済みのはずなので、
  `secrets` ジョブが再びスキップと表示される場合は「Worker 未デプロイ」以外の理由が無いか
  （`wrangler.jsonc` の `name` が Step Summary の「Worker 名を決める」の出力と一致しているか）を
  確認する。
- `zone_and_waf` が失敗したら、対象ドメインが `ensure-zone.mjs` で先に作成済みかを確認する
  （`ensure-waf-rate-limit.mjs` はゾーンが無いとエラーになる）。routes の PR が作られない
  場合は `docs/runbooks/custom-domain.md` の「失敗したときの見方」を参照する。

## 要検証

- Free プランでの WAF レート制限（`ensure-waf-rate-limit.mjs`）のパラメータ制約。
  `docs/runbooks/custom-domain.md` に判明している制約（period は 10 秒単位）を記載している。
- `wrangler r2 object put` が既定でローカルシミュレータと本番 R2 のどちらに書き込むか
  （font ジョブでは `--remote` を明示している）。
- http_ratelimit フェーズにルールが 1 つも無いときの GET の挙動（404 か、空配列での 200 か）。
- Cloudflare ダッシュボードのカスタムトークン画面に `Account | Zone | Edit` が実在するか
  （`docs/runbooks/cloudflare-api-token.md` 参照）。
