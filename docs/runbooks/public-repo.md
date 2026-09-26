# リポジトリの public 化

## 目的

CI を前提にする以上、private リポジトリのままでは GitHub Actions の無料枠（private リポジトリは
月2,000分）を消費し続ける。public リポジトリにすれば Actions の利用時間は無制限になり、
Dependabot・secret scanning などのセキュリティ機能も無償で使える。

このリポジトリの可視性（visibility）を private → public に変える操作そのものはオーナーしか
できない（コードを世に出す判断そのものであり、公開している間に取られたクローンやフォークは
private に戻しても消せないため）。この runbook は、public 化した直後に必要になる設定を
土台として作り、オーナーの作業を最小の手順に絞る。

## 自動化されていること

- `scripts/gh/harden-public-repo.sh`: public 化した直後に 1 回実行する設定スクリプト。
  以下を冪等に行う（`--dry-run` で実行予定の API 呼び出しだけを表示できる）。
  - Dependabot alerts / Dependabot security updates の有効化
  - secret scanning と push protection の有効化
  - Private vulnerability reporting の有効化
  - `main` ブランチの保護（必須ステータスチェック `ci`、force push 禁止、削除禁止。
    個人開発のため `required_pull_request_reviews` は付けていない）
  - Actions の一般設定（`enabled`・`allowed_actions`）の確認（表示のみ）
  - Actions の Default workflow permissions が `read` になっているかの確認（`write` のままなら
    `read` に変更する）
  - fork PR のワークフロー承認設定の確認（表示のみ。変更はオーナー判断）
- `SECURITY.md`: 脆弱性の報告先（Private vulnerability reporting）と対象範囲を明示。
- `.github/dependabot.yml`: npm（weekly・グループ化・`versioning-strategy: increase`）と
  github-actions の依存更新。

## オーナーが行う最小の作業

1. リポジトリを public にする。

   ```sh
   gh repo edit ha1f/calshare --visibility public --accept-visibility-change-consequences
   ```

   または GitHub の Settings > General > Danger Zone > Change visibility から行う。

2. `scripts/gh/harden-public-repo.sh` を実行する。

   ```sh
   scripts/gh/harden-public-repo.sh --repo ha1f/calshare
   ```

3. LICENSE を選ぶ（下記 Issue を参照。判断はオーナーに残る）。

## 判断が必要な事項

- **LICENSE の選択**: Issue「[public 化] LICENSE の選択」（`owner help wanted`）にまとめてある。
  選択肢と推奨、影響はそちらを参照。
- **docs/concept.md（収益計画を含む）と docs/legal を public のままにするか**: 同じ Issue に
  「判断が必要な事項」として並べてある。
- **fork PR のワークフロー承認設定**: `harden-public-repo.sh` の手順8で現在値を表示するのみで、
  自動変更はしない。fork からの初回 PR でも承認なしに workflow を動かしてよいかはオーナー判断。
  厳しくするなら Settings > Actions > General > 「Fork pull request workflows from outside
  collaborators」で `Require approval for all outside collaborators` を選ぶ。

## public 化で CI に起きる変化

- **fork からの pull_request では secrets が使えない**。`ci.yml` はもともと secrets を
  参照していないため影響はない。`deploy.yml` `moderation.yml` `provision.yml`
  `usage-report.yml` はいずれも `workflow_dispatch` か `push: [main]` / `schedule` 起動で
  `pull_request` トリガーを持たないため、こちらも影響を受けない。
- **fork からの pull_request では `GITHUB_TOKEN` が read-only になる**。`ci.yml` は
  `permissions: contents: read` のみを使っており、書き込みを行っていないため影響はない。
- **schedule は default branch（`main`）でのみ発火する**。`usage-report.yml` は元々
  `main` で運用する前提なので変化なし。
- **Actions の利用時間が無制限になる**（public リポジトリは無料）。private の間の
  月2,000分の上限を気にする必要がなくなる。
- **secret scanning が既定で有効になる**（public リポジトリは無償）。push protection は
  既定では有効にならないため、`harden-public-repo.sh` の手順3で明示的に有効化する。
- **fork からの初回コントリビューターの PR は、既定で workflow の実行に承認が必要になる**
  （GitHub 側の既定動作）。`harden-public-repo.sh` の手順8で現在の設定を確認できる。
- **要対応**: `harden-public-repo.sh` の手順5で `main` に必須ステータスチェック `ci` を
  設定すると、`provision.yml` が `GITHUB_TOKEN` で自動作成する PR（`chore/provision-ids`・
  `chore/wrangler-domain`）は `pull_request` トリガーの CI が自動で走らないため
  （GitHub の仕様。`GITHUB_TOKEN` で作った PR は他の workflow の起動トリガーにならない）、
  必須チェックが「未実行」のままマージ待ちになる。`docs/runbooks/provisioning.md` に
  既にある回避策（PR を一度 close → reopen する、または空コミットを push して CI を
  走らせる）を使うか、`enforce_admins: false` にしてあるので admin 権限でチェックを
  待たずにマージする。

## 失敗したときの見方

- `harden-public-repo.sh` が `HTTP 403` で失敗する場合、実行している GitHub アカウントに
  対象リポジトリの admin 権限があるか、`gh auth status` でトークンのスコープに `repo` が
  含まれているかを確認する。
- `HTTP 404` で失敗する場合、`--repo` の指定が正しいか、該当機能が private リポジトリ限定の
  有償機能（Advanced Security 等）ではないかを確認する。public 化後であれば secret scanning・
  push protection・Private vulnerability reporting はいずれも無償で使えるはずである。
- fork PR のワークフロー承認設定（手順7）が確認できない場合は、そのエンドポイントが
  スクリプトのコメントに書いたとおり実地未確認のため、GitHub の Settings > Actions > General
  画面で直接確認する。
- ブランチ保護が反映されない場合、`main` ブランチの実際の CI ジョブ名が `ci` のままか
  （`.github/workflows/ci.yml` の `jobs.ci`）を確認する。ジョブ名を変えた場合は
  `harden-public-repo.sh` の該当箇所も合わせて変更する。
