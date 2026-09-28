# 使用量監視

## 目的

Cloudflare の込み枠に対する使用状況を毎週自動で確認し、しきい値（既定 80%）を超えたときだけ
オーナーに判断を仰ぐ。Phase 1 は Workers Free（無料プラン）で始める前提なので、比較先は
Free の込み枠にしてある。Free は上限のほとんどが 1 日あたりで、超えると課金にはならず
その日はサービスが止まる。「毎回ダッシュボードを見に行く」運用を「超えたときだけ通知が来る」
運用に置き換える。

## 自動化されていること

- `.github/workflows/usage-report.yml` が毎週月曜 09:00 JST（`cron: '0 0 * * 1'`、UTC 0:00）と
  手動実行（`workflow_dispatch`）で走り、`scripts/cf/usage-report.mjs --json` で当月
  （JST 基準）の使用量を Cloudflare GraphQL Analytics API から取得する。
- 取得した使用量を Free の込み枠と突き合わせ、割合としきい値超過を計算する
  （`scripts/cf/usage-report.mjs` の `summarizeUsage`。込み枠の数値は 1 箇所の定数
  `PLAN_LIMITS` にプラン別（`free` / `paid`）にまとめてある）。
- Workers リクエスト数と D1 の読み書き行数は 1 日あたりの上限なので、対象期間（当月）の
  日ごとの値のうち最大の日を上限と比べる（どの日が最大だったかはレポートの表に載る）。
  Workers CPU 時間は Free だと合計に月の枠が無く 1 リクエストあたり 10ms の上限しか無いため、
  分布の p99（`quantiles.cpuTimeP99`）を 10ms と比べる。R2 は Workers のプランと関係の無い
  別枠なので、対象期間の合計を比べる（Paid でも同じ値・同じ集計）。
- 結果は毎回 Actions のジョブサマリに Markdown 表で出る。
- しきい値を 1 項目でも超えていたときだけ、`owner help wanted` ラベルの Issue
  「[運用] Cloudflare 使用量がしきい値を超えています」を作る（既に open な同名 Issue があれば
  コメントを追記する）。超過が無ければ Issue は作らない。

## 何を監視しているか（Free プラン、既定）

| 項目 | 込み枠 | 出典（確認日 2026-09-29） |
|---|---|---|
| Workers リクエスト数（日次最大） | 10 万/日（UTC 0 時にリセット） | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers CPU 時間 p99（ms/リクエスト） | 10ms/リクエスト | 同上（Cron Trigger も同じ上限） |
| D1 書き込み行数（日次最大） | 10 万行/日 | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| D1 読み取り行数（日次最大） | 500 万行/日 | 同上 |
| R2 Class A オペレーション数（月間） | 100 万/月 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| R2 Class B オペレーション数（月間） | 1,000 万/月 | 同上 |

Free の上限に達したときの挙動は項目によって違う。Workers はエラー 1027、D1 はクエリの実行自体が
失敗する（`try`/`catch` で拾えるが、原因取り除きが必要）。CPU 時間はリクエスト単体がエラー 1102
で強制終了し、`try`/`catch` でも捕捉できない。R2 は Workers のプランとは別課金で、無料枠を
超えた分にも 1 単位あたりの単価が付いている（[R2 pricing](https://developers.cloudflare.com/r2/pricing/)
に $4.50/100 万 Class A オペレーションなどの超過単価がある）。そのためこの一覧の中では唯一、
超過が「止まる」ではなく「課金される」形になると見ている。

Free では次の項目は監視していない: D1 のストレージ容量（合計 5GB）、Workers の外部サブリクエスト数
（50/リクエスト）、Cloudflare 内部サービスへの呼び出し数（1,000/リクエスト）。ストレージは
このレポートでは取っておらず、後 2 つはリクエスト単体の制約で期間を通じた集計に向かないため
対象にしていない。

このレポートは週次なので、月の途中で急にしきい値を超えて即日サービスが止まるケースには
間に合わない。込み枠までの余裕がどう減っているかの傾向を見るためのものであって、
停止そのものを防ぐ仕組みではない。

## プランの切り替え（Workers Paid へ移るとき）

`.github/workflows/usage-report.yml` は `--plan` を渡さずに `scripts/cf/usage-report.mjs` を
呼ぶので、週次レポートが比べるプランは `scripts/cf/usage-report.mjs` の `DEFAULT_PLAN` 定数
（既定 `'free'`）1 箇所で決まる。Paid へ移ったら、この定数を `'paid'` に変えるだけでよく、
ワークフロー側は変更不要。`--plan free` / `--plan paid` はローカルでその場だけ別プランを
試したいときのオプションで、指定しなければ `DEFAULT_PLAN` が使われる。

Paid の込み枠は `PLAN_LIMITS.paid` にまとめてある（確認日 2026-09-29、
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)・
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) の Paid 欄）。
Paid はリクエスト数に日次上限が無く、月間 1,000 万リクエスト・CPU 時間 3,000 万 CPU-ms・
D1 書き込み 5,000 万行・D1 読み取り 250 億行が込みで、超過分は少額課金になる。

