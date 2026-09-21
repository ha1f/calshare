# サービス名・ドメインの反映（H1 決定後）

## 目的

`docs/runbooks/naming.md` でサービス名とドメインを決定した後、リポジトリ内の仮値
（`calshare` / `calshare.example`）を一括で置き換える。

## 自動化されていること

`scripts/apply-service-name.mjs` が次の 3 箇所だけを書き換える（決め打ち。それ以外の
`calshare` 表記は意図的に変えない）。

- `wrangler.jsonc`: `name`（Worker 名）・`vars.SERVICE_NAME`・`routes` 配下のドメイン
- `README.md`: 先頭見出し（`# calshare`）
- `docs/design.md`: 未決ドメインの仮値（既定 `calshare.example`）

対象ファイルが存在しなければスキップする（`wrangler.jsonc` はアプリ本体の実装がマージ
されるまで存在しない）。D1 の `database_name` と R2 の `bucket_name`（どちらも固定値 `calshare`）は
このスクリプトの対象外で、書き換わらない。理由は下記「実行時期による影響」を参照。

## オーナーが行う最小の作業

1. 変更予定を確認する（書き込みはしない）。

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
| `--old-name <slug>` | 置き換え対象の現在値（既定: `calshare`） |
| `--old-domain <d>` | 置き換え対象の現在の仮ドメイン（既定: `calshare.example`） |
| `--root <dir>` | リポジトリルート（既定: カレントディレクトリ） |
| `--dry-run` | 書き込みをせず、変更予定の行だけ表示する |
| `--json` | 機械可読な JSON で出力する |

## 実行時期による影響（重要）

**初回デプロイより前に実行するのが安全。** `wrangler.jsonc` の `name` は Worker を一意に
特定するリソース名で、Cloudflare は名前の変更を「改名」ではなく「別名での新規作成」として扱う。
初回デプロイ後に `name` を変更すると次が起きる。

- 旧 Worker はそのまま残り続ける（削除は別途手動で行う必要がある）。
- 新しい名前の Worker はシークレットを一切持たない状態から始まる。`RATE_LIMIT_PEPPER` や
  `REPORT_WEBHOOK_URL`（H6・H7）を登録し直す必要がある。
- カスタムドメインの `routes` を割り当て済み（H3）なら、その割り当ても新しい Worker へ
  付け替える必要がある。
- `*.workers.dev` の URL も新しい Worker 名に基づくものに変わる。

一方、次の 2 点は実行時期に関わらず安全。

- D1 の `database_name` と R2 の `bucket_name` は常に `calshare` 固定で
  `apply-service-name.mjs` の対象外なので、いつ実行してもデータベース・バケットへの
  影響はない（初回デプロイ後に実行しても既存データはそのまま）。
- `README.md` の見出しと `docs/design.md` の仮ドメイン表記の置換は、ドキュメントの
  文字列置換に過ぎないため、実行時期を問わず安全。

まとめると、**Worker 名（`--name` に渡す値）の変更だけが「初回デプロイ前限定」の作業**で、
ドメイン（`--domain`）の反映自体は初回デプロイ後でも安全に行える。

## 判断が必要な事項

- 初回デプロイ前に実行するか、後にするか。後にする場合は上記の旧 Worker の整理・
  シークレットの再登録・`routes` の付け替えを追加の作業として計画する。

## 失敗したときの見方

- `[skip]` と表示されたファイルは、対象ファイルがまだ存在しない（`wrangler.jsonc` なら
  アプリ本体の実装がまだマージされていない）。マージ後に再実行する。
- `[--]`（unchanged）と表示された場合、置き換え対象の文字列が既に変わっている
  （二重実行、または `--old-name` / `--old-domain` の指定が実際の値と違う）。
- 不明な引数を渡すとエラーで終了する（`--dryrun` のような打ち間違いも検出される）。
