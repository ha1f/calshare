# calshare のしくみ

calshare は、予定を 1 行書くと共有用の URL ができるサービスだ。URL を受け取った人は、詳細ページのボタンから Google カレンダーか ics で自分のカレンダーに入れられる。ログインは無い。

この文書は、コードを読み始める前に全体の形をつかむためのものだ。細かい仕様は docs/design.md にあるが、2000 行を超えるので、ここで地図を持ってから必要な節だけを読むとよい。手元で動かす手順は docs/onboarding.md にある。

## 全体の形

動いているのは Cloudflare Workers の Worker 1 つと、`dist/` に置いた静的ファイルだけだ。サーバを別に立てていないし、外部のデータベースも使っていない。

```text
ブラウザ
  │
  ▼
Cloudflare の Static Assets ─── dist/ のファイルに一致すれば、Worker を起動せずにそのまま返す
  │                              （/  /new  /done  /history  /assets/* など）
  │ 一致しなかったものだけ
  ▼
Worker（src/server/index.ts → Hono の app）
  ├── D1         ページ、予定、通報、レート制限の回数
  ├── R2         ics ファイル、OGP 画像、OGP 画像を描くためのフォント
  └── Cache API  詳細ページ・ics・OGP 画像の応答を短時間持つ

Cron（毎日 JST 4:00）─── 同じ Worker の scheduled ハンドラ ─── 期限切れのデータを消す
```

リクエストはまず Static Assets が受ける。`wrangler.jsonc` の `assets` で `dist/` を公開していて、ファイルに一致すればそこで応答が終わる。一致しないパス（`/abc123def456` のようなページ ID や `/api/*`）だけが Worker に届く。Worker は Hono のアプリで、リクエストのたびに依存（D1 や R2 のアダプタ）を組み立て直してからルートに渡す。

## 画面と URL

作成まわりの画面は静的な HTML で、中身はブラウザの JavaScript が組み立てる。予定の文章を解釈するパーサもブラウザで動くので、入力しながらプレビューが変わる間、サーバには 1 回も問い合わせない。

一方、URL を受け取った人が開く詳細ページは Worker が HTML を組み立てる（SSR）。LINE などに URL を貼ったとき、プレビューを作るクローラは JavaScript を実行しない。タイトルや OGP 画像の `<meta>` をサーバの時点で埋めておく必要があるので、ここだけはサーバで描いている。

| URL | 返すもの | 動く JS |
|---|---|---|
| `/`、`/new` | 静的な `index.html` / `new.html`（中身は同じ。`/new` はプリフィル付きのリンク用） | `create.js`（`src/web/create/`） |
| `/done?id=...` | 静的な `done.html`。作成直後の完成画面 | `done.js` |
| `/history` | 静的な `history.html`。この端末で作った URL の一覧 | `history.js` |
| `/{id}` | Worker が SSR（`routes/detail.tsx` と `views/DetailPage.tsx`） | `detail.js`（LINE 内のブラウザ向けの調整） |
| `/{id}/edit` | Worker が静的な `edit.html` をそのまま返す | `edit.js` |
| `/{id}/report` | Worker が SSR した通報フォーム | `report.js` |
| `/{id}.ics` | Worker が ics を返す | なし |
| `/{id}/ogp.png?v=...` | Worker が OGP 画像を返す | なし |

ページ ID は Crockford Base32 の小文字 12 文字で、形式に合わないパスはどのルートにも一致せず 404 になる。`/new` や `/history` のような予約パスは長さが違うので、ページ ID とぶつからない。静的なパスを足すときは `src/core/config/reservedPaths.ts` にも登録する。ページ ID と衝突しないことをテストで確かめているからだ。

## ページが作られてから消えるまで

入力欄に「9/20 19時 渋谷で飲み会」と打つと、ブラウザ側で `src/core/parse` のパーサがタイトル・日時・場所を取り出し、プレビューに並べる。読み取りが違っていれば、プレビューの各項目をタップして直せる。

「URLを作る」を押すと、ブラウザは入力の原文と、確定した項目（タイトル・日時・場所・メモ）を `POST /api/pages` に送る。サーバは原文を解釈し直さない。受け取った項目を `src/core/validate` の同じ検証関数で確かめるだけだ。プレビューに出た内容がそのまま保存されるので、パーサを直してもサーバ側の挙動は変わらない。

作成 API は、同じオリジンからの JSON かどうか、本文の大きさ、レート制限、項目の検証の順に確かめてから、`pages` と `events` に 1 行ずつ書く。日時があれば ics を作って R2 にも置く。応答には編集用のトークンが入っていて、ブラウザはそれを URL と一緒に localStorage の履歴に保存し、`/done` に移る。サーバが持つのはトークンのハッシュだけなので、履歴を消したブラウザからは二度と編集できない。ログインが無い代わりにこの形にしている。