## 実装側の残タスク

`scripts/cf/usage-report.mjs` の GraphQL クエリ（データセット名・フィールド名）は Cloudflare の
公開ドキュメントに基づく最善の推測で、実アカウントでの疎通確認ができていない
（`UNVERIFIED_NOTES` に列挙）。特に次の 2 点は確度が低い。

- Workers リクエスト数・D1 の読み書き行数を日ごとに集計するための `dimensions { date }` が、
  実際の GraphQL スキーマで使えるかどうか。公開ドキュメントのクエリ例は D1 側にしか無く、
  Workers 側（`workersInvocationsAdaptive`）は推測で流用している。これが違う場合、GraphQL が
  エラーを返すため「使用量レポートを取得する」ステップそのものが失敗する（他の項目だけ
  「取得できず」になって緑で終わるわけではない）。
- CPU 時間の p99（`quantiles.cpuTimeP99`）の単位（マイクロ秒と仮定している）。

トークン発行後、`node scripts/cf/usage-report.mjs` を 1 回実行してエラーの有無を確認し、
フィールド名や単位が違っていれば `scripts/cf/usage-report.mjs` の `buildQuery`・
`buildCpuTimeQuery`・`extractUsage` を実際のレスポンス形に合わせて直す。CPU 時間だけは別の
GraphQL リクエストに分けてあるため、この項目が違っていても他の項目（リクエスト数・D1・R2）の
レポートまでは失敗しない。

## オーナーが行う最小の作業

- 通常は何もしない。毎週のサマリは Actions タブの `usage-report` ワークフローの実行から見られる。
- Issue「[運用] Cloudflare 使用量がしきい値を超えています」が作られたら開いて内容を確認し、
  下記の判断が必要な事項に従って対応を決める。
- 今すぐ確認したい場合は Actions タブ → `usage-report` ワークフロー → `Run workflow` で
  手動実行できる。

## 判断が必要な事項

Workers・D1 は Free の上限に達しても課金では解決できず、対応するまで（または翌日 UTC 0 時の
リセットまで）サービスが止まったままになる。R2 だけは超えても止まらず課金が発生する。
超えた項目に応じて次を判断する。

- **Workers リクエスト数・D1 の読み書き行数が日次上限に近い/超えている**: スパムや異常な
  アクセスが無いか、エラーのログを確認する。D1 の `rate_limit_counters` への書き込みが多い
  場合は、期限切れを消す GC（Cron Trigger）が正しく掃除できているかを疑う。
- **Workers CPU 時間の p99 が上限に近い**: 重い処理（OGP 画像生成など）の呼び出し頻度や
  1 回あたりの処理時間を見直す。p99 が 10ms 未満でも、分布の外れ値がエラー 1102 になっている
  可能性はレポートだけでは分からない。
- **R2 のオペレーション数が上限に近い/超えている**: サービスは止まらないので急ぎではないが、
  課金が発生し始めている（または発生する見込みな）ので、想定外の増加が無いか確認する。
- **恒常的に複数の項目が上限に近い**: Workers Paid（$5/月）への切り替えを検討する。込み枠が
  月間の合計値に変わり、超過しても即座には止まらず少額課金で済む。切り替え手順は
  「プランの切り替え」を参照。
- レポートの「未検証事項」に挙がっている項目（GraphQL のデータセット名・フィールド名など）が
  実際の値と食い違っている疑いがあれば、`scripts/cf/usage-report.mjs` の該当箇所を直す。

## 失敗したときの見方

- `Secrets の登録状況を確認する` ステップが「スキップしました」と出す場合、
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` が GitHub Secrets にまだ登録されていない。
  この場合ジョブは失敗せず正常終了する。`main` へのマージ後、トークンを発行するまでは
  毎週この状態が続くのが正常な状態で、失敗メールは届かない。
- `使用量レポートを取得する` ステップで失敗する場合、認可エラー（`Account Analytics:Read` の
  不足。`docs/runbooks/cloudflare-api-token.md` 参照）か、GraphQL のクエリ形状が実際の
  データセットと一致していない可能性がある（`scripts/cf/usage-report.mjs` の
  `UNVERIFIED_NOTES` に列挙した未検証事項を参照）。
- 値が `取得できず`（unavailable）と表示される項目がある場合も同様にクエリ形状のズレを疑う。
  「取得できず」を「0%（問題なし）」と読み替えないこと。取得できた使用量が実際にゼロ件の日は
  「取得できず」ではなく `0` と表示される（区別してある）。
- `schedule` は `main` ブランチにマージされるまで発火しない。マージ直後の週は
  `workflow_dispatch` で手動実行して疎通を確認するとよい。
