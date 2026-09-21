---
name: go-live-check
description: 公開前・公開直後・大きな変更後に「今、公開してよい状態か」を機械的に確認する。「公開してもいい?」「go-live チェックして」「公開判断のチェックリストを見せて」「デプロイ前に確認すべきことある?」「DEPLOY_ENABLED をtrueにする前に確認して」「H9の前提が揃ってるか見て」「今の状態でリリースしていい?」のように、公開可否・リリース判断・デプロイ前後の確認が話題になったら使う。GitHub Secrets/Variables・CI・owner help wanted Issue・法的文書の空欄・design.md §14.2 の未決事項・wrangler.jsonc の設定・Cloudflare 側・LINE 実機確認の記録を横断して判定する。
---

# go-live-check

「公開してよいか」を毎回人力で全項目チェックするのをやめ、機械的に判定できる部分を
`scripts/go-live-check.mjs` に集約する。gh CLI が無い・未認証・Cloudflare のトークンが
ローカルに無い環境でも落ちず、その項目を「確認できなかった項目」に振り分ける。

## 実行する

**公開されるのは `main` なので、最新の `origin/main` をチェックアウトした作業ツリーで実行する。**
別ブランチ・別 worktree（機能追加中のブランチ等）で実行すると、そのブランチにまだ無い足場
（`wrangler.jsonc` 等）が「存在しない」ブロッカーとして誤検出され、報告の大半がブランチの事情の
説明に費やされてしまう。別ブランチで実行するときは `--repo-root` で `main` の作業ツリーを指す。
それもできない（`main` の作業ツリーが無い等）ときは、報告の冒頭に対象ブランチを明記し、ブランチ差分
に由来する項目（`wrangler.jsonc` 不在など）は「確認できなかった項目」に移す。

```sh
node .claude/skills/go-live-check/scripts/go-live-check.mjs
# JSON で欲しい場合
node .claude/skills/go-live-check/scripts/go-live-check.mjs --json
# リポジトリルートが自動検出と違う場合（例: 別 worktree から main を指す）
node .claude/skills/go-live-check/scripts/go-live-check.mjs --repo-root /path/to/main-worktree
```

## スクリプトが機械的に確認する項目

- GitHub Secrets（`CLOUDFLARE_API_TOKEN` `CLOUDFLARE_ACCOUNT_ID` は必須、`REPORT_WEBHOOK_URL` は任意）
- GitHub Variables（`DEPLOY_ENABLED` `PUBLIC_DOMAIN`。値の意味は判定せず設定有無だけ見る）
- CI（`main` の最新実行の成否）
- `owner help wanted` ラベルの open Issue の有無（本文の中身は見ない。件数と一覧だけ）
- `wrangler.jsonc` の `database_id` がプレースホルダのままでないか、`workers_dev` が
  `false` になっているか、`PUBLIC_ORIGIN` が localhost/`.example` の仮値でないか、`routes` の有無
- Cloudflare 側（`scripts/cf/check-token.mjs` `scripts/cf/usage-report.mjs` が存在し、
  ローカルに `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` があるときだけ実行）
- `docs/legal/*.md` の施行日・運営者の空欄
- `docs/design.md` §14.2 未決事項の抽出（番号ごとに blocker/warn を割り当て済み。下記参照）
- `docs/runbooks/line-device-test.md` の「結果」欄の記入有無

## スクリプトが担わない部分（このセッションが都度判断する）

スクリプトは機械的に取れる部分だけを担う。次の 2 つは実行するセッション（Claude）が
Issue や設計書を実際に読んで判断する。手順は `references/checklist.md` にある。

1. **`owner help wanted` Issue 本文の残作業の評価**: スクリプトは件数と一覧しか出さない。
   各 Issue を `gh issue view <番号>` で開き、「オーナーに残る作業」「完了したら進むこと」を読んで
   公開をブロックするかを判断する。
2. **design.md §14.2 未決事項が実際に「決まったか」の確認**: スクリプトは §14.2 の項目を抽出して
   blocker/warn に仕分けるだけで、決まったかどうかまでは読み取らない（決まった場合は §14.2 の
   該当項目や §9 の追記など、設計書側の更新を確認する）。

## 出力フォーマット

`buildReport` が組み立てる固定テンプレート（4 見出し）をそのまま使う。

```
# 公開可否チェック

生成日時: <ISO8601>

## 判定
公開可 / 条件付き公開可（要確認あり） / 公開不可

## ブロッカー
- **<項目>**（<誰が>）: <やること>（現状: <詳細>）

## 推奨事項
- **<項目>**（<誰が>）: <やること>（現状: <詳細>）

## 確認できなかった項目
- **<項目>**（—）: （現状: <確認できなかった理由>）
```

スクリプトの生の出力をそのままチャットに貼らない。`references/checklist.md` の「1. Issue 精査」
「2. 未決事項確認」を行った上で、次のチャット報告用テンプレートにまとめる。判定は1回だけ出す
（Issue 精査を反映した最終値。スクリプト単体の判定と2回出さない）。生成日時はスクリプトの出力の値を
そのまま使う。

```
# 公開可否チェック（<対象ブランチ>）

生成日時: <スクリプト出力の値をそのまま>

## 判定
公開可 / 条件付き公開可（要確認あり） / 公開不可

## ブロッカー
- **H<番号>: <項目>**（<誰が>）: <やること>（根拠: <スクリプトの key> / Issue #<番号>）

## 推奨事項
- **H<番号>: <項目>**（<誰が>）: <やること>（根拠: <スクリプトの key> / Issue #<番号>）

## 確認できなかった項目
- **<項目>**（—）: <確認できなかった理由>

## オーナーの判断事項
<例: REPORT_WEBHOOK_URL を必須にするか任意のままにするか。無ければ「なし」>

## 次のアクション（依存順に3件まで）
1. <最初にやること。docs/runbooks/provisioning.md 等があればその順序に従う>
2. ...
```

## 例

```
$ node .claude/skills/go-live-check/scripts/go-live-check.mjs
...
## 判定
公開不可
...
```

このあと `owner help wanted` の各 Issue を読み、`references/checklist.md` の手順で §14.2 の
未決事項（特に blocker 指定の 1・7）が決まっているかを確認してから、最終的な判定を報告する。
