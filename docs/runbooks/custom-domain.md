# 独自ドメインの割り当て（H3）

## 目的

サービス名とドメイン（H1）が決まった後、そのドメインを Cloudflare のゾーンとして取り込み、
Worker に割り当てて `*.workers.dev` を閉じる（design §9.9）までの手順を示す。

## 自動化されていること

- ゾーンの作成（`scripts/cf/ensure-zone.mjs`。無ければ作成、あれば流用、ネームサーバーを表示）。
- `/api/*` への WAF レート制限ルールの作成（`scripts/cf/ensure-waf-rate-limit.mjs`）。
- ゾーンが `Active` になった後、`wrangler.jsonc` の `routes` を追加し `workers_dev: false` に
  する PR の自動作成（`scripts/cf/write-wrangler-domain.mjs`。`routes` が既に設定済みなら
  何もしない）。
- 上記はすべて `.github/workflows/provision.yml` の `zone_and_waf` ジョブから `domain` 入力
  （または変数 `PUBLIC_DOMAIN`）を渡すだけで実行される。`PUBLIC_DOMAIN` が
  `<worker名>.<account>.workers.dev` のような workers.dev のホスト名の場合、
  Cloudflare 管理のドメインでゾーンを作成できないため `zone_and_waf` は自動でスキップされる
  （Step Summary にその旨が出る）。実際のドメインを取得したら、`domain` 入力を付けて
  provision を実行する。

## オーナーが行う最小の作業

1. GitHub Actions の `Provision Cloudflare resources` を `domain: <取得したドメイン>` を
   指定して Run workflow する（毎回指定するのが面倒なら、リポジトリの Variables に
   `PUBLIC_DOMAIN` を設定しておけば `domain` 入力を空にしても使われる）。
2. `zone_and_waf` ジョブの出力（Step Summary）に表示されるネームサーバー（2 つ）を、
   ドメインを取得したレジストラの管理画面でネームサーバーとして設定する。
   これは本人認証を伴うレジストラ側の操作のため自動化できない。
3. ネームサーバーの反映後、ゾーンが `Active` になるまで `Provision Cloudflare resources` を
   同じ `domain` で再実行する（`Pending` の間は routes の PR を作らない）。`Active` になった
   回に自動で PR（`chore/wrangler-domain`）が作られる。
4. **この PR をマージする前に** `gh variable set PUBLIC_DOMAIN --body <ドメイン>` を実行する
   （`docs/runbooks/deploy.md` の必須手順）。workers.dev のホスト名で先行公開していた場合、
   PR のマージで走る `deploy` は `workers_dev: false` にする一方 `PUBLIC_ORIGIN` は
   `PUBLIC_DOMAIN`（まだ旧ホスト名のまま）から作るため、先に更新しておかないと
   sameOrigin の検証が本番の Origin と一致せず、切り替わるまでの間、作成・編集・通報が
   403 になる。
5. PR をマージする。マージ後、`main` へのデプロイでカスタムドメインへの割り当てが反映される
   （`custom_domain: true` を指定した `routes` は Cloudflare 側が DNS レコードも含めて
   自動設定する）。

`workers_dev: false` にすることで `*.workers.dev` での応答を止める（design §9.9。Cache API は
カスタムドメイン配下でしか効かないため、これを行わないとキャッシュも効かない）。

## 判断が必要な事項

- ネームサーバー変更後、反映まで数分〜数時間かかることがある（DNS の伝播時間はドメイン・
  レジストラ依存で予測できない）。ゾーンが `Active` になるまでは、手順 3 のとおり
  provision を再実行して待つしかない。

## 失敗したときの見方

- `ensure-zone.mjs` の出力にネームサーバーが出ない場合は `--dry-run` を付けていないか確認する。
- ゾーンが `Pending` のままなら、レジストラ側のネームサーバー設定を再確認する
  （Cloudflare ダッシュボードの該当ゾーンにも診断メッセージが出る）。
- `ensure-waf-rate-limit.mjs` が「ゾーンが見つかりません」で失敗する場合は、先に
  `ensure-zone.mjs`（または `zone_and_waf` ジョブ）でゾーンを作成済みか確認する。
- routes の PR が作られない場合、ゾーンがまだ `Active` になっていないか、`wrangler.jsonc` に
  既に `routes` が設定済み（書き換え対象外）である可能性が高い。Step Summary の
  `write-wrangler-domain.mjs` の出力を確認する。
- WAF レート制限ルールは Free プランの制約で `10 秒に 10 リクエスト超` に固定している
  （design.md H13 の例は「1 分に 60 回」だが、Free プランは period の指定が 10 秒単位のため。
  `scripts/cf/ensure-waf-rate-limit.mjs` のコメント参照）。