URL を受け取った人が `/{id}` を開くと、Worker が D1 から読んで詳細ページを返す。ページにはカレンダーに追加するボタンが 2 つある。Google カレンダーのボタンは、予定を埋め込んだ Google のリンクだ（`src/core/google`）。もう 1 つは `/{id}.ics` を指していて、iPhone のカレンダーなどはこちらで取り込む。

OGP 画像は作成時には作らない。クローラが初めて `/{id}/ogp.png` を取りに来たときに satori と resvg で描き、R2 に保存して次からはそれを返す。作成 API の中で描くと、Workers の CPU 時間の上限と作成の待ち時間の両方に響くからだ。描けなかったとき（フォントが無いなど）は、`dist/assets/img/ogp-fallback.png` を代わりに返す。

編集は `/{id}/edit` から行う。ブラウザが履歴からトークンを探して `Authorization: Bearer` で API に送り、サーバがハッシュを照合する。保存するとページの `version` が 1 つ上がり、OGP 画像の URL（`?v=` の値）も変わる。日時・タイトル・場所のどれかが変わった場合は、変更前の日時と、どの項目が変わったかを `previous_snapshot` に残し、詳細ページに 48 時間だけ変更のお知らせを出す。すでにカレンダーに入れた人に、入れ直しが要ることを知らせるためだ。メモだけの変更ではお知らせを出さない。

ページには期限がある。予定の終了から 7 日で見えなくなり、日時が決まっていない下書きは作成・更新から 7 日で見えなくなる（`src/core/retention`）。期限を過ぎたページは、その瞬間から 404 になる。データそのものは、毎日 JST 4:00 の Cron が消す。

通報は詳細ページの下のリンクから行う。通報を受けると `reports` に 1 行書き、同じ batch で `pages.report_count` を 1 つ増やし、設定されていれば Discord や Slack の Webhook に知らせる。ページを非表示にする管理画面や API は無い。運営者が GitHub Actions の `moderation.yml` を手で実行し、本番の D1 の `status` を書き換える（手順は docs/runbooks/moderation.md）。

## データの置き場所

| 置き場所 | 何があるか | いつ消えるか |
|---|---|---|
| D1 `pages` | ページ本体。編集トークンのハッシュ、入力の原文、公開状態、版数、作成者の IP ハッシュと端末 ID、期限 | 期限の後の Cron |
| D1 `events` | 予定の中身（タイトル・場所・メモ・日時）。今は 1 ページに 1 行 | `pages` の行と一緒に（外部キーの CASCADE） |
| D1 `reports` | 通報の理由とコメント、通報者の IP ハッシュ | `pages` の行と一緒に |
| D1 `rate_limit_counters` | 作成・通報の回数を、IP と端末ごと、1 時間と 1 日の窓で数えたもの | 2 日たったら Cron が消す |
| R2 `ics/{id}.ics` | ics ファイル | ページと一緒に Cron が消す |
| R2 `ogp/{id}/{version}.png` | OGP 画像。描けなかったときは同じ場所に失敗の印（`.failed`）を短時間置く | ページと一緒に Cron が消す |
| R2 `fonts/` | OGP 画像に使う日本語フォントとそのライセンス文 | 消さない |
| Cache API | 詳細ページ・ics・OGP 画像の応答 | 数十秒〜数分で切れる（値は `src/core/config/limits.ts`） |
| ブラウザの localStorage | 作った URL の履歴と、それぞれの編集トークン | ブラウザのデータを消すまで |
| ブラウザの Cookie `cs_device` | 端末 ID（レート制限に使う） | 400 日 |

スキーマは `migrations/0001_init.sql` の 1 本だけだ。`pages` には `owner_id` や発行者まわりの列も用意してあるが、今は使っていない。有料機能（docs/concept.md の Phase 3）で使う予定の列だ。

IP アドレスはそのままでは保存しない。`RATE_LIMIT_PEPPER` を鍵にした HMAC にかけ、先頭 32 桁だけを持つ。同じ人からの連投や、スパムを同じ送信元ごと非表示にするにはこれで足りるからだ。この鍵は本番で一度決めたら変えてはいけない。変えると、それまでのハッシュと新しいハッシュが一致しなくなり、重複通報の判定やレート制限が効かなくなる。

手元の `npm run dev` では、wrangler が D1・R2・Cache API を `.wrangler/state` の中に再現する。本番のリソースには触れないので、何を作っても消しても構わない。

## API

