# 使用量監視（H12）

## 目的

Workers Paid の込み枠（design.md §1.2）に対する使用状況を毎週自動で確認し、しきい値
（既定 80%）を超えたときだけオーナーに判断を仰ぐ。込み枠に対する消費は課金に直結するため、
「毎回ダッシュボードを見に行く」運用を「超えたときだけ通知が来る」運用に置き換える。

## 自動化されていること

- `.github/workflows/usage-report.yml` が毎週月曜 09:00 JST（`cron: '0 0 * * 1'`、UTC 0:00）と
  手動実行（`workflow_dispatch`）で走り、`scripts/cf/usage-report.mjs --json` で当月
  （JST 基準）の使用量を Cloudflare GraphQL Analytics API から取得する。
- 取得した使用量を Workers Paid の込み枠と突き合わせ、割合としきい値超過を計算する
  （`scripts/cf/usage-report.mjs` の `summarizeUsage`。込み枠の数値は design.md §1.2 に基づき
  1 箇所の定数 `PLAN_LIMITS` にまとめてある）。
- 結果は毎回 Actions のジョブサマリに Markdown 表で出る。
- しきい値を 1 項目でも超えていたときだけ、`owner help wanted` ラベルの Issue
  「[運用] Cloudflare 使用量がしきい値を超えています」を作る（既に open な同名 Issue があれば
  コメントを追記する）。超過が無ければ Issue は作らない。

## 何を監視しているか

| 項目 | 込み枠（Workers Paid） |
|---|---|
| Workers リクエスト数 | 1,000万 / 月 |
| Workers CPU 時間 | 3,000万 CPU-ms / 月 |
| D1 書き込み行数 | 5,000万行 / 月 |
| D1 読み取り行数 | 250億行 / 月 |
| R2 Class A オペレーション数 | 100万 / 月 |
| R2 Class B オペレーション数 | 1,000万 / 月 |

## 実装側の残タスク

`scripts/cf/usage-report.mjs` の GraphQL クエリ（データセット名・フィールド名）は Cloudflare の
公開ドキュメントに基づく最善の推測で、実アカウントでの疎通確認ができていない
（`UNVERIFIED_NOTES` に列挙）。トークン発行（H5）後、`node scripts/cf/usage-report.mjs` を
1 回実行してエラーの有無を確認し、フィールド名が違っていれば `buildQuery`（Workers CPU 時間は
`buildCpuTimeQuery`）を実際のレスポンス形に合わせて直す。Workers CPU 時間だけは別の GraphQL
リクエストに分けてあるため、この項目のフィールド名が違っていても他の項目（リクエスト数・D1・R2）
のレポートまでは失敗しない。

## オーナーが行う最小の作業

- 通常は何もしない。毎週のサマリは Actions タブの `usage-report` ワークフローの実行から見られる。
- Issue「[運用] Cloudflare 使用量がしきい値を超えています」が作られたら開いて内容を確認し、
  下記の判断が必要な事項に従って対応を決める。
- 今すぐ確認したい場合は Actions タブ → `usage-report` ワークフロー → `Run workflow` で
  手動実行できる。

## 判断が必要な事項

超えた項目に応じて、design.md の対応方針（[§14 リスクと未決事項](../design.md#14-リスクと未決事項)）
を見て次を判断する。

- **CPU 時間が近い**（§14.1 が「上限近傍」と見積もっている項目）: 超過分は $0.02/100万 CPU-ms
  と少額なので、当面は許容するか、OGP 生成専用 Worker への分離（§14.1）を検討するかを判断する。
- **D1 の `rate_limit_counters` の書き込みが多い**: GC（T13）が正しく掃除できているかを疑う
  （§14.1「D1 の `rate_limit_counters` 肥大」）。
- **Workers リクエスト数が想定より多い**: スパムや異常なアクセスが無いか、429 のログ
  （§9.6 の `exceeded` バケット種別）を確認する。
- レポートの「未検証事項」に挙がっている項目（GraphQL のデータセット名・フィールド名など）が
  実際の値と食い違っている疑いがあれば、`scripts/cf/usage-report.mjs` の該当箇所を直す。

## 失敗したときの見方

- `Secrets の登録状況を確認する` ステップが「スキップしました」と出す場合、
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` が GitHub Secrets にまだ登録されていない
  （H5 未完了）。この場合ジョブは失敗せず正常終了する。`main` へのマージ後、H5 を終えるまでは
  毎週この状態が続くのが正常な状態で、失敗メールは届かない。
- `使用量レポートを取得する` ステップで失敗する場合、認可エラー（`Account Analytics:Read` の
  不足。`docs/runbooks/cloudflare-api-token.md` 参照）か、GraphQL のクエリ形状が実際の
  データセットと一致していない可能性がある（`scripts/cf/usage-report.mjs` の
  `UNVERIFIED_NOTES` に列挙した未検証事項を参照）。
- 値が `取得できず`（unavailable）と表示される項目がある場合も同様にクエリ形状のズレを疑う。
  「取得できず」を「0%（問題なし）」と読み替えないこと。
- `schedule` は `main` ブランチにマージされるまで発火しない。マージ直後の週は
  `workflow_dispatch` で手動実行して疎通を確認するとよい。
