# 通報対応（H11）

## 目的

通報を受け取ってから該当ページを非表示・解除するまでの手順を、Cloudflare ダッシュボードでの
手作業ではなく `.github/workflows/moderation.yml`（`workflow_dispatch`）の 1 回の実行で行う。
実行結果は Actions のサマリと、`moderation-log` ラベルの Issue「[運用] 通報対応ログ」への
コメントとして残る。

## 自動化されていること

- SQL の組み立ては `scripts/cf/moderation-sql.mjs` が担う（page_id は 12 文字の Crockford Base32、
  ハッシュ値は許可文字のみを検証してから埋め込むため、SQL インジェクションにならない）。
- `action = hide-by-creator` を選ぶと、まず `page_id` から送信元（`creator_ip_hash` /
  `creator_device_id`）を `SELECT` で特定し（design.md §9.4 の一括非表示と同じ条件）、
  その送信元の `active` なページをまとめて `hidden` にする。
- 更新の前に必ず対象件数を `SELECT COUNT(*)` で確認し、対象ページ id の一覧も取得して
  Actions のサマリと Issue コメントに残す（件数・id の一覧・実際の更新対象は同じ `WHERE` 句を
  共有しているのでずれない。誤って巻き込んだページがあれば、その id を控えて `unhide` で
  1 件ずつ戻せる）。
- `creator_ip_hash` / `creator_device_id` の値は Actions のログにマスクして出し、生の値は
  ログに残さない（design.md §9.5/§9.6）。
- 実行結果（action・page_id・対象件数・対象 id・note・実行者・実行時刻）を Issue にコメントとして
  残す。Issue が無ければ自動で作る。

## オーナーが行う最小の作業

1. 通報の Discord / Slack 通知（design.md §9.4）を見て、対象ページの詳細ページ URL 末尾の
   12 文字（`page_id`）を控える。
2. GitHub の Actions タブ → `moderation` ワークフロー → `Run workflow` を開く。
3. 次を入力して実行する。
   - `action`: `hide`（非表示にする） / `unhide`（非表示を解除する） / `hide-by-creator`
     （同じ送信元のページを一括非表示にする）
   - `page_id`: 対象ページの ID（12 文字）
   - `note`: 判断の根拠など、記録に残したいメモ（任意）
4. 実行後、Actions のサマリと Issue「[運用] 通報対応ログ」で結果を確認する。反映まで
   最大 60 秒（OGP 画像のキャッシュは最大 5 分）かかることがある（design.md §2.4）。

**誤って非表示にしたとき**: 同じワークフローを `action: unhide`、同じ `page_id` で再実行する。
**`hide-by-creator` で無関係なページを巻き込んだとき**: サマリまたは Issue コメントに残る
対象 id の一覧から該当ページを特定し、それぞれ `action: unhide` で 1 件ずつ戻す。

## 判断基準の例

- 通報が 1 件で内容も軽微 → 詳細ページを自分で開いて確認し、明らかな問題が無ければ何もしない
  （`report_count` はそのまま残る。§9.4 は自動非表示のしきい値を設けない設計）。
- スパムらしき内容で `report_count >= 3`、または通知に出る「同一送信元の有効ページ数」が多い
  → `hide-by-creator` で送信元ごと非表示にする。
- 個人情報（`personal_info`）の通報 → 内容を問わず速やかに `hide` する。判断に迷う暇があるなら
  先に非表示にして後で `unhide` する方が安全（`unhide` はいつでもやり直せる）。
- 通報が事実誤認・いたずらと判断できる → 何もしない（`note` にその判断を書いて記録だけ残したい
  場合は、`hide` した直後に `unhide` するのではなく、Issue に直接コメントしてよい）。

## 失敗したときの見方

- `wrangler.jsonc の有無を確認する` ステップで失敗する場合、足場と provision の PR が
  まだマージされていない。両方をマージしてから再実行する。
- `SQL を組み立てる` ステップで失敗する場合、`page_id` の形式が不正（12 文字の Crockford Base32
  小文字以外）である可能性が高い。エラーメッセージには入力した値と許可される文字（形式）が
  表示されるが、どの 1 文字が不正かまでは特定されない。
- `hide-by-creator` で `対象が見つかりませんでした` と出た場合、指定した `page_id` が存在しない
  （期限切れで GC 済みも含む）。
- `対象件数が0件のため、更新を実行せずに終了します` と出て失敗（赤）になった場合、D1 は変更されて
  いない。`page_id` の指定違い、または既に同じ操作（`hide`/`unhide`）を実行済みであることが多い。
  現在の状態を確認してから、必要な `action` で再実行する。
- `更新を実行する` ステップで失敗する場合、`CLOUDFLARE_API_TOKEN` の権限不足か D1 データベース
  `calshare` への到達性の問題。`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` が GitHub Secrets
  に登録済みであること（`docs/runbooks/cloudflare-api-token.md` の H5 の作業）を確認する。
- Issue へのコメントが付かない場合、`issues: write` 権限か `moderation-log` ラベルの作成に失敗して
  いないかログを確認する。
