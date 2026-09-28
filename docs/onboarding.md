# はじめて触る人へ

calshare の開発に加わった人が、最初の 1 日で手元で動かし、どこに何があるかをつかむための文書だ。手元で動かすところまでは、この文書だけで進められる。動いたら [docs/architecture.md](architecture.md) で全体のしくみを読み（15 分ほど）、そのあとでこの文書の「テスト」から先に戻ってくると分かりやすい。

## いまの状態

最初のリリース（[docs/concept.md](concept.md) の Phase 1）の機能は、コードとしてはそろっている。作成、完成画面、詳細ページ、カレンダーへの追加、編集、履歴、通報、期限切れの掃除まで、手元ではすべて動き、CI の e2e も通っている。

本番環境はまだ無い。公開までに残っている作業の多くは、サービス名とドメインの決定、Cloudflare の契約、API トークンの発行、規約の承認といったオーナーの作業で、[Issue #24](https://github.com/ha1f/calshare/issues/24) に順番がまとまっている。コードの側にも、利用規約・プライバシーポリシー・通報ポリシーをページとして載せる実装が残っている。文面は [docs/legal/](legal/) にあるが、施行日などの値がまだ決まっていない。

複数の予定をまとめて扱う機能、webcal での購読、Google ログインなどは Phase 2 以降に回していて、意図して作っていない。

## 手元で動かす

Node は 22 系の 22.13 以上を使う。eslint などの依存が 22.13 以上を求めるためだ。nvm や fnm なら `.nvmrc`（CI も同じ値を使う）を読んで 22 系に切り替えてくれる。`.npmrc` で `engine-strict` を有効にしているので、条件に合わない Node では `npm ci` が止まる。

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply calshare --local
npm run dev
```

`http://localhost:8787` を開けば、作成画面が出る。wrangler は Cloudflare Workers の CLI で、手元での実行も D1 の操作もこれで行う。D1 は Cloudflare の SQLite をもとにしたデータベース、R2 はファイルを置くオブジェクトストレージで、手元ではどちらも wrangler が `.wrangler/state` の中に作る。本番のリソースには触れないので、何を作っても消しても構わない。

`.dev.vars` は、wrangler が手元の Worker に渡すシークレットのファイルだ。例のファイルには、IP をハッシュにするときの鍵（手元用の適当な値）と、空の通報通知先が入っている。通知先が空の間は、通報しても外には何も送られない。

OGP 画像の生成は既定で無効にしている（Workers Free の CPU 時間上限のため。docs/architecture.md）。手元で生成を試すときは、`.dev.vars` に `OGP_RENDERING=true` を足す（`.dev.vars` は `wrangler.jsonc` の `vars` より優先される）。

`wrangler d1 migrations apply` は、手元の D1 にテーブルを作る。適用してよいかを聞かれるので、`y` で進める。wrangler は D1 のマイグレーションを自動では当てないので、初回のほか、`.wrangler/state` を消した後と、`migrations/` に新しいファイルが増えたとき（`git pull` の後や、自分でテーブルを足したとき）にも実行する。これを忘れると、作成を押したところで「エラーが発生しました」と出る。

`npm run dev` は、OGP 画像用のフォントを手元の R2 に入れ、画面をビルドしてから `wrangler dev` を起動する。`src/server` の変更は wrangler が拾って再起動する。`src/web` と、画面から使っている `src/core`（パーサなど）の変更は拾わない。画面側を変えたら、別のターミナルで `npm run build` をやり直し、wrangler のログに「Local server updated and ready」が出てから、ブラウザをスーパーリロード（macOS の Chrome なら Cmd+Shift+R）する。`/assets/*` の JS と CSS はブラウザに 5 分キャッシュさせているので、普通の再読み込みでは古いものが残ることがある。DevTools の「Disable cache」を有効にしておいてもよい。

`git pull` や別ブランチへの切り替えの後は、`npm ci` をやり直しておく。`node_modules` が `package-lock.json` より古いと、`Cannot find package 'satori/standalone'` のような、コードと関係のなさそうなエラーで止まる。

### 手で触っていて引っかかりやすいところ

同じブラウザから予定を作り続けると、端末ごとの 1 日の上限に当たり、時間をおいて試すよう表示されて作成できなくなる。上限の値は `src/core/config/limits.ts` の `RATE_LIMITS` にある。手元では、どのタブや curl から作っても送信元の IP は同じループバックのアドレス（localhost なら `::1`）なので、シークレットウィンドウや Cookie なしの curl で端末を変えても、IP ごとの上限は共有される。次のコマンドで回数だけを消せる。

```sh
npx wrangler d1 execute calshare --local --command "DELETE FROM rate_limit_counters"
```

手元の D1 の中身は、同じ形で `--command "SELECT id, status, expires_at FROM pages"` のように見られる。

一度開いた詳細ページは、編集してから 1 分ほど古い内容のまま表示される。詳細ページの応答を Cache API とブラウザに 1 分キャッシュしていて、編集してもキャッシュを消さないためだ。手元の wrangler でも同じことが起きる。

Cron は手元では自動で動かない。期限切れの掃除を試すときは、`npm run dev` を動かしたまま `curl http://localhost:8787/cdn-cgi/local/scheduled` を叩くと、scheduled ハンドラが 1 回走って手元の D1 から期限切れのページが消える。自動のテストでは、結合テストの `test/integration/scheduled/gc.test.ts` が scheduled ハンドラを直接呼んで確かめている。

`.dev.vars` には `E2E_FIXED_NOW` を書かない。書くと手元のサーバの時計がその時刻で止まり、ブラウザとの間で日付の判定が食い違う。e2e の時刻は Playwright の設定から渡している。以前に作った `.dev.vars` にこの行が残っていたら消しておく。

## テスト

テストは 4 種類ある。どれも CI で毎回走る。

| 種類 | 何を確かめるか | どこで動くか | コマンド |
|---|---|---|---|
| unit | `src/core` の関数、`src/server/lib`、`src/adapters` のテスト用実装と純粋な部分、ブラウザ側のロジック | Node の上の Vitest | `npm run test:unit` |
| 結合 | ルート、アダプタ、Cron | Cloudflare の実行環境 workerd の上の Vitest（`@cloudflare/vitest-pool-workers`） | `npm run test:integration` |
| e2e | ブラウザから見た一連の操作 | Playwright から手元の `wrangler dev` を操作する | `npm run test:e2e` |
| scripts | 運用スクリプトとスキル付属のスクリプト | `node --test` | `npm run test:scripts` |

`npm run test` は unit、結合、scripts をまとめて流す。e2e は時間がかかるので含めていない。

結合テストは `dist/` の静的ファイルも読むので、先にビルドが走るようにしてある。D1・R2・Cache API は workerd の中のローカルの実装で、テストごとに D1 を空にしてマイグレーションを当て直す。テストの中で行を消して回る必要は無い。ルートのテストの多くは D1 を使わず、時計と ID を固定したメモリ版で動かしている。D1 に対する SQL は、主に `test/integration/adapters/` のテストが確かめている（しくみは docs/architecture.md の「コードの層」）。

e2e は「手元で動かす」の `.dev.vars` とマイグレーションを済ませた後に流す。初めて流す前に、`npx playwright install chromium` でブラウザを入れておく。e2e は自分で `wrangler dev` を 8788 番で起動するので、`npm run dev` を 8787 で動かしたままでも流せる。ただし、起動のときに `npm run build` で `dist/` を作り直すので、動いている `npm run dev` の画面もその時点の内容に置き換わる。e2e のサーバは `npm run dev` と同じ `.wrangler/state` を使うので、e2e が作ったページや回数制限の行も手元の D1 に残る。複数の作業ツリーで同時に流すときは、`E2E_PORT=8792 npm run test:e2e` のようにポートを分ける。

e2e の間、サーバとブラウザの時計はどちらも 2026-09-16 10:00（日本時間）に止めてある。「9/20」と書いたときの年や曜日が、実行した日によって変わらないようにするためだ。この値は `test/e2e/fixedNow.ts` にある。Playwright のプロジェクトは 2 つあり、`line-ios` は iPhone の画面サイズと LINE の User-Agent を名乗った Chromium だ。iOS の実機や WebKit での確認ではないので、LINE の実機での確認は別に行う（[docs/runbooks/line-device-test.md](runbooks/line-device-test.md)）。

CI は lint、型検査、unit、scripts、ビルド、結合、`wrangler deploy --dry-run`、e2e の順に 1 つのジョブで流す。main のブランチ保護で `ci` が必須になっている。

## コードを書くとき

書き方の決まりは [docs/guidelines.md](guidelines.md) にある。TypeScript の設定、lint、Hono の使い方、フロントエンド、テスト、依存の更新方針まで、理由と一緒に書いてある。コメントの書き方は同じ文書の §3.3 にまとめてある。コードを書き始める前に、触る領域の節だけでも読んでおくと、レビューでの手戻りが減る。

`npm run lint` と `npm run typecheck` は、最初に `wrangler types` で `worker-configuration.d.ts` を作る。このファイルは生成物で git には入れていない。エディタで `D1Database` などの型が見つからないと言われたら、どちらかを一度実行する。lint は Prettier の整形も確かめるので、整形の違反で落ちたら `npm run format` で直す。

よくある変更で触るファイルは、既存の例を見るのが早い。

API を足すなら、通報の API（`src/server/routes/apiReports.ts`）がちょうどよい見本になる。ハンドラの先頭で `assertSameOriginJsonRequest`（同じオリジンからの JSON か）と `readJsonBody`（本文の大きさと形）を呼ぶ。回数制限をかけるなら、`src/ports/rateLimiter.ts` の `RateLimitScope` と `src/core/config/limits.ts` の `RATE_LIMITS` に種類を足し、`apiReports.ts` の `consumeReportRateLimit` のようにルールを組んで `deps.rateLimiter.consume` を呼ぶ。型は `src/core/api/types.ts` に置き、`src/server/app.ts` にルートを 1 行で登録する。登録の順番には意味があり、ページ ID を受ける `detailRoutes` はいちばん最後に置く。

データの保存の仕方を足すなら、`src/ports/` のインターフェースにメソッドを足し、`src/adapters/d1/`（R2 なら `src/adapters/r2/`）と `src/adapters/memory/` の両方に実装する。テストは `test/integration/adapters/` に置き、D1 版とメモリ版に同じテストを流す。`pageRepository.test.ts` のように共通のテストを関数にまとめて両方の `describe` から呼ぶか、`rateLimiter.test.ts` のように `describe.each` を使う。テーブルや列を足すときは、`migrations/` に次の番号の SQL を足す。新しいインターフェースそのものを足すときは、`src/server/deps.ts` の `Deps` と `buildDeps`、`test/integration/helpers/fakeDeps.ts` の `buildFakeDeps` にも足す。

静的な画面を足すなら、`src/web/pages/` に HTML、`src/web/<画面名>/main.ts` に JS、`src/web/styles/` に CSS を置く。HTML の中のパスは `/assets/...` の絶対パスで書く（`/{id}/edit` のように深いパスでも同じ HTML を返すため）。CSP で自分のオリジンのスクリプトとスタイルしか許していないので、HTML にインラインの `<script>` や `style` 属性は書かない。e2e は CSP 違反があると落ちる。新しいパスは `src/core/config/reservedPaths.ts` に登録する。検索に出したくない画面は、`src/web/_headers` に noindex の行を足し、`test/unit/web/headers.test.ts` の対象にも加える。

`src/core` には npm のパッケージを持ち込まない。ESLint がこの import を止める。理由は docs/architecture.md の「コードの層」にある。

ブランチは最新の `origin/main` から切り、main 向けに PR を出す。CI の `ci` が通ればマージでき、履歴は squash でまとめている。コミットと PR のタイトルは、`fix: 通報の保存と件数の加算を 1 つの batch にまとめる` のように、`feat` `fix` `docs` `refactor` `chore` などの接頭辞と日本語の本文で書く。コードのコメントも文書も日本語で書く。依存の更新は Dependabot が PR を出す。

## ほかの文書

- [docs/concept.md](concept.md)：なぜ作るのか。3 つの原則、画面の流れ、何を作って何を作らないか。機能を足したくなったら、まずここに照らす。
- [docs/architecture.md](architecture.md)：全体のしくみ。「手元で動かす」が終わったら読む。
- [docs/guidelines.md](guidelines.md)：どう書くか。コードを書く前に読む。
- [docs/design.md](design.md)：何を作るかの詳細設計。日時の読み取り規則、URL の設計、セキュリティ、テストの方針などが節ごとにある。頭から読むものではなく、触る領域の節を探して読む。
- [docs/runbooks/](runbooks/)：運用の手順。公開までの順番は [docs/runbooks/README.md](runbooks/README.md)。
- [docs/legal/](legal/)：利用規約・プライバシーポリシー・通報ポリシーの下書き。
- [docs/licenses/](licenses/)：フォントなど、外から取り込んだもののライセンスの審査記録。

`.claude/skills/` には、Claude Code 向けの作業手順（セキュリティ監査、ライセンス審査、通報の一次判断、公開前のチェックなど）が入っている。人が読んでも、その作業で何を確かめるかの一覧として使える。
