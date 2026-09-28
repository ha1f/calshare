# はじめて触る人へ

calshare の開発に加わった人が、最初の 1 日で手元で動かし、どこに何があるかをつかむための文書だ。全体のしくみは docs/architecture.md に分けてある。先にそちらを 15 分ほどで読んでおくと、この文書の手順が何をしているのかが分かりやすい。

## いまの状態

最初のリリース（docs/concept.md の Phase 1）の機能は、コードとしてはそろっている。作成、完成画面、詳細ページ、カレンダーへの追加、編集、履歴、通報、期限切れの掃除まで、手元ではすべて動き、CI の e2e も通っている。

本番環境はまだ無い。公開までに残っている作業の多くは、サービス名とドメインの決定、Cloudflare の契約、API トークンの発行、規約の承認といったオーナーの作業で、Issue #24 に順番がまとまっている。コードの側にも、利用規約・プライバシーポリシー・通報ポリシーをページとして載せる実装が残っている。文面は docs/legal/ にあるが、施行日などの値がまだ決まっていない。

複数の予定をまとめて扱う機能、webcal での購読、Google ログインなどは Phase 2 以降に回していて、意図して作っていない。

## 手元で動かす

Node は 22 系を使う。`.nvmrc` に 22 と書いてあり、`.npmrc` の `engine-strict` があるので、ほかのバージョンでは `npm ci` が止まる。wrangler 自体も Node 22 以上でないと動かない。22 系でも古いものは依存の条件に引っかかるので、22 系の新しいものを入れておく。

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply calshare --local
npm run dev
```

`http://localhost:8787` を開けば、作成画面が出る。

`.dev.vars` は、wrangler が手元の Worker に渡すシークレットのファイルだ。例のファイルには、IP をハッシュにするときの鍵（手元用の適当な値）と、空の通報通知先が入っている。通知先が空のあいだは、通報しても外には何も送られない。

3 行目は、手元の D1 にテーブルを作る。wrangler は D1 のマイグレーションを自動では当てないので、初回と、`.wrangler/state` を消した後にだけ実行する。これを飛ばすと、作成を押したところで「エラーが発生しました」と出る。

`npm run dev` は、OGP 画像用のフォントを手元の R2 に入れ、`src/web` をビルドしてから `wrangler dev` を起動する。`src/server` の変更は wrangler が拾って再起動するが、`src/web` の変更は拾わない。画面の JS や CSS を変えたら、別の端末で `npm run build` をやり直してからブラウザを再読み込みする。

`git pull` や別ブランチへの切り替えの後は、`npm ci` をやり直しておく。`node_modules` が `package-lock.json` より古いと、`Cannot find package 'satori/standalone'` のような、コードと関係のなさそうなエラーで止まる。

### 手で触っていて引っかかりやすいところ

同じブラウザから予定を作り続けると、1 日の上限（端末ごとの回数制限）に当たって、それ以降は作成できなくなる。手元では wrangler が送信元の IP を付けないので、IP ごとの上限にも全員まとめて当たりやすい。次のコマンドで回数だけを消せる。

```sh
npx wrangler d1 execute calshare --local --command "DELETE FROM rate_limit_counters"
```

詳細ページを開いた直後に編集すると、しばらく古い内容が出ることがある。詳細ページの応答を短時間キャッシュしているためで、手元の wrangler でも同じように振る舞う。

Cron は手元では動かない。期限切れの掃除は、結合テストの `test/integration/scheduled/gc.test.ts` が scheduled ハンドラを直接呼んで確かめている。

この変更より前に作った `.dev.vars` には、`E2E_FIXED_NOW=` で始まる行が残っているかもしれない。残っていると手元のサーバの時計が 2026-09-16 で止まるので、その行は消しておく。

## テスト

テストは 4 種類ある。どれも CI で毎回走る。

| 種類 | 何を確かめるか | どこで動くか | コマンド |
|---|---|---|---|
| unit | `src/core` の関数、Fake、ブラウザ側のロジック | Node の上の Vitest | `npm run test:unit` |
| 結合 | ルート、アダプタ、Cron。本物の D1・R2・Cache API を使う | Cloudflare の workerd の上の Vitest（`@cloudflare/vitest-pool-workers`） | `npm run test:integration` |
| e2e | ブラウザから見た一連の操作 | Playwright から手元の `wrangler dev` を叩く | `npm run test:e2e` |
| scripts | 運用スクリプトとスキル付属のスクリプト | `node --test` | `npm run test:scripts` |

`npm run test` は unit、結合、scripts をまとめて流す。e2e は時間がかかるので含めていない。

