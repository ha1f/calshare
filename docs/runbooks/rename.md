# サービス名・ドメインの反映（H1 決定後）

## 目的

`docs/runbooks/naming.md` でサービス名とドメインを決定した後、リポジトリ内の仮値
（`calshare` / `calshare.example`）を一括で置き換える。

## 自動化されていること

`scripts/apply-service-name.mjs` が次の 3 箇所だけを書き換える（決め打ち。それ以外の
`calshare` 表記は意図的に変えない）。

- `wrangler.jsonc`: `name`（Worker 名）・`vars.SERVICE_NAME`・`routes` 配下のドメイン
  （`--keep-worker-name` を付けると `name` は変えない）
- `README.md`: 先頭見出し（`# calshare`）
- `docs/design.md`: 未決ドメインの仮値（既定 `calshare.example`）

対象ファイルが存在しなければスキップする（`wrangler.jsonc` はアプリ本体の実装がマージ
されるまで存在しない）。D1 の `database_name` と R2 の `bucket_name`（どちらも固定値 `calshare`）は
このスクリプトの対象外で、書き換わらない。理由は下記「実行時期による影響」を参照。

## オーナーが行う最小の作業

1. 変更予定を確認する（書き込みはしない）。初回デプロイの後なら `--keep-worker-name` も付ける
   （下記「実行時期による影響」）。

   ```sh
   node scripts/apply-service-name.mjs --name <slug> --domain <domain> --dry-run
   ```

2. 問題なければ実行する。

   ```sh
   node scripts/apply-service-name.mjs --name <slug> --domain <domain>
   ```

3. 新しいブランチ（`origin/main` から）を切って `git diff` の内容を確認し、変更を PR にする。
4. PR を draft で作成し、レビュー後マージする。

## `apply-service-name.mjs` のオプション

| オプション | 内容 |
|---|---|
| `--name <slug>` | 新しいサービス名（`wrangler.jsonc` の `name` / `SERVICE_NAME`、`README.md` の見出しに使う。英数字とハイフン推奨） |
| `--domain <domain>` | 新しい本番ドメイン（`docs/design.md` の仮ドメイン `calshare.example` を置き換える） |
| `--keep-worker-name` | `wrangler.jsonc` の `name`（Worker 名）は変えず、`SERVICE_NAME`・`README.md`・ドメインだけを変える（初回デプロイ後の改名向け） |
| `--old-name <slug>` | 置き換え対象の現在値（既定: `calshare`） |
| `--old-domain <d>` | 置き換え対象の現在の仮ドメイン（既定: `calshare.example`） |
| `--root <dir>` | リポジトリルート（既定: カレントディレクトリ） |
| `--dry-run` | 書き込みをせず、変更予定の行だけ表示する |
| `--json` | 機械可読な JSON で出力する |

## 実行時期による影響（重要）

**初回デプロイより前なら、すべて変えてよい。初回デプロイの後は `--keep-worker-name` を付けて、
Worker 名（`wrangler.jsonc` の `name`）を変えない。** 画面や OGP に出るサービス名（`SERVICE_NAME`）・
`README.md` の見出し・ドメインは Worker 名と独立しているので、Worker 名を残しても変わる。
Worker 名が利用者に見えるのは `*.workers.dev` の URL だけで、独自ドメインで公開していれば見えない。

`name` の変更は、Cloudflare では「改名」ではなく「別名での新規作成」として扱われる。初回デプロイの後に
`name` を変えると次が起きる。

- 旧 Worker はそのまま残り続ける（削除は別途手動で行う必要がある）。
- 新しい Worker はシークレットを持たない状態から始まる。次の deploy workflow が `RATE_LIMIT_PEPPER` を
  新しい値で作り、`REPORT_WEBHOOK_URL` は GitHub Secret から登録し直す（`docs/runbooks/deploy.md`）。
  旧 Worker の `RATE_LIMIT_PEPPER` は引き継げない。Cloudflare の secret は登録後に読み出せず、
  deploy workflow も値を残さないため。
- `RATE_LIMIT_PEPPER` が変わると、改名前に作られたページと改名後のリクエストで `ip_hash` が一致しなくなる。
  影響（同じ送信元のページの一括非表示の取りこぼし、レート制限と重複通報の判定が弱まること）は
  `docs/architecture.md` の「データの置き場所」にある。改名前に作られたページが保持期限で消えるまで続く。
- カスタムドメインの `routes` を割り当て済み（H3）なら、その割り当ても新しい Worker へ
  付け替える必要がある。
- `*.workers.dev` の URL も新しい Worker 名に基づくものに変わる。`PUBLIC_DOMAIN` を workers.dev の
  ホスト名にしているなら、先に新しいホスト名へ変える（変えないと作成・編集・通報が 403 になる。
  `docs/runbooks/deploy.md`）。

一方、次の 2 点は実行時期に関わらず安全。

- D1 の `database_name` と R2 の `bucket_name` は常に `calshare` 固定で
  `apply-service-name.mjs` の対象外なので、いつ実行してもデータベース・バケットへの
  影響はない（初回デプロイ後に実行しても既存データはそのまま）。
- `README.md` の見出しと `docs/design.md` の仮ドメイン表記の置換は、ドキュメントの
  文字列置換に過ぎないため、実行時期を問わず安全。

まとめると、**Worker 名の変更だけが「初回デプロイ前限定」の作業**で、サービス名の表記と
ドメイン（`--domain`）の反映は、`--keep-worker-name` を付ければ初回デプロイ後でも安全に行える。
`--keep-worker-name` を付けずに `name` が変わる場合、`apply-service-name.mjs` は結果に注意を出す。

## 判断が必要な事項

- 初回デプロイの後に改名する場合、Worker 名も変えるか。変えなければ、workers.dev で公開している間は
  URL に旧名が残る。変えれば、上記の旧 Worker の整理・`routes` の付け替えが要り、
  `RATE_LIMIT_PEPPER` が変わる影響を受け入れることになる。

## 失敗したときの見方

- `[skip]` と表示されたファイルは、対象ファイルがまだ存在しない（`wrangler.jsonc` なら
  アプリ本体の実装がまだマージされていない）。マージ後に再実行する。
- `[--]`（unchanged）と表示された場合、置き換え対象の文字列が既に変わっている
  （二重実行、または `--old-name` / `--old-domain` の指定が実際の値と違う）。
- 不明な引数を渡すとエラーで終了する（`--dryrun` のような打ち間違いも検出される）。
