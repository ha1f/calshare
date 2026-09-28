# 運用 runbook 一覧

## 方針

エージェントが土台（スクリプト・ワークフロー・PR の下書き）を作り、オーナーは承認と
判断だけを行う。Issue を起票して終わりにせず、承認すれば進む状態まで作り込む
（docs/design.md §13）。同じ作業が再発したら、次に人がやり直すのではなく、スクリプト・
GitHub Actions ワークフロー・`.claude/skills/` のスキルのいずれかが先に動くようにする。

各 runbook は次の構成で統一する: 目的 / 自動化されていること / オーナーが行う最小の作業 /
判断が必要な事項 / 失敗したときの見方。

## スクリプトのテスト

`scripts/` と `.claude/skills/*/scripts/` は Node 標準ライブラリのみで書かれ、`node:test` でテストする。
実行は次のコマンドに統一する。CI（`ci.yml`）でも同じコマンドが走る。

```sh
npm run test:scripts
```

Node 22 以降の `node --test` は位置引数を glob として扱い、ディレクトリを渡しても中を探さない。
個別に実行するときは `node --test "scripts/**/*.test.mjs"` のように glob で指定する。

## 公開までの順序（オーナーの作業だけを番号順に）

1. **サービス名とドメインを決める**（[naming.md](naming.md)、H1）。候補一覧と商標検索の
   手順から絞り込み、レジストラでドメインを取得する。
2. **Cloudflare アカウント作成**（H2）。Workers Free で始める。Workers Paid（$5/月）の契約は
   OGP 画像生成を有効にするときに行う（[provisioning.md](provisioning.md) の「有料プランへ
   移って OGP 画像生成を有効にする」節、design.md §1.2）。
3. **API トークンの発行と GitHub Secrets 登録**（[cloudflare-api-token.md](cloudflare-api-token.md)、H5）。
4. **`Provision Cloudflare resources` を実行**し、出てきた PR（`chore/provision-ids`）を
   レビューしてマージする（[provisioning.md](provisioning.md)、H4）。OGP 画像生成は既定で
   無効なので、この時点ではフォント配置（`with_font`）は不要。
5. **初回デプロイを承認する**: `gh variable set PUBLIC_DOMAIN` → `gh variable set
   DEPLOY_ENABLED --body true`（[deploy.md](deploy.md)、H9）。次の手順 6 のゾーンがまだ
   `active` になっていない場合、`PUBLIC_DOMAIN` は一旦 `<worker名>.<account>.workers.dev`
   にしておき、手順 6 の完了後に実ドメインへ変更して再デプロイする（deploy.md）。
   `RATE_LIMIT_PEPPER` の登録（H6）はこのデプロイの中で自動的に完了する。
6. **ドメインが決まったら** `domain` 付きで provision を再実行し、表示されたネームサーバーを
   レジストラに設定する。ゾーンが `active` になった回に自動作成される PR は、
   `gh variable set PUBLIC_DOMAIN --body <ドメイン>` を先に実行してからマージする
   （[custom-domain.md](custom-domain.md)、H3。手順 5 で workers.dev のまま公開していた場合、
   先に変数を更新しないと切り替わるまでの間 403 になる）。`/api/*` の WAF レート制限（H13）は
   この実行に含まれて自動作成される。
7. **（任意）通報通知の Webhook を発行**し `REPORT_WEBHOOK_URL` を登録する（H7）。
8. **利用規約・プライバシーポリシー・通報ポリシーの値を決めて承認する**
   （[legal.md](legal.md)、H10）。
9. **LINE 実機で最終確認する**（[line-device-test.md](line-device-test.md)、H14）。
10. 公開後は **通報対応**（[moderation.md](moderation.md)、H11）と
    **使用量の監視**（[usage.md](usage.md)、H12）が継続的な運用作業として残る。
11. **（任意）OGP 画像生成を有効にする**: Workers Paid（$5/月）を契約し、
    `Provision Cloudflare resources` を `with_font=true` で実行してフォントを配置し、
    `wrangler.jsonc` の `OGP_RENDERING` を `"true"` にして deploy する
    （[provisioning.md](provisioning.md)「有料プランへ移って OGP 画像生成を有効にする」、
    [fonts.md](fonts.md)、H8）。

## runbook 一覧

| runbook | 対応する H | 目的 |
|---|---|---|
| [naming.md](naming.md) | H1 | サービス名候補とドメイン確認、商標検索の手順 |
| [rename.md](rename.md) | H1 | 決定した名前・ドメインをリポジトリに反映する |
| [cloudflare-api-token.md](cloudflare-api-token.md) | H5 | 最小権限の API トークン発行と検証 |
| [provisioning.md](provisioning.md) | H2〜H8, H13 | Cloudflare リソース作成とシークレット登録の全体像 |
| [custom-domain.md](custom-domain.md) | H3 | 独自ドメインの割り当てと WAF レート制限 |
| [deploy.md](deploy.md) | H9 | 本番デプロイと公開承認 |
| [fonts.md](fonts.md) | H8 | OGP 用フォントの取得・サブセット化・配置（OGP 画像生成を有効にするときのみ） |
| [legal.md](legal.md) | H10 | 規約類の値決定と承認手順 |
| [moderation.md](moderation.md) | H11 | 通報対応（非表示・解除・一括非表示） |
| [usage.md](usage.md) | H12 | Cloudflare 使用量の定期監視としきい値超過時の対応 |
| [line-device-test.md](line-device-test.md) | H14 | LINE 実機でのカレンダー追加・ics 取り込み確認 |
| [public-repo.md](public-repo.md) | — | リポジトリの public 化直後に必要な GitHub 設定（Dependabot・secret scanning・ブランチ保護等） |

## 関連スキル（`.claude/skills/` に存在するもの）

| スキル | 使いどころ |
|---|---|
| `owner-task` | 人間にしかできない作業が見つかったとき、Issue を起票して終わりにせず承認できる土台まで作る |
| `ops-audit` | `.github/workflows/*.yml`・`scripts/**`・`docs/runbooks/**` の権限・シークレット・注入・runbook との乖離を横断監査する |
| `go-live-check` | 公開前・公開直後に「今、公開してよい状態か」を機械的に確認する |
| `legal-review` | `docs/legal/*.md` を実装の事実・日本法・文書間整合の3方向から審査する |
| `license-review` | フォント・npm パッケージ等の外部成果物のライセンスを審査し記録する |
| `moderation-triage` | 通報 1 件ごとに非表示・維持・保留を根拠つきで判定する（実行はオーナー承認後） |
| `security-audit` | design.md §9 のセキュリティ対策が実装されているかを判定と根拠付きで報告する |
| `concept-review` | PR・設計変更が docs/concept.md の原則から逸脱していないかを指摘する |
| `dependency-audit` | npm 依存の脆弱性・更新・ライセンスを監査する（`package.json` が無い間は対象外） |