結合テストは `dist/` の静的ファイルも読むので、先にビルドが走るようにしてある。テストごとに D1 を空にしてマイグレーションを当て直すので、テストの中で行を消して回る必要は無い。ルートのテストは `createApp(buildFakeDeps())` の形で、時計と ID を固定したメモリ版のリポジトリを使うものが多い。

e2e を初めて流す前に、`npx playwright install chromium` でブラウザを入れておく。e2e は自分で `wrangler dev` を 8788 番で起動するので、`npm run dev` を 8787 で動かしたままでも流せる。複数の作業ツリーで同時に流すときは、`E2E_PORT=8792 npm run test:e2e` のようにポートを分ける。

e2e のあいだ、サーバとブラウザの時計はどちらも 2026-09-16 10:00（日本時間）に止めてある。「9/20」と書いたときの年や曜日が、実行した日によって変わらないようにするためだ。この値は `test/e2e/fixedNow.ts` にある。Playwright のプロジェクトは 2 つあり、`line-ios` は iPhone の画面サイズと LINE の User-Agent を名乗った Chromium だ。iOS の実機や WebKit での確認ではないので、LINE の実機での確認は別に行う（docs/runbooks/line-device-test.md）。

CI は lint、型検査、unit、scripts、ビルド、結合、`wrangler deploy --dry-run`、e2e の順に 1 つのジョブで流す。main のブランチ保護で `ci` が必須になっている。

## コードを書くとき

書き方の決まりは docs/guidelines.md にある。TypeScript の設定、lint、Hono の使い方、フロントエンド、テスト、依存の更新方針まで、理由と一緒に書いてある。コメントの書き方は同じ文書の §3.3 にまとめてある。コードを書き始める前に、触る領域の節だけでも読んでおくと、レビューでの手戻りが減る。

`npm run lint` と `npm run typecheck` は、最初に `wrangler types` で `worker-configuration.d.ts` を作る。このファイルは生成物で git には入れていない。エディタで `D1Database` などの型が見つからないと言われたら、どちらかを一度実行する。

よくある変更で触るファイルは、既存の例を見るのが早い。

- API を足すなら、通報の API がちょうどよい見本だ。`src/server/routes/apiReports.ts` にハンドラを書き、`src/server/app.ts` に 1 行で登録し、型を `src/core/api/types.ts` に、上限などの定数を `src/core/config/limits.ts` に置く。ハンドラの先頭で、同じオリジンの確認・本文の読み取り・回数制限の関数を自分で呼ぶ。
- データの保存の仕方を足すなら、`src/ports/` にインターフェースを足し、`src/adapters/d1/` と `src/adapters/memory/` の両方に実装し、同じテストを両方に流す。`src/server/deps.ts` と `test/integration/helpers/fakeDeps.ts` にもそれぞれ 1 行足す。
- 静的な画面を足すなら、`src/web/pages/` に HTML、`src/web/<画面名>/main.ts` に JS、`src/web/styles/` に CSS を置く。HTML の中のパスは `/assets/...` の絶対パスで書く（`/{id}/edit` のように深いパスでも同じ HTML を返すため）。検索に出したくない画面は `src/web/_headers` に noindex を足し、パスを `src/core/config/reservedPaths.ts` に登録する。

`src/core` には npm のパッケージを持ち込まない。ブラウザにそのまま束ねているので、依存を足すとすべての画面が重くなる。

ブランチは最新の `origin/main` から切り、main 向けに PR を出す。CI の `ci` が通ればマージでき、履歴は squash でまとめている。依存の更新は Dependabot が PR を出す。

## 文書の地図

- docs/concept.md：なぜ作るのか。3 つの原則、画面の流れ、何を作って何を作らないか。機能を足したくなったら、まずここに照らす。
- docs/architecture.md：全体のしくみ。この文書の次に読む。
- docs/guidelines.md：どう書くか。コードを書く前に読む。
- docs/design.md：何を作るかの詳細設計。日時の読み取り規則、URL の設計、セキュリティ、テストの方針などが節ごとにある。頭から読むものではなく、触る領域の節を探して読む。
- docs/runbooks/：運用の手順。公開までの順番は docs/runbooks/README.md。
- docs/legal/：利用規約・プライバシーポリシー・通報ポリシーの下書き。
- docs/licenses/：フォントなど、外から取り込んだもののライセンスの審査記録。

`.claude/skills/` には、Claude Code 向けの作業手順（セキュリティ監査、ライセンス審査、通報の一次判断、公開前のチェックなど）が入っている。人が読んでも、その作業で何を確かめるかの一覧として使える。