| メソッドとパス | 役割 | 認証 |
|---|---|---|
| `GET /api/health` | 死活確認 | なし |
| `POST /api/pages` | ページを作る。応答に編集トークンが入る | なし（レート制限あり） |
| `GET /api/pages/:id` | 編集画面の初期値を返す。入力の原文も含む | 編集トークン |
| `PATCH /api/pages/:id` | 編集を保存する | 編集トークン |
| `POST /api/pages/:id/reports` | 通報する。重複でも同じ応答を返す | なし（レート制限あり） |

リクエストとレスポンスの型は `src/core/api/types.ts` にあり、サーバとブラウザの両方がこれを import する。状態を変える 3 つの API は、同じオリジンからの JSON か、本文が大きすぎないかをハンドラの先頭で確かめる。作成と通報はさらに回数の上限を見る。これらは `src/server/middleware/` にあるが、Hono のミドルウェアとして登録しているわけではない。各ハンドラが普通の関数として呼んでいるので、API を足すときは自分で呼ばないと確認が抜ける。

エラーは `ApiRequestError` を throw すれば、`app.onError` が `{ code, message }` の JSON に変える。ブラウザは `code` を見て文言を出し分ける（`src/web/lib/messages.ts`）。

## コードの層

```text
src/
├── core/      外部に依存しない純粋な関数。パーサ、検証、日時、ID、ics、Google のリンクなど
├── ports/     サーバが外の世界に触るときのインターフェース（ページの保存、R2、時計、通知など）
├── adapters/  ports の実装。本物（D1、R2、satori、Webhook）と、テスト用のメモリ版や Fake
├── server/    Worker 本体。app.ts、routes/、views/（JSX）、middleware/、scheduled/（Cron）
└── web/       ブラウザの画面。画面ごとの main.ts を esbuild で dist/assets/js/ に束ねる
```

`src/core` はブラウザとサーバの両方から import される。npm のパッケージに依存しないので、そのままブラウザのバンドルに入れられるし、Node の上で速く単体テストできる。

サーバ側で外の世界に触るものは、すべて `ports` のインターフェースを通す。`src/server/deps.ts` の `buildDeps(env)` が本物のアダプタを詰めた `Deps` を作り、`createApp(deps)` に渡す。結合テストは代わりに `test/integration/helpers/fakeDeps.ts` の `buildFakeDeps()` を渡し、時計や ID を固定して動かす。例外は Static Assets（`env.ASSETS`）と Cache API で、この 2 つはルートから直接使っている。

層の向きのうち、道具が見張っているのは一部だけだ。`src/core` から npm のパッケージを import すると ESLint が止める。`src/core` で DOM や Node の型を使うと tsc が止める。`src/core` から `adapters` を import する、`src/web` から `adapters` を import する、といった向きの違反は検出されないので、レビューで見ている。

## キャッシュと反映の遅れ

詳細ページ・ics・OGP 画像は、Cache API に短時間だけ置いている。編集してもキャッシュを消しにはいかないので、詳細ページと ics は最大で数十秒、OGP 画像は数分、古い内容が見えることがある。OGP 画像は URL に `?v=版数` が付いているので、編集後に貼り直された URL では新しい画像になる。

ただし Cache API は `*.workers.dev` のドメインでは効かない。独自ドメインを割り当てた後に初めて効く。

`/assets/*` の JS と CSS はファイル名にハッシュを付けず、5 分だけブラウザにキャッシュさせている。デプロイの直後は、新しい HTML と古い JS が 5 分ほど混ざりうる。API の形を変えるときは、古い JS から呼ばれても壊れないようにしておく。

## 本番の環境とデプロイ

本番はまだ無い。Cloudflare のアカウントとリソースを作るのはオーナーの作業で、Issue #24 に順番がまとまっている。

デプロイは GitHub Actions の `deploy.yml` が行う。main に push されるたびに起動するが、リポジトリ変数 `DEPLOY_ENABLED` が `true` でない間は最初の判定で止まる。Actions の画面では成功と表示されるので、デプロイされたと勘違いしやすい。`true` になった後は、ビルド、本番 D1 へのマイグレーション、`wrangler deploy`、シークレットの登録をこの順に行う。

ほかのワークフローは運用のためのものだ。

- `provision.yml`：D1 と R2 を作り、`wrangler.jsonc` の `database_id` を書き換える PR を出す。フォントを R2 に置き、独自ドメインの設定もする。手で実行する。
- `moderation.yml`：通報されたページを非表示にする・戻す。手で実行する。
- `usage-report.yml`：毎週 Cloudflare の使用量を調べ、しきい値を超えていたら Issue を立てる。

各ワークフローの手順は docs/runbooks/ にある。
