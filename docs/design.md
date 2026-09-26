# calshare 詳細設計（Phase 1）

> 状態: 確定（実装着手可） / 更新日 2026-09-17 / 入力: docs/concept.md

この文書は concept.md（確定済み）を入力とする Phase 1 の詳細設計である。3 つの設計案（コスト優先・開発速度優先・テスト容易性優先）を審査した結果、テスト容易性優先案を骨格に採用し、他 2 案から有効な部分を移植し、審査で指摘された事実誤認と不整合を解消したものが本書になる。その後、概念整合・実現可能性・セキュリティの 3 観点のレビューを受け、指摘を反映した（2026-09-17）。さらに最終チェックの指摘（矛盾・欠落の解消と、T1 着手に不足していた構成情報の追記 §11.7）を反映した（2026-09-17）。採らなかった指摘は §14.3 に理由つきで残す。読み手は経緯を知らない同僚を想定し、割れた論点には「採用した判断／採らなかった案」を短く残す。

本文中の「要検証」は、設計時点で一次情報を確認できず、実装タスクの完了条件に検証を含めた事項を指す。

## 確定した技術スタック（要約）

| 領域 | 選定 | 一言 |
|---|---|---|
| ホスティング / ランタイム | Cloudflare Workers（**Paid $5/月**） | R2 の egress 無料。OGP 生成の CPU 時間のために Paid が前提 |
| 静的配信 | Workers Static Assets | 作成・完成・履歴・編集画面は静的 HTML + クライアント JS |
| フレームワーク | Hono（`hono/jsx` で SSR） | 詳細ページだけ SSR。ルートは Hono サブアプリ単位で分割 |
| DB | Cloudflare D1（SQLite） | `pages` / `events` / `reports` / `rate_limit_counters` |
| オブジェクトストレージ | Cloudflare R2 | ics 実体・OGP 画像・OGP 用フォント |
| エッジキャッシュ | Cache API（`caches.default`） | 詳細ページ・ics・OGP の前段。カスタムドメイン配下でのみ有効 |
| OGP 画像生成 | satori（`satori/standalone` エントリ）+ yoga の wasm + `@resvg/resvg-wasm` | 初回 GET 時に遅延生成 → R2 保存。失敗時は静的フォールバック PNG。wasm の初期化は初回 render 時（§2.5） |
| クライアント JS | バニラ TypeScript（esbuild） | `core/` をそのままブラウザに同梱してライブプレビュー |
| 静的ページのヘッダ | Static Assets の `_headers` ファイル | 静的ページは Worker を通らないので CSP 等はここで付ける（§9.1。pool-workers・`wrangler dev` の両方で動作確認済み〈T1〉、§10.2） |
| テスト | Vitest（unit）/ `@cloudflare/vitest-pool-workers`（integration）/ Playwright（e2e） | 3 層すべて足場 PR で疎通させる |
| CI / デプロイ | GitHub Actions + `cloudflare/wrangler-action` | lint → typecheck → unit → integration → build → e2e → main のみ deploy |
| 定期実行 | Cloudflare Cron Triggers | 保持期限切れの GC を日次 |
| 通報通知 | Discord / Slack Incoming Webhook | 運用者 1 人向けの最小構成 |

---

## 1. 技術スタック

### 1.1 選定と理由

| 領域 | 選定 | 理由 |
|---|---|---|
| ホスティング / ランタイム | Cloudflare Workers | concept §09 が名指しした「OGP 画像が月 100 万 PV 分配信されると Vercel だと痛い」を、R2 の egress 無料と Cache API で構造的に回避できる。ベンダーが 1 社に収まり、運用者 1 人の障害切り分けが最小になる |
| 静的アセット | Workers Static Assets | ①作成・②完成・④履歴・編集画面は個人化不要。静的アセットとして配信すれば Worker リクエスト数も CPU も消費しない |
| フレームワーク | Hono | Workers ネイティブで起動が軽い。`app.request()` / `SELF.fetch()` でルート単位の結合テストが書きやすい。`hono/jsx` の自動エスケープを XSS 対策の基盤にする |
| DB | D1 | Workers と同一ベンダーでネットワークホップなし。`@cloudflare/vitest-pool-workers` で本物の D1 をローカル実行でき、モック不要の結合テストが書ける |
| オブジェクトストレージ | R2 | ics・OGP 画像の実体置き場。egress 無料。フォントの置き場も兼ねる（§2.5） |
| OGP 画像生成 | satori + `@resvg/resvg-wasm` | Node の `canvas` は Workers で動かない。satori（HTML/CSS 風レイアウト → SVG）+ resvg（SVG → PNG）は WASM/JS のみで完結する |
| クライアント JS | バニラ TS + esbuild | React 等のランタイムを持たず、初回描画をモバイルで軽くする。`core/` を同梱するので「サーバの解釈」と「プレビューの解釈」が実装レベルで同一になる |
| 単体テスト | Vitest（Node） | `core/` は外部依存ゼロなので Node で高速に回せる |
| 結合テスト | `@cloudflare/vitest-pool-workers` | workerd 上で D1・R2・Cache API・`ctx.waitUntil` を実機同等に再現できる |
| e2e | Playwright | `wrangler dev` を `webServer` として起動し、モバイル UA（LINE 内蔵ブラウザ相当）もエミュレートできる |
| CI | GitHub Actions | 個人アカウントの無料枠で足りる。`cloudflare/wrangler-action` で main マージ後に自動デプロイ |

### 1.2 コストとの整合（concept §08〜§09 との突き合わせ）

**Workers Paid（$5/月）を前提にする。** これは「無料枠で回す」方針からの唯一かつ意図的な逸脱で、理由は次の 2 点。concept §09 の「Phase 1 は変動費がほぼゼロ…無料枠のまま放置できる」とは固定費 $5/月の分だけ食い違うので、Paid 契約の承認（H2）を §14.2 の未決事項に明示し、承認後に concept §09 へ「Phase 1 の固定費は Workers Paid $5/月のみ（OGP 生成のため）」を追記する。

- Workers Free の CPU 時間上限は **1 リクエストあたり 10ms**。satori + resvg のラスタライズは 100〜300ms 級なので Free では完走せず、超過は例外ではなく isolate の強制終了（エラー 1102）になるため `try/catch` のフォールバックも効かない。OGP 画像は認知獲得の主経路（concept §03）なので、これを諦める選択肢はない。
- Workers Free のスクリプトサイズ上限は 3MB（gzip 後）。resvg の wasm（gzip 後 1MB 前後）+ satori + yoga で 2MB 前後になり、余裕がない。Paid は 10MB。

**Paid の込み枠に対する試算（月 10 万ページ作成・詳細ページ月 100 万 PV の想定）**

| リソース | Paid の込み枠 | 想定消費 | 判定 |
|---|---|---|---|
| Worker リクエスト | 1,000 万/月 | 作成 10 万 + 詳細 PV 100 万 + OGP/ics 取得 数十万 ≒ 150 万 | 余裕 |
| CPU 時間 | 3,000 万 CPU-ms/月 | OGP 生成 10 万件 × 150〜300ms = 1,500〜3,000 万 CPU-ms（satori が呼び出しごとに行うフォントのパース分は未計上。要実測、§2.5）。詳細 SSR 100 万 × 3ms = 300 万 | **上限近傍**。超過分は $0.02/100 万 CPU-ms で月数十円。Cache API により再訪分は CPU を消費しない |
| D1 書き込み | 5,000 万行/月 | 作成 1 件 = `pages` 1 + `events` 1 + インデックス更新 4（`pages` 3 本 + `events` 1 本）+ レート制限カウンタ UPSERT 3 ≒ 9〜12 行。月 10 万件で 120 万行 | 余裕（Free でも 10 万行/日に収まる） |
| D1 読み取り | 250 億行/月 | Cache API のミス時のみ D1 を読む | 余裕 |
| R2 | 10GB / Class A 100 万 / Class B 1,000 万 | 同時保持 1〜2GB、書き込みは作成・編集回数に比例 | 余裕。egress は常に無料 |

補足として、**OGP 画像の取得回数は PV ではなくクローラのカード生成回数に比例する**。LINE・X・Slack は URL ごとに 1 回フェッチしてプラットフォーム側でキャッシュするため、concept §09 の「月 100 万 PV 分」は上限側の見積りであり、実際の画像フェッチは数千〜数万回に収まる。これが OGP を Worker 経由で配信しても実害が出ない根拠になる。

**Cache API の前提**: `caches.default` は workers.dev サブドメインでは動作せず、カスタムドメイン（Cloudflare ゾーン）配下でのみ機能する。ドメイン取得（§13）が済むまではキャッシュが効かないだけで、動作は変わらない。また `cache.delete()` は実行したデータセンターのキャッシュしか消さないので、編集時の即時 purge には頼らず、短い TTL で吸収する（§2.4）。

**LLM フォールバック**: Phase 1 では実装しない。差し込み用の境界として、ブラウザ側のプレビューが呼ぶ `TextInterpreter` と、Phase 2 で足す `POST /api/interpret` のパスとレート制限 scope だけ予約する（§5.9）。

### 1.3 検討して採らなかった選択肢

| 候補 | 却下理由 |
|---|---|
| Vercel + Next.js + Neon + Upstash（開発速度優先案） | Vercel Hobby は Function 呼び出し 100 万/月・帯域 100GB/月を超えると課金ではなくプロジェクト停止になる。Hobby は商用・広告利用不可なので Phase 2 の広告投入時点で Pro（$20/月）が必要。Neon Free の 100 CU 時間/月はコンピュートの自動サスペンドを前提にした枠で、詳細ページの PV が常時来る用途では稼働時間が読めない。ベンダーが 4〜5 社に分かれ運用者 1 人には重い |
| Workers Free のまま OGP を生成（コスト優先案の当初前提） | 上記のとおり 10ms 上限で完走しない |
| OGP を作成 API 内で同期生成 | 最も軽くあるべき作成動線に数百 ms が乗る。合格基準「LINE に直接打つより速い」に逆行する |
| R2 カスタムドメインから ics を直接配信（当初案） | `wrangler dev` と CI にカスタムドメインが無く、ローカルで ics の到達確認ができない。`X-Robots-Tag` もアプリから付けられない。Phase 1 は Worker が R2 バインディングから返す方式に統一する。ただし concept §09 は「ics は静的配信できる設計」を要件にしているので、Phase 2 の webcal で R2 直配信へ切り替えられるよう、R2 のキーは version を含まない `ics/{id}.ics` にしておく（§2.3）。切り替え時にキー移行は要らない |
| Supabase / Firebase（匿名認証） | 編集トークン + localStorage で代替できる（concept §08）。ベンダー増を避ける |
| KV をレート制限カウンタに使う | KV は結果整合で、同一キーへの書き込みが 1 回/秒に制限されるため、短時間に連打されるカウンタには向かない（Paid の書き込み枠 100 万回/月は問題ではない） |
| Workers の Rate Limiting バインディングをレート制限に使う | 無料でエッジ内に閉じるが、カウンタがデータセンター（colo）単位で共有されないため「1 日 N 件」のような日次上限に使えない。時間窓の一次防御としては使える余地があるので §9.3 に判断を残す |

---

## 2. アーキテクチャ

### 2.1 最大の設計判断: パーサをブラウザにもそのまま送る

`src/core/` 配下は外部依存ゼロの TypeScript にし、Node・Workers・ブラウザのどこでも動かす。これを esbuild で小さなバンドルにして作成画面のライブプレビューに使う。「サーバがどう解釈するか」と「プレビューが示す解釈」が同一実装になり、パーサの単体テストがそのままプレビューの正しさの保証になる。

プレビューはパーサを直接呼ばず `TextInterpreter`（§5.9）経由で呼ぶ。Phase 1 の実装はルールベースのみで通信を発生させない。Phase 2 で LLM を足すときは「ルールで日時が取れなかったときだけ `POST /api/interpret` を呼ぶ」合成実装に差し替えるだけで、プレビューの UI と作成 API は変わらない。

### 2.2 配信方式の使い分け

| 画面・経路 | 方式 | 理由 |
|---|---|---|
| `/` `/new`（①作成） | 静的アセット + CSR | 個人化不要。プリフィルはクエリ文字列を JS が直接読む。Worker 呼び出しゼロ |
| `/done`（②完成） | 静的アセット + CSR | 作成 API の結果を localStorage 経由で受け取って描画する（§6.2） |
| `/history`（④履歴） | 静的アセット + CSR | localStorage のみで完結 |
| `/:id/edit`（編集） | **Worker が `env.ASSETS.fetch(new URL('/edit', request.url))` で編集画面の HTML を返す** + CSR | Static Assets はビルド時に存在するパスにしか一致しないため、可変 ID を含むパスは Worker が静的ファイルを返す。Worker は呼ばれるが D1 には触れない。取得の注意点は下記「ASSETS バインディング経由で HTML を返すときの規約」 |
| `/:id`（③詳細） | 動的 SSR（Hono JSX）+ Cache API | ユーザー入力を含む HTML はサーバでエスケープを徹底する。OGP の `<meta>` を初期 HTML に含める必要がある |
| `/:id.ics` | 動的（Worker → R2 バインディング）+ Cache API | 現在バージョンの実体を R2 から読んで返す。ローカル・CI でも同じ経路で動く |
| `/:id/ogp.png` | 動的（Worker、遅延生成）+ Cache API | 初回 GET で生成して R2 に保存。以降は Cache API または R2 から返す |
| `/:id/report` | 動的 SSR | 通報フォーム。小さな HTML |
| `/api/*` | 動的 | 状態変更を伴う |

**ルーティングの評価順序**（Static Assets → Worker の順で評価される。アセットに一致しなかったリクエストだけが Worker に到達する）

1. 静的アセット（`/` `/new` `/done` `/history` `/edit` `/robots.txt` `/favicon.ico` `/assets/*`）
2. `/api/*`（Hono サブアプリ）
3. `/:id.ics`
4. `/:id/ogp.png`
5. `/:id/edit`（`env.ASSETS.fetch(new URL('/edit', request.url))`）
6. `/:id/report`
7. `/:id`（catch-all。ID 形式に合わなければ 404）

**予約パスと ID の衝突回避**: ページ ID は 12 文字固定（§4.2）なので、`new` `done` `history` `edit` `api` `assets` `robots.txt` のような予約パス（すべて 12 文字未満または拡張子付き）とは長さで衝突しない。予約パス一覧は `src/core/config/reservedPaths.ts` に定数として置き、ID 生成器の単体テストで「生成 ID が予約パスに一致しない」「12 文字である」を固定する。

**Hono のルート定義**: Hono はパスのセグメント全体を `:name` として解釈するため、`/:id.ics` と書くとパラメータ名が `id.ics` になり `.ics` をリテラルとして要求しない。ID を含むルートはすべて正規表現付きで定義する。

```typescript
const PAGE_ID_PATTERN = '[0-9a-hjkmnp-tv-z]{12}'                // core/id/crockford.ts の isValidPageId と同じ定義
app.get(`/:id{${PAGE_ID_PATTERN}\\.ics}`, ...)                    // ハンドラで末尾の .ics を落とす
app.get(`/:id{${PAGE_ID_PATTERN}}/ogp.png`, ...)
app.get(`/:id{${PAGE_ID_PATTERN}}/edit`, ...)
app.get(`/:id{${PAGE_ID_PATTERN}}/report`, ...)
app.get(`/:id{${PAGE_ID_PATTERN}}`, ...)                          // 形式に合わないパスはここに来ず、Hono の notFound で 404
```

**ASSETS バインディング経由で HTML を返すときの規約**（`/:id/edit` と OGP のフォールバック PNG が該当）

- `env.ASSETS.fetch()` には絶対 URL を渡す（Workers の `fetch` / `Request` は相対 URL を受け付けず TypeError になる）。`new URL('/edit', request.url)` のように `request.url` を基準に組む。
- `html_handling: auto-trailing-slash` の下では `/edit.html` へのリクエストは `/edit` への 307 リダイレクトになるため、**拡張子なしのパス `/edit` を取りに行く**。
- ASSETS から返る `Response` のヘッダは変更不可なので、`new Response(res.body, res)` で包み直してから `X-Robots-Tag` やセキュリティヘッダを足す。
- `edit.html` は `/:id/edit` という 2 段目のパスで表示されるため、HTML 内のアセット参照は `/assets/...` の絶対パスに固定する（相対パスだと `/:id/assets/...` に解決されて 404 になる）。これは全静的 HTML の規約にする（§11.6）。
- 結合テストで「`GET /:id/edit` が 200 で HTML 本文を返す（3xx でない）」を固定する（T11）。

wrangler 設定（`wrangler.jsonc`）は次を明記する。

```jsonc
{
  "workers_dev": true,             // H3 でカスタムドメインを割り当てたら false にする（§9.9）。*.workers.dev で同じルートが応答するのを防ぐ
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "none"
  }
}
```

`not_found_handling: "none"` と Worker スクリプトの併用で、アセットに一致しないパスは Worker の `fetch` に落ちる。

**`dist/` の配置**（`assets.directory` が URL のルートになる）: HTML（`index.html` `new.html` `done.html` `history.html` `edit.html`）・`robots.txt`・`favicon.ico`・`_headers` は `dist/` 直下、esbuild の出力と CSS・画像は `dist/assets/{js,css,img}/` に置く。URL は `/` `/new` `/assets/js/create.js` `/assets/img/ogp-fallback.png` になり、HTML 内の参照規約（`/assets/...` の絶対パス、§11.6）と一致する。生成は `scripts/build-web.mjs`（§11.7）。

**静的ページのレスポンスヘッダ**: 静的アセットに一致したリクエストは Worker に到達しないので、Worker のミドルウェアでは CSP 等を付けられない。Workers Static Assets が対応している `_headers` ファイル（`dist/_headers`。ソースは手書きの `src/web/_headers` で、`scripts/build-web.mjs` がそのままコピーする。内容は §11.7、`headers.ts` との一致検査は §9.1）に §9.1 のヘッダを宣言する。`_headers` の対応は wrangler のバージョンに依存するため、T1 で「`GET /done` のレスポンスに CSP が付く」を結合テストにして確認した（確認済み。§10.2）。効かなくなった場合は `assets.run_worker_first: true` にして Worker の `securityHeaders` を通してから `env.ASSETS.fetch()` で返す（Worker リクエスト数は増えるがヘッダを一元化できる）。

### 2.3 リクエストの流れ（作成〜共有〜閲覧）

1. 作成者が①で入力 → `TextInterpreter`（Phase 1 は `ruleBasedInterpreter` = `parseEventText`）をブラウザ内で実行しプレビュー表示（通信なし）
2. 「URLを作る」→ `POST /api/pages`（body はプレビューの確定値 + 原文 + 流入元 `source`）→ サーバ側で再検証（サーバはパースし直さない。§5.7 の検証だけを行う）→ D1 に `pages` / `events` を 1 つの `db.batch()` で INSERT → `buildIcs`（純粋関数。下書きは ics を作らない）→ R2 に `ics/{id}.ics` を PUT → `{ id, url, editToken, expiresAt, ... }` を返す。D1 の INSERT 成功後に R2 の PUT だけが失敗するとページはあるのに ics が無い状態になるが、`GET /:id.ics` が「ics が無く `isServable` なページは `buildIcs` で再生成して PUT してから返す」自己修復を持つ（§11.4 `getIcs` の注記、T9）ので、作成 API はロールバックしない
3. クライアントは結果を localStorage の履歴に保存し `/done?id={id}` へ遷移。②が localStorage から復元して描画
4. 作成者が URL を LINE 等に貼る
5. 閲覧者が `GET /:id` → Cache API ヒットならそのまま返す → ミスなら D1 から取得 → SSR → Cache API に保存（`max-age=60`）
6. LINE 等のクローラが `GET /:id/ogp.png` → Cache API → R2 → いずれも無ければ satori + resvg で生成し、`ctx.waitUntil` で R2 に保存しつつ即応答（§2.5）

### 2.4 詳細ページと ics の Cache API

```typescript
// server/lib/edgeCache.ts の要旨
export async function withEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  maxAgeSeconds: number,
  produce: () => Promise<Response>,
  options?: { keepQuery?: boolean },   // OGP 画像だけ `?v=` を残す（下記）
): Promise<Response> {
  const cache = caches.default
  // クエリ文字列を落としてからキーにする。`/:id?x=1` `?x=2` ... で無限にキャッシュミスを作られ、
  // D1 と R2 を直叩きされるのを防ぐ。対象ルートはどれもクエリで表示を変えない
  const url = new URL(request.url)
  if (!options?.keepQuery) url.search = ''
  const key = new Request(url.toString(), { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return hit
  const res = await produce()
  if (res.ok) {
    res.headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}`)
    ctx.waitUntil(cache.put(key, res.clone()))
  }
  return res
}
```

- **キーはデコード済みの正規パスから組む**: `request.url` の生の文字列をそのままキーにすると、`/aaaaaaaaaaaa` と `/%61%61%61%61%61%61%61%61%61%61%61%61` のような `%XX` の表記違いが別キーになり、クエリを落としても無限のキャッシュミスを作れてしまう（Hono の `:id{pattern}` はデコード後の値で一致させるため、どちらも同じページを返す）。`:id` を含むルートは、`request` をそのまま渡すのではなく、検証済みの `id` から組み直した URL（例: `new URL(`/${id}`, request.url)`）でキーを作る。
- 詳細ページ `GET /:id` は `DETAIL_CACHE_MAX_AGE_SECONDS = 60`。編集・非表示後は**最大 60 秒の古さを許容する**と明記する（`cache.delete()` はローカル colo にしか効かないため頼らない）。
- `/:id.ics` は `ICS_CACHE_MAX_AGE_SECONDS = 60`。`/:id/ogp.png` は `OGP_CACHE_MAX_AGE_SECONDS = 300`。
- OGP 画像だけは例外で、`og:image` の URL を `https://{PUBLIC_ORIGIN}/{id}/ogp.png?v={version}` にする（§6.3）。SNS 側は画像 URL 単位でカードをキャッシュするため、編集で version が上がれば再取得される。この `?v=` はキャッシュキーから落とす対象に含めない（`/:id/ogp.png` のハンドラは `withEdgeCache(request, ctx, OGP_CACHE_MAX_AGE_SECONDS, produce, { keepQuery: true })` と呼ぶ。version は D1 の値で決まるので、任意の `?v=` で無限にミスを作られても R2 のキーは `ogp/{id}/{version}.png` の 1 本にしか当たらない）。
- `?created=1` のようなクエリで表示を変える設計は採らない（アドレスバーからコピーした URL に付いて拡散する）。②は独立した静的画面（§6.2）。

### 2.5 OGP 画像の生成方式: 遅延生成 + R2 + フォールバック

作成 API の中で OGP を同期生成しない。`/:id/ogp.png` への最初の GET（多くは LINE や X のクローラ）でオンデマンド生成し R2 に保存する。

```typescript
// server/routes/ogp.ts の要旨
async function handleOgp(id: string, request: Request, env: Env, ctx: ExecutionContext, deps: Deps): Promise<Response> {
  const page = await deps.pages.findById(id)
  if (!page || !isServable(page, deps.clock.now())) return fallbackPng(request, env, { cacheControl: `public, max-age=${OGP_CACHE_MAX_AGE_SECONDS}` })

  // R2 の読み取り失敗（一時的な障害）はレンダラの失敗と区別する。失敗マーカーを立てず
  // このリクエストだけフォールバックにし、次のリクエストで再度生成を試みる
  try {
    const cached = await deps.storage.getOgpImage(id, page.version)
    if (cached) return pngResponse(cached)

    const negative = await deps.storage.getOgpFailureMarker(id, page.version)
    if (negative) return fallbackPng(request, env)
  } catch (e) {
    deps.logger.warn('ogp_cache_read_failed', { pageId: id, error: e })
    return fallbackPng(request, env)
  }

  try {
    const png = await deps.ogpRenderer.render(toOgpInput(page, deps.config.serviceName))
    // R2 書き込みの失敗はレスポンスに影響させず、ログにだけ残す
    ctx.waitUntil(deps.storage.putOgpImage(id, page.version, png).catch((e) => deps.logger.warn('ogp_store_failed', { pageId: id, error: e })))
    return pngResponse(png)
  } catch (e) {
    deps.logger.warn('ogp_render_failed', { pageId: id, error: e })   // Logger 側で { name, message } に正規化する（§9.6）
    ctx.waitUntil(deps.storage.putOgpFailureMarker(id, page.version, OGP_FAILURE_CACHE_SECONDS).catch((e) => deps.logger.warn('ogp_store_failed', { pageId: id, error: e })))
    return fallbackPng(request, env)
  }
}
```

- **フォールバック画像**: `dist/assets/img/ogp-fallback.png`（ソースは `src/web/img/ogp-fallback.png`。サービス名だけを描いた静的 PNG）を `env.ASSETS.fetch(new URL('/assets/img/ogp-fallback.png', request.url))` で取得し、`new Response(res.body, res)` で包み直して `Cache-Control` を付けて返す（§2.2 の規約）。wasm 例外・フォント取得失敗・タイムアウトのいずれでもカードが壊れない。
- **ネガティブキャッシュ**: 生成に失敗し続けるページで毎回 CPU を消費しないよう、失敗マーカー（R2 の `ogp/{id}/{version}.failed`、`OGP_FAILURE_CACHE_SECONDS = 300` 秒で無効）を置く。同じ入力は同じ結果になるので、失敗マーカーが切れても同じ version では再び失敗する。これを「そのページの OGP は恒久的にフォールバック」として受け入れる代わりに、レンダラの例外の主因になりうる制御文字・絵文字を描画前に落とす（下記「入力の前処理」）。サブセット未収録の漢字・記号は例外にはならず豆腐（空白）になるだけなので、ここでは対象にしない。
- **satori の読み込み方**: satori の既定エントリ（`satori`）はレイアウトエンジン yoga の asm.js 版をモジュール読み込み時に初期化する。Workers には「スクリプトのトップレベル評価は 400ms 以内」という起動時間制限があり、これに掛かるとデプロイ自体が失敗し、`wrangler deploy --dry-run` では検出できない。そのため **`satori/standalone` エントリを使う。設計時点で想定していた `satori/wasm` + `yoga-wasm-web` は現行の satori では無くなっており（`satori/standalone` に統合され、`yoga.wasm`（`satori/yoga.wasm` として同梱）を `init()` に渡す形に変わった）、実装時点の実物（`node_modules/satori/package.json` の `exports`）に合わせてこちらを使う。**
  **satori のバージョンは `0.32.0` に固定する（`^0.33.0` 以降は不可、実機確認済み）**: satori 0.33.0 でテキストシェイピングに `harfbuzzjs` が追加されたが、`harfbuzzjs` は自身の wasm（`hb.wasm`）を Node の `fs.readFile` 相当（`readAll`）で読む実装で、これを差し替える公開 API が satori 0.33 系に無い。`satori/standalone` の `init()` は yoga の wasm しか受け付けないため、Workers（fs を持たない）では `harfbuzzjs` の初期化が `no such file or directory` で必ず失敗する（vitest-pool-workers で実機確認済み）。`harfbuzzjs` 導入前の最終版である `0.32.0` を使うことでこの依存を避ける。
  resvg は `@resvg/resvg-wasm` の `initWasm()` に `index_bg.wasm` を渡す。どちらの wasm も `import` で静的に束ね（wrangler の既定 `CompiledWasm` ルールが `**/*.wasm` に効くため `wrangler.jsonc` の `rules` 追加は不要、実機確認済み）、`init`/`initWasm` は初回 render 時に遅延実行する。トップレベルで重い初期化は行わない。初期化結果と `R2` から読んだフォントはモジュールスコープでメモ化する。T10 の完了条件に「`wrangler dev` の起動と初回リクエストが通る」「1 回の render に要する CPU 時間（フォントパース込み）の実測」を含め、実機の起動制限は T19 の初回デプロイで確認する。
- **フォント**: satori はデフォルトフォントを持たず `fonts` オプションが必須。Noto Sans JP のサブセット（**JIS 第 1 水準** + かな + 英数記号 + 一般的な約物。約 765KiB、実測済み）を **R2 の `fonts/NotoSansJP-Regular.subset.otf` に置き**、isolate 内でモジュールスコープにメモ化して読み込む。スクリプトに同梱しないのは Paid でも 10MB（gzip 後）の上限があるため。サブセット生成は運用基盤の PR が provisioning 用に用意した `scripts/fonts/subset.sh`（pyftsubset を呼ぶ）に一本化し、T10 で新たに `scripts/subset-font.mjs` は作らない。第 2 水準（「麹町」「髙」のような人名・地名の字）は含めない。第 1 水準のみにした理由と、含まない文字が OGP 画像上で豆腐になる制限は `docs/licenses/noto-sans-jp.md`・`docs/runbooks/fonts.md` に記録する。OFL のライセンスファイルは `test/fixtures/fonts/OFL.txt` に含める。**satori は `SatoriOptions.fonts`（配列オブジェクト自体）を鍵にした `WeakMap` でパース結果をキャッシュする**（`node_modules/satori/dist/standalone.js` の該当箇所をソースで確認済み）。したがって `fonts: [{ data, ... }]` を render のたびに新しい配列リテラルで渡すと毎回キャッシュミスしてパースし直しになる。`createSatoriOgpRenderer` は `fonts` 配列を wasm・フォントと同じタイミングで 1 回だけ組み立て、以後の render すべてで同じ配列参照を渡すことでこのキャッシュを効かせる（T10 で実測: この対策により 2 回目以降の render が短縮した。§14.1）。
- **入力の前処理（`toOgpInput`）**: 絵文字・制御文字（Cc）・書式制御文字（Cf。ZWJ・ZWSP・BOM・RLO 等）・異体字セレクタは描画前に除去する。サブセットに無い漢字（JIS 第 1 水準外）や一般記号は判別できないため除去せず、satori が該当グリフを描かないことで例外にならずに吸収する（結果として空白の穴になる。§14.1「OGP のフォント未収録文字」）。タイトルは詳細ページで正しく見えるので、OGP から落としても価値は失われない。絵文字を画像で描く `graphemeImages` は外部取得が要るので採らない。ユーザーテキスト（タイトル・場所）は `ogpTemplate` の CSS（`-webkit-line-clamp` + `text-overflow: ellipsis`）で 2 行までに切り詰める。
- **satori への入力**: satori は React 要素形状（`{ type, props: { style, children } }`）を要求し、`hono/jsx` の JSXNode はそのまま渡せない。`OgpRenderer` の実装は素のオブジェクトツリーを組む。ユーザー入力は**テキストノードとしてのみ**渡し、文字列連結で SVG や CSS を組まない。satori はテキストを SVG のパスに変換するので、`<` `&` を含む入力でも SVG/HTML 注入にはならない（この不変条件を T10 のテストで固定する）。
- **なりすまし対策**: OGP テンプレートには固定文言「予定の共有」とサービス名を必ず含める。「【○○銀行】…のお知らせ」のようなタイトルがサービスのブランドで描かれても公式通知に見えないようにする。デザインの未決事項（§14.2）にこの制約を添える。
- ics は生成コストがほぼゼロなので作成・編集時に同期生成して R2 に置く。使い分けの基準は「CPU コストが高い処理だけ遅延・キャッシュする」。

### 2.6 GC（期限切れページの削除）

Cron Trigger（`"0 19 * * *"` = JST 04:00）で `scheduled()` を実行する。

1. `pages` から `expires_at < now` を `GC_BATCH_SIZE = 100` 件取得
2. 各ページの R2 オブジェクト（`ics/{id}.ics` と `ogp/{id}/` プレフィックス）を削除
3. `pages` 行を削除（`events` `reports` は `ON DELETE CASCADE`）。D1 は 1 クエリのバインドパラメータが 100 個までなので、`deleteByIds` は 100 件ずつに分割して `db.batch()` に載せる（§11.4）。`GC_BATCH_SIZE` を 100 にしてあるのはこの上限に合わせるため
4. 取得件数が `GC_BATCH_SIZE` に達していれば繰り返す（1 回の実行で最大 20 バッチ）
5. `rate_limit_counters` の `window_start` が 2 日以上前の行を削除
6. `changed_at` が `CHANGE_BANNER_HOURS` より古い行の `previous_snapshot` / `changed_at` を NULL にする（変更前の値をバナー表示期間より長く持たないため。§3.5）
7. 処理件数・所要時間を構造化ログに出す

ロックは持たない（個人開発規模で並行実行は起きない。二重実行しても冪等）。

実装上は 5・6 を 1〜4 より先に実行する。1〜4（ページ削除ループ）はページ数に比例してサブリクエスト数が増えるため Workers のサブリクエスト上限に達して例外で止まることがあり（§14.1）、その場合でも 5・6 が済んだ状態にするため。いずれかの手順が例外で止まった場合は `gc_failed` を deletedPageCount・batchCount・clearedSnapshotCount・durationMs 付きでログし、その例外を再スローする（`pages` 行は残るので次回の GC が同じページを拾って再試行する）。

---

## 3. データモデル

### 3.1 テーブル

`pages`（URL の単位）と `events`（カレンダーに入る予定の単位）を分ける。Phase 2 の複数イベントで `events` が複数行になることを見据え、**タイトル・場所・メモ・日時はすべて `events` 側に持つ**。`pages` は ID・トークン・発行者・状態・期限・バージョンだけを持つ。

**Phase 1 の不変条件: `events` は 1 ページにつき常に 1 行。** 作成・編集 API の入口でアサーションし、結合テストで固定する。実装者はこれを多イベント UI の根拠にしない。

```sql
-- migrations/0001_init.sql
CREATE TABLE pages (
  id TEXT PRIMARY KEY,                    -- 公開 URL の ID（§4.2）
  owner_id TEXT NULL,                     -- Phase 3 の余地。Phase 1 は常に NULL。FK は付けない（users が無いため）
  edit_token_hash TEXT NOT NULL,          -- 編集トークンの SHA-256（hex）。生トークンは保存しない
  raw_text TEXT NOT NULL,                 -- 作成時の入力全文（編集画面の初期表示・不具合調査用）
  issuer_name TEXT NULL,                  -- Phase 3 の発行者スロット。Phase 1 は常に NULL
  issuer_logo_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'hidden'（運用者が非表示にした）
  report_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,     -- 編集のたびに +1。OGP のキーと ics SEQUENCE（= version - 1）に使う
  previous_snapshot TEXT NULL,            -- 直近の編集前の日時（ChangeSnapshot を JSON で保持。変更バナー用、§3.5）。48 時間後に GC が NULL にする
  changed_at TEXT NULL,                   -- previous_snapshot を書いた日時（ISO8601 UTC）
  source TEXT NOT NULL DEFAULT 'direct',  -- 作成の流入元 'direct' | 'detail_cta' | 'prefill'（転換率の計測用、§9.6）
  creator_ip_hash TEXT NOT NULL,          -- 作成時の ip_hash（§9.3 と同じ pepper 付き HMAC。生 IP は持たない）。スパム波の一括非表示に使う（§9.4）
  creator_device_id TEXT NOT NULL,        -- 作成時の device_id。同上
  created_at TEXT NOT NULL,               -- ISO8601 UTC
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                -- 保持期限。GC はこの列だけを見る
);
CREATE INDEX idx_pages_expires_at ON pages(expires_at);
CREATE INDEX idx_pages_creator_ip_hash ON pages(creator_ip_hash);
CREATE INDEX idx_pages_creator_device_id ON pages(creator_device_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,                    -- ics UID の一部になる安定 ID（UUID v4）
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,  -- Phase 1 は常に 0
  title TEXT NOT NULL,
  location TEXT NULL,
  memo TEXT NULL,
  is_all_day INTEGER NOT NULL DEFAULT 0,  -- 0/1
  start_at TEXT NULL,                     -- ISO8601 UTC。日時未確定の下書きは NULL
  end_at TEXT NULL,                       -- 終日は排他的翌日 00:00 JST を UTC で保持
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_page_id ON events(page_id);

CREATE TABLE rate_limit_counters (
  scope TEXT NOT NULL,                    -- 'create' | 'report'
  bucket_key TEXT NOT NULL,               -- 'ip:{ip_hash}' または 'device:{device_id}'
  window_kind TEXT NOT NULL,              -- 'hour' | 'day'。`window` は SQLite 3.25 以降のキーワードなので列名に使わない
  window_start TEXT NOT NULL,             -- 窓の開始時刻（ISO8601 UTC、窓幅で切り捨て）
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, bucket_key, window_kind, window_start)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,                    -- UUID v4
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,                   -- 'spam' | 'personal_info' | 'inappropriate' | 'other'
  comment TEXT NULL,
  ip_hash TEXT NOT NULL,                  -- 同一通報者の重複排除に使う（生 IP は持たない）
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_page_id ON reports(page_id);
```

D1 では `PRAGMA foreign_keys` が既定で有効なので `ON DELETE CASCADE` が効く。

**作成の原子性**: `pages` と `events` の INSERT を別文で実行すると、途中失敗（D1 の一時エラー、isolate の終了）で `events` の無いページが残り、不変条件が破れる。`D1PageRepository.create` は 2 つの INSERT を `db.batch()`（暗黙のトランザクション）に載せて 1 回で実行する。T5 の結合テストで「`events` の INSERT が失敗したら `pages` も残らない」を固定する。

### 3.2 保持期限の計算（純粋関数）

```typescript
// src/core/config/limits.ts（足場 PR が所有。他 PR はここに定数を足さない）
export const MAX_EVENT_LEAD_TIME_MONTHS = 13   // concept §09「上限は 13 ヶ月の一本」。Phase 3 の無期限化はこの定数の外で扱う（§3.4）
export const RETENTION_DAYS_AFTER_LAST_EVENT = 7
export const RETENTION_DAYS_FOR_DRAFT = 7
export const DEFAULT_EVENT_DURATION_MINUTES = 60

// src/core/retention/calculateExpiresAt.ts
export interface EventTiming { endAt: Date | null }

/**
 * 保持期限を返す。
 * @param baseDate 日時の無い下書きの基準日。作成時は createdAt、更新時は now を渡す
 */
export function calculateExpiresAt(events: EventTiming[], baseDate: Date): Date {
  const ends = events.map(e => e.endAt).filter((d): d is Date => d !== null)
  if (ends.length === 0) return addDays(baseDate, RETENTION_DAYS_FOR_DRAFT)
  const last = new Date(Math.max(...ends.map(d => d.getTime())))
  return addDays(last, RETENTION_DAYS_AFTER_LAST_EVENT)
}

export function maxLeadTimeLimit(now: Date): Date   // now + 13 ヶ月（同日同時刻まで許容）
export function isWithinMaxLeadTime(eventStart: Date, now: Date): boolean
```

- `baseDate` は**作成時は `createdAt`、更新時は `now`** を渡す。更新で `now` を使うのは、作成から 7 日以上経ったページの日時を編集で消したとき、`createdAt + 7 日` では `expires_at` が即座に過去になり保存直後に 404 になるため。T11 のテスト観点に含める。
- Phase 1 は `events.length === 1` なので実質「そのイベントの終了 + 7 日、日時未確定なら作成（更新）+ 7 日」だが、配列を取るシグネチャで Phase 2 の「最終イベント」に自然に対応する。
- 戻り値は常に非 null で、`expires_at NOT NULL` と一致させる。Phase 3 の無期限化のための分岐や `null` 返却は置かない（§3.4）。

### 3.3 編集トークン

- 作成時に 32 byte の暗号学的乱数を base64url 化（43 文字）してレスポンスに一度だけ含める。
- サーバは SHA-256（hex）だけを `edit_token_hash` に保存し、編集時はリクエストのトークンをハッシュ化して定数時間比較する。
- **トークンは URL に載せない**。クライアントは localStorage に保存し、`GET/PATCH /api/pages/:id` へ `Authorization: Bearer <token>` で送る（§4.1）。別端末では編集できないトレードオフを明示的に受け入れる（concept §08「端末を変えると消えることだけが欠点」と整合）。

> 採らなかった案: `/:id/edit?token=...` のように編集リンクにトークンを載せる方式。`Referrer-Policy` を付けてもブラウザ履歴と共有時のコピペ事故に残る。「ログにクエリ文字列を残さない」運用ルールより、そもそも載せない設計を選んだ。

### 3.4 owner と発行者スロット（Phase 3 の穴）

- `owner_id` はカラムとしてのみ存在し、Phase 1 のアプリケーションコードは読み書きしない。
- `issuer_name` / `issuer_logo_url` は詳細ページのテンプレートに「非 null のときだけ描画する」関数を用意し、Phase 1 では常に非表示。空枠を DOM に残さない。
- 13 ヶ月上限は `MAX_EVENT_LEAD_TIME_MONTHS` の 1 定数に閉じる。concept §09 が求める穴は「定数 1 本にしておく」ことだけなので、Phase 1 では無期限化のための分岐を置かない。Phase 3 で無期限を足すときは「`expires_at` に遠未来の番兵値を書く」か「`calculateExpiresAt` に分岐を足す」かをその時点で決める。どちらでも `expires_at NOT NULL` と GC の `expires_at < now` 判定はそのまま使える。

### 3.5 変更バナー用のスナップショット

`PATCH /api/pages/:id` でタイトル・日時・場所のいずれかが変わったとき、**変更前の日時だけ**を `previous_snapshot`（`ChangeSnapshot` の JSON、§11.3）に、変更時刻を `changed_at` に書く。タイトル・場所は「変わった」という事実（`titleChanged` / `locationChanged`）だけを持ち、旧値は保存しない。メモだけの変更では書かない。`CHANGE_BANNER_HOURS = 48` 時間だけ詳細ページにバナーを出し（§8）、それを過ぎた行の `previous_snapshot` / `changed_at` は GC が NULL にする（§2.6）。タイトル・場所の比較は `null` と空文字、前後の空白の違いを変更とみなさない（`buildChangeSnapshot` 内で正規化して比較する）。編集画面が空欄を `''` で送ってもバナーが出ないようにするため。

> 旧値を日時に限る理由: 場所欄に自宅住所、タイトルに実名や電話番号を書いてしまい、気づいて編集で消す、という訂正が最も起きやすい。旧値をバナーに出すと「消したかった値」が 48 時間、より目立つ形で公開される。日時は個人情報になりにくく、受け手が一番知りたい差分でもあるので、バナーの目的は失われない。

---

## 4. URL 設計

### 4.1 一覧

| 用途 | パス | 種別 | 認証 | hidden / 期限切れ時 | 備考 |
|---|---|---|---|---|---|
| トップ（作成） | `/` `/new` | 静的 | — | — | プリフィルはクエリ文字列で受け取る（§5.8）。両方とも同じ `index.html`（`/new` は `new.html` として同内容を配置） |
| 完成 | `/done?id=:id` | 静的 + CSR | — | — | localStorage の履歴から `id` の項目を復元。無ければ `/:id` へ遷移。`id` が形式不正なら `/` へ（§6.2） |
| 履歴 | `/history` | 静的 + CSR | — | — | localStorage のみ |
| 編集 | `/:id/edit` | Worker → 編集画面の HTML + CSR | 編集トークン（localStorage） | HTML は返す（D1 を見ない）。API 側で 404 | トークンが無ければ「この端末では編集できません」 |
| 詳細ページ | `/:id` | 動的 SSR | — | 404 | catch-all。Cache API 60 秒 |
| ics | `/:id.ics` | 動的（R2 読み） | — | **404** | `Content-Type: text/calendar; charset=utf-8`。`Content-Disposition` は付けない（iOS の取り込みプレビュー優先）。R2 キーは `ics/{id}.ics`。日時の無い下書きも 404。R2 に無ければ `buildIcsForPage` で再生成して PUT してから返す（§2.3） |
| OGP 画像 | `/:id/ogp.png?v=:version` | 動的（遅延生成） | — | フォールバック PNG（§2.5） | 内部的に `ogp/{id}/{version}.png` |
| 通報フォーム | `/:id/report` | 動的 SSR | — | 404 | フォームの送信は `web/report/main.ts` が JSON で行う（§9.8） |
| 作成 API | `POST /api/pages` | API | — | — | レート制限 `create`。`application/json` 必須・同一オリジン必須（§9.8） |
| 取得 API（編集用） | `GET /api/pages/:id` | API | `Authorization: Bearer` | 404 | 編集フォームの初期値。レスポンスは `GetPageResponse` = `PageSummaryJson` + `rawText`（§11.3）。`rawText` を含むのは Bearer 必須で公開情報ではないため |
| 更新 API | `PATCH /api/pages/:id` | API | `Authorization: Bearer` | 404 | `status` `report_count` は変更しない |
| 通報 API | `POST /api/pages/:id/reports` | API | — | 404 | レート制限 `report`。`application/json` 必須・同一オリジン必須 |
| 解釈 API（予約） | `POST /api/interpret` | API | — | — | **Phase 1 は未実装**（404）。Phase 2 の LLM フォールバック用にパスとレート制限 scope `interpret` を予約する（§5.9） |
| ヘルスチェック | `GET /api/health` | API | — | — | 足場 PR の疎通用。`{ "ok": true }`、`Cache-Control: no-store`（§11.7） |

hidden / 期限切れの判定は `isServable(page, now)`（`server/lib/pageAccess.ts`）の 1 箇所に置き、`PageRepository.findById` を呼ぶ全ルートがこれを通す。`status = 'hidden'` と `expires_at <= now` を区別せず、存在しないページと同じ応答にする（存在を区別させない）。

`/:id.ics` を Phase 1 から用意する理由: Phase 2 で webcal 購読を始めるとき「購読 URL は最初から変わらない」を保証するため。owner 列・発行者スロットと同じ「穴だけ開けておく」対応。

### 4.2 ID の生成方法と長さ

- **公開ページ ID**: Crockford Base32 の小文字（`0123456789abcdefghjkmnpqrstvwxyz`、`i` `l` `o` `u` を除く 32 文字）から **12 文字**（60 bit、キースペース約 1.15×10^18）。`crypto.getRandomValues` の各バイトを `% 32` で写像する。256 は 32 で割り切れるので modulo bias が無く、rejection sampling は要らない。
  - concept のモック（`a7Kq2` = 5 文字）はデザイン上の簡略表記であり、推測不能性を優先して 12 文字にする意図的な逸脱として明記する。
  - 衝突時（`INSERT` の一意制約違反）は 1 回だけ再採番する。
- **編集トークン**: 32 byte 乱数の base64url（43 文字）。
- **イベント ID・通報 ID**: `crypto.randomUUID()`。

```typescript
// src/core/id/types.ts
export interface IdGenerator {
  generatePageId(): string      // 12 文字 Crockford Base32 小文字
  generateEditToken(): string   // base64url 43 文字
  generateUuid(): string
}

// src/core/id/crockford.ts
export const PAGE_ID_PATTERN = '[0-9a-hjkmnp-tv-z]{12}'
/** ページ ID の形式検証。サーバの全 `:id` ルートとクライアント（/done /edit /history）の入口で共通に使う */
export function isValidPageId(s: string): boolean
```

**ID の入口検証を共通化する理由**: クライアントが `location.replace('/' + id)` のように遷移先を組むと、`id=/evil.example` で `//evil.example`（プロトコル相対 URL）になり外部へ飛ぶ（open redirect）。`/done` は完成画面としてユーザーが信頼して開くパスなので、フィッシングの踏み台になる。クライアント側は `isValidPageId` を通した上で、遷移先を `new URL(path, location.origin)` で組み `origin` が一致することを確認してから遷移する（§6.2）。

### 4.3 推測攻撃対策として「やらないこと」

404 の頻度を IP 単位で D1 に書き込んでレート制限する案は採らない。ランダムな ID を大量に叩かれるとその書き込み自体が D1 の書き込み枠を消費する増幅攻撃の入口になる。推測攻撃への一次防御は 10^18 のキースペースに委ね、追加防御が要る場合は Cloudflare 側の WAF レート制限ルール（エッジで完結）を運用で有効化する。D1 のカウンタは `create` と `report` という低頻度の操作にのみ使う。

---

## 5. 日時パースの仕様

### 5.1 スコープと入力の形

- 入力欄は `<textarea>` 1 つ（原則 1「1 行でも 100 行でも同じ場所に入れる」）。**1 行目をパース対象、2 行目以降はそのままメモ**にする。Phase 2 の複数イベント貼り付けはこの規則を「複数行をパース対象にする」方向へ広げる。
- パーサが 1 行目から抽出するのは **タイトル・日時・場所・メモ（1 行目の残り）**。タイムゾーンは Asia/Tokyo 固定。日本には夏時間が無いので `JST - 9 時間 = UTC` の算術だけで変換し、タイムゾーンライブラリは持ち込まない。
- 現在時刻は引数で受け取る（実行環境の時計に依存させず、日付をまたぐケースをテストで固定するため）。
- **正規表現の実装規約**: パーサはブラウザとサーバの両方で 2,000 文字の入力を受ける。ネストした量指定子（`(a+)+` 形式）や `\S+` と任意文字の組み合わせのようにバックトラックが爆発するパターンを使わない。全パターンは 1 行目（最初の改行まで）にのみ適用する。T2 の unit テストに「2,000 文字の繰り返し入力（`9/` × 1000、`〜` × 2000、`http://` × 200、`a.` × 1000、`-.` × 1000 など）が 50ms 以内に返る」を入れる（`a.` `-.` の繰り返しは `URL_PATTERN` のベアドメイン判定が開始位置ごとに末尾までなめる形になっていないかの確認）。作成 API はパースや検証の前に `MAX_INPUT_LENGTH` で弾く（§5.7）。

```typescript
// src/core/parse/types.ts
export interface ParseContext {
  /** 基準時刻。テストでは固定値、本番では new Date() */
  now: Date
}

export type ParseIssue =
  | 'no_datetime'            // 日付も時刻も見つからない（下書き）
  | 'invalid_date'           // 2/30 のような存在しない日付があった
  | 'past_date'              // 年を明示した過去日
  | 'beyond_max_lead_time'   // 13 ヶ月より先

export interface ParsedEvent {
  title: string                // 空文字にはしない（§5.5 規則 T）
  location: string | null
  memo: string | null          // 1 行目の残り + 2 行目以降。無ければ null
  start: Date | null           // 確定できなければ null（下書き）
  end: Date | null             // start が非 null なら必ず非 null
  isAllDay: boolean
  issues: ParseIssue[]
  /** 残りが空白区切り 1 語だけでタイトルにした場合 true。UI の「場所にする」入れ替えに使う（§6.1） */
  singleTokenTitle: boolean
}

export function parseEventText(input: string, ctx: ParseContext): ParsedEvent
```

### 5.2 抽出の優先順位

1. 入力の改行は `\r\n` `\n` のどちらも受け付ける。先頭に空行があっても無視し、最初の空でない行をパース対象（1 行目）にする。それより後ろの行は trim して `memo` の末尾に付ける（1 行目由来のメモがあれば改行で結合）。
2. 1 行目を正規化する（全角英数字・記号 → 半角、全角スペース → 半角、`：` → `:`、`／` → `/`、`．` → `.`、C0 制御文字とゼロ幅文字（U+200B〜U+200D, U+FEFF）を除去）。`-` `−` `–` `～` `〜` の範囲記号は文字列を書き換えず、日付・時刻の正規表現側の文字クラスとして扱う（手順 4・5）。行全体を `〜` に書き換えると、日付・時刻と無関係なハイフン（電話番号 `03-1234-5678`、英語表記 `Re-union` 等）まで壊れるため
3. **URL** を 1 行目から取り除き、メモの先頭に移す。URL の判定は `src/core/text/urlPattern.ts` の正規表現 `URL_PATTERN` に集約し、`countUrls`（§9.2）も同じ定義を参照する（ics のサニタイズが参照する定義は次段落の `WIDE_URL_PATTERN` で、非対称性がある）。判定対象は (a) `https?://` 付き、(b) `www.` 始まり（ホスト名は ASCII の語・ハイフンのみ）、(c) ベアドメイン `[\w-]+(\.[\w-]+)*\.[a-z]{2,}` のうち **`/` が続く（`example.xyz/path`）か、末尾ラベルが `co|com|jp|net|org|io|me|ly|app|dev|link` のいずれかで、かつその直後に英数字・ハイフンが続かない（`example.com` `example.co.jp` `bit.ly` は該当、`example.company` は非該当）** のもの（末尾ラベルが英字 2 文字以上というだけでは `Node.js` `Vue.js` `Next.js` のような製品名が URL に数えられ、ics で「[リンク]」に置換されてしまう。`9.20` のような数字はドメインにしない）の 3 形式。(b)(c) はいずれも、単語の途中（ドット区切り語の一部）や `hxxps://` のような難読化された scheme の直後からは拾わない。`hxxps://` `hxxp://www...` のような難読化表記自体も対象にしない（受け手のカレンダーアプリもリンク化しないため）。
   > ics のサニタイズ（§7.2）は `URL_PATTERN` より広く一致してよい。`URL_PATTERN` は「本文からの URL 抽出」が目的で誤検出（製品名等）を避ける必要があるのに対し、ics 側は「§7.2 の外部リンク 0 本」が目的で、広く一致しすぎても文字列が過剰に「[リンク]」へ置換されるだけでリンクは増えない。この非対称性のため `src/core/text/urlPattern.ts` は 2 本の正規表現を持つ: 抽出用の `URL_PATTERN`（本節の 3 形式のみ）と、ics のサニタイズ専用の `WIDE_URL_PATTERN`（IDN・全角ホスト・IPv6 リテラル・userinfo・記号カテゴリホストの受け皿に加え、obfuscated scheme や `ftp://` 等の他スキームの直後でもホスト部だけは拾う）。`sanitizeIcsText` は `WIDE_URL_PATTERN` を呼ぶだけで独自の判定を持たない（Issue #19）。記号カテゴリの文字（Unicode カテゴリ So、`ⓔⓥⓘⓛ.com` の丸囲み英数字等）がホストの途中に現れる場合は、正規表現だけでは英字に写像される文字と絵文字等を区別できないため、断片が本文に残ることがある（外部リンクにはならない。既知の限界、§14.1）。
4. **日付トークン**を検出する。複数見つかった場合は、出現順に検証し、最初に有効な（カレンダー上に存在し、規則 D2・D3 も満たす）ものを採用する。それより前にあった無効な候補は消費せず、通常の文字として残す（規則 D6・D7）。有効な候補が 1 つも無ければ、最初に見つかった無効な候補について `invalid_date` を issue に入れる。日付範囲 `M/D〜M/D` は 1 トークン。
5. **時刻トークン**（範囲・単発）を検出する。日付トークンと同様に、出現順に検証し最初に有効なものを採用する（規則 T6）。
6. 日付・時刻として消費した部分を空白に置き換え、残りの文字列 `R` から **場所** を検出する（§5.5 規則 L）。
7. 残りから **タイトルとメモ** を分ける（§5.5 規則 T）。
8. 日付と時刻を合成し、曖昧さの規則（§5.5）で `start` / `end` / `isAllDay` / `issues` を決める。

### 5.3 対応パターン

| 種別 | パターン | 例 | 解決 |
|---|---|---|---|
| 絶対日付 | `M/D` `M月D日`（末尾 `(曜)` `(祝)` 任意） | `9/20` `9月20日(日)` | 年は今日基準で補完（規則 D1）。曜日・祝日のカッコ書きは検証せず無視する。カッコの中身は曜日・祝に限り、それ以外の文字列（`(19時〜)` 等）はカッコごと日付トークンに含めない |
| 年付き日付 | `YYYY/M/D` `YYYY年M月D日` | `2027/3/1` | 年をそのまま採用（規則 D2, D3） |
| 日付範囲 | `M/D〜M/D`（年付き可） | `9/20〜9/21` | 終日の複数日予定（規則 A2） |
| 相対日 | `今日` `本日` / `明日` / `あさって` `明後日` | | +0 / +1 / +2 日 |
| 曜日単独 | `月〜日曜(日)` | `金曜` | 今日を含め直近の当該曜日（規則 D4） |
| 今週 + 曜日 | `今週◯曜` | `今週金曜` | 月曜始まりの今週の当該曜日。過去なら翌週（規則 D5） |
| 来週 + 曜日 | `来週◯曜` | `来週月曜` | 今週の当該曜日 + 7 日 |
| 時刻 | `H:MM` `H時` `H時MM分` `H時半` | `19:00` `19時` `19時半` | 「半」= 30 分 |
| 午前・午後 | `午前H時` `午後H時` `朝H時` `夜H時` `夕方H時` | `午後7時` | 午後・夜・夕方は +12 時（12 時は加算しない） |
| 時刻範囲 | `H〜H` `HからH(まで)` `H:MM-H:MM` | `19時〜21時` `19:00-21:00` | 終了 < 開始なら日を跨ぐ（規則 T3）。`から` の後の空白（`19時から 21時まで`）は許容する。終了が不正（T6）なら開始も含めてトークンごと消費しない |
| 開始のみ | `H〜` `Hから` `Hまで` | `19時〜` `19時まで` | 終了は開始 + 60 分。`H時間`（所要時間）や `H:MM:SS` の秒は時刻として消費しない |

サポートしない（既知の限界、§14）: `.` 区切りの日付（`9.20`）、`来月` `再来週` 等の月・複数週の相対表現（`再来週◯曜` は `来週◯曜` として誤読しないよう検出しないが、単独の曜日表記として直近の当該曜日に解決されることはある）、`夜` `朝` などの時刻を伴わない時間帯語、英語表記、時刻付きの複数日レンジ（`9/20 19時〜9/21 10時`）。

### 5.4 場所のストップリスト

「〜で」の直前が場所を意味しない定型語なら場所として採用しない。リストは「候補 + `で`」の形で持ち、規則 L2 で候補 + `で` がリストに一致するかを見る。初期リスト: `みんなで` `皆で` `ひとりで` `一人で` `全員で` `二人で` `2人で` `ふたりで` `家族で` `有志で` `急ぎで` `無料で`。`でも`（`誰でも歓迎`）はリストではなく規則 L1 の区切り判定（`で` の直後が `も・す・は・き` のいずれか、または `した` から始まるなら区切りにしない。`です` `では` `できる` `でした` の一部を場所と誤認しないため）で除外する。`オンラインで` はリストに入れない（`オンライン` は場所として採用する）。リストは `src/core/parse/stopWords.ts` に置き、外れたケースを見つけたらテスト行と一緒に足す。

### 5.5 曖昧さの解決規則

**日付（D）**

| 規則 | 内容 | 理由 |
|---|---|---|
| D1 年の補完 | 年省略の `M/D` `M月D日` は今日の年を仮定し、結果が今日より前（同日は含まない）なら翌年に繰り上げる。繰り上げた先の年にもその日付が存在するか必ず確認し（`2/29` のように今年に無ければ翌年を確認し、翌年にも無ければ D6）、無ければ D6（`invalid_date`）にする | 保持期限は「終了 + 7 日」なので、繰り上げないと作成直後に期限切れのページが生まれる |
| D2 年明示の過去日 | 年を明示して今日より前なら `past_date` を issue に入れ、日時は採用しない（`start = null`）。日付を消費した残りはタイトルに使う。日付範囲（後述）の開始も、年を明示していればこの規則を適用する | ユーザーが意図して書いた可能性を否定できないので勝手に未来へ書き換えず、プレビューで確認を促す |
| D3 13 ヶ月超 | 開始が `now + MAX_EVENT_LEAD_TIME_MONTHS` を超える（同日同時刻は許容）なら `beyond_max_lead_time` を issue に入れ、日時は採用しない。日付範囲の開始も、年を明示していればこの規則を適用する | concept §07 の上限。定数はパーサと API 検証の両方が同じものを参照する |
| D4 曜日単独 | 今日を含めて直近の当該曜日。今日が当該曜日で、時刻指定が既に過ぎている（基準時刻とちょうど同時刻は「過ぎていない」扱い。規則 T4 と揃える）なら +7 日 | 「水曜 19 時」を水曜午前に書く用途 |
| D5 今週 + 曜日 | 月曜始まりの今週の当該曜日。それが今日より前なら翌週へ繰り上げる。当該曜日が今日で時刻指定が既に過ぎている場合も +7 日（D4 と同じ扱い） | 「今週月曜」を水曜に書くのは言い間違いか翌週の意図であり、過去のページを作らない |
| D6 不正な日付 | `2/30` `13/1` のように存在しない日付はトークンとして消費せず通常の文字として残し、`invalid_date` を issue に入れる。日付候補が複数あるときは出現順に検証し、それより後に有効な候補が見つかればそちらを採用する（issue には入れない）。有効な候補が 1 つも無ければ最初に見つかった不正な候補について `invalid_date` にする（`2/30 or 3/1` → `3/1` を採用。単独の `2/30` のみなら `invalid_date`）。不正と判定した日付範囲の内側にある月日は、単独の日付としては採用しない（`2027/1/3〜2026/12/30` は範囲ごと `invalid_date` にし、内側の `2027/1/3` を単日として拾わない） | 黙って捨てず、プレビューで気づけるようにする |
| D7 複数の日付 | 最初に見つかった**有効な**日付だけ採用し、それ以外（不正な候補も含む）は文字として扱う（メモかタイトルに残る） | 「9/20 と 10/5 どちらか」のような未確定表現は Phase 1 で扱わない |

**時刻（T）**

| 規則 | 内容 | 理由 |
|---|---|---|
| T1 終了時刻のデフォルト | 終了が無ければ開始 + `DEFAULT_EVENT_DURATION_MINUTES`（60 分）。表示も「19:00〜20:00」と終了込みで出す（開放端「19:00〜」の表示はしない） | ics / Google の `dates` は終了必須。データモデルに「終了が明示か既定か」を持たず、表示・OGP・ics・Google リンクを 1 つの `EventFields` から同じ形で作る（**採用した判断**。concept §03 のモックは「19:00〜」だが、開放端の区別を型・DB・表示の 3 箇所に足すより、合格基準の速さを優先して表示を揃えた） |
| T2 1〜7 時は午後 | **`H時` `H時半` `H時MM分` 表記にのみ適用する。** 午前・午後・朝・夜・夕方の語が無く、時が `1〜7` なら +12 時（13〜19 時）。`0` `8〜23` はそのまま。**`H:MM` 表記はリテラル**（`7:00` は 07:00） | 飲み会・待ち合わせ用途では `7時` の大半が 19 時。`7時集合` のような朝の用途は `朝7時` か `7:00` で書ける（**採用した判断**。開発速度優先案はリテラル解釈だったが、毎回タップ修正を強いるのは合格基準に不利と判断した。実運用で外れが多ければ §14 で見直す） |
| T3 範囲の終了時刻 | 開始に T2 を適用した後、終了を次の順で決める。(1) `H:MM` 表記か午前・午後の語があればその値（リテラル）。(2) `H時` 表記なら候補 `{E, E+12}`（`E+12 < 24` のもの）のうち**開始より後になる最小の候補**を採る。(3) 候補が無い（終了 ≤ 開始）なら E のまま**翌日**にする | `6時〜8時` → 18:00〜20:00、`10時〜2時` → 10:00〜14:00、`23:00〜1:00` → 23:00〜翌 01:00、`19時〜7時` → 19:00〜翌 07:00（徹夜）、`23時〜1時` → 23:00〜翌 01:00 |
| T4 時刻のみ・日付なし | 今日を仮定し、開始が基準時刻より前なら翌日にする | 作成直後に過去になるページを作らない |
| T5 明示日付 + 過ぎた時刻 | `9/16 8:00` を 9/16 10:00 に書いた場合はそのまま採用する（繰り上げない） | 日付を明示しているので勝手に未来へ書き換えず、プレビューで「過去の日時です」（§5.7 `PAST_EVENT`）を出して修正を促す。パーサは拒否せず API 側の検証で弾く |
| T6 24 時以上 | `25時` のような時刻は不正としてトークンにしない。時刻候補が複数あるときは出現順に検証し、最初に有効なものを採用する（`25時ではなく19時` → `19時` を採用）。範囲の終了だけが不正なとき（`19時〜25時`）は、開始も含めてトークンごと消費しない（終了だけを切り離して開始のみ採用することはしない） | |

**終日（A）**

| 規則 | 内容 |
|---|---|
| A1 | 日付はあるが時刻が無い → 終日。`start` = その日 00:00 JST、`end` = 翌日 00:00 JST（排他的） |
| A2 | 日付範囲 `M/D〜M/D` → 終日の複数日。`end` = 終了日の翌日 00:00 JST。終了の年を省略していて終了日 < 開始日なら年またぎとみなし終了日を翌年にする。終了の年を明示していて終了日 < 開始日なら、年をまたぐ意図か開始日側の年繰り上げ（D1）とかみ合っていない矛盾した入力とみなし `invalid_date` にする |
| A3 | 日付も時刻も無い → 完全な下書き（`start = end = null`、`no_datetime`）。保持期限は作成 + 7 日 |

**場所（L）**

| 規則 | 内容 |
|---|---|
| L1 | 残り `R` の中で、`で` または `にて` の直前のひとまとまり（直前の空白・読点から `で` まで）を場所候補にする。ただし `で` の直後が `も・す・は・き` のいずれか、または `した` から始まるとき（`誰でも` `〜です` `渋谷では` `〜できる` `〜でした`）はその `で` を区切りにしない（`渋谷でしゃぶしゃぶ` の `し` はこれに当たらないので区切りにする）。最初に見つかったものを採用 |
| L2 | 候補 + `で` がストップリスト（§5.4）に一致すれば場所にせず、`で` を含めてタイトル側の文字として扱う。この場合、次の場所候補はこの `で` の直後から探す（`みんなで渋谷で飲み会` → `みんなで` を除外した後は `渋谷` だけを候補にし、`みんなで渋谷` のように候補が伸びないようにする） |
| L3 | `で` が無ければ場所は null。ただし残りが空白区切り 1 語（読点を含まない）だけなら `singleTokenTitle = true` にし、UI で「場所にする」を 1 タップで選べるようにする（§6.1） |

> 採らなかった案: `9/20 19時 渋谷`（「で」無しの末尾 1 語）を場所として拾う規則。`9/20 19時 飲み会` を場所=飲み会 と誤るケースの方が多いと判断し、タイトルに置いた上で 1 タップで入れ替えられる UI を採った。concept の合格基準の例文はこの UI で救う。

**タイトルとメモ（T）**

| 規則 | 内容 |
|---|---|
| T-a | 場所が見つかった場合、`で` の後ろの文字列 `A` の最初のまとまり（最初の空白・読点まで）をタイトル、`A` の残りをメモにする。`で` より前で場所にならなかった文字列 `B` もメモに回す（`B` → `A` の残り の順で改行結合） |
| T-b | 場所が無い場合、`R` を最初の読点 `、` で分け、前をタイトル、後ろをメモにする。読点が無ければ `R` 全体をタイトルにする（空白区切りの複数語は分割しない） |
| T-c | タイトルが空なら日時の整形文字列（`formatDateLabel`。例: `9月20日(日) 19:00〜20:00`、終日なら `9月20日(日)`）をタイトルにする。日時も無ければ 1 行目の原文（正規化前）をタイトルにする。それも空なら空文字を返し、API 側の検証で弾く |
| T-d | メモは前後の空白を trim し、空なら null |

### 5.6 テストケース表

基準時刻: `2026-09-16(水) 10:00 JST`。日付は特記が無ければ 2026 年、時刻は JST。「終日」は `start` がその日 00:00、`end` が翌日 00:00（排他的）。issue 欄が空なら `issues = []`。

| # | 入力（1 行目。`\n` は改行） | 期待タイトル | 期待開始 | 期待終了 | 期待場所 | 期待メモ | issue / 備考 |
|---|---|---|---|---|---|---|---|
| 1 | `9/20 19時 渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | null | 基本形。T1 |
| 2 | `9/20 19:00-21:00 渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 21:00 | 渋谷 | null | ハイフン区切りの範囲 |
| 3 | `9月20日(日)19:00〜21:00 渋谷で忘年会` | 忘年会 | 09-20 19:00 | 09-20 21:00 | 渋谷 | null | `M月D日` + 曜日括弧 + 空白なし |
| 4 | `9/20(月) 19時 渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | null | 曜日誤り（実際は日曜）でも数値日付優先 |
| 5 | `19時から21時まで 新宿で勉強会 9/25` | 勉強会 | 09-25 19:00 | 09-25 21:00 | 新宿 | null | 語順が入れ替わっても抽出できる。`から〜まで` |
| 6 | `9/20 19時〜 渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | null | 開始のみ。T1 |
| 7 | `9/20 午後7時 飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | 午後表記 |
| 8 | `9/20 午前7時 集合` | 集合 | 09-20 07:00 | 09-20 08:00 | null | null | 午前表記 |
| 9 | `9/20 7時 飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | T2: 1〜7 時は午後 |
| 10 | `9/20 朝7時 集合` | 集合 | 09-20 07:00 | 09-20 08:00 | null | null | `朝` は午前の印 |
| 11 | `9/20 8時 朝礼` | 朝礼 | 09-20 08:00 | 09-20 09:00 | null | null | T2: 8 時はそのまま |
| 12 | `9/20 12時 ランチ` | ランチ | 09-20 12:00 | 09-20 13:00 | null | null | 12 時は加算しない |
| 13 | `9/20 午後12時 ランチ` | ランチ | 09-20 12:00 | 09-20 13:00 | null | null | 午後 12 時 = 12:00 |
| 14 | `9/20 19時半 飲み会` | 飲み会 | 09-20 19:30 | 09-20 20:30 | null | null | 「半」= 30 分 |
| 15 | `9/20(日) 19時30分〜21時 渋谷で女子会` | 女子会 | 09-20 19:30 | 09-20 21:00 | 渋谷 | null | 分単位 + 範囲 |
| 16 | `9/20 6時〜8時 飲み会` | 飲み会 | 09-20 18:00 | 09-20 20:00 | null | null | T2 で開始 18:00。終了は T3(2): 候補 {8, 20} のうち開始より後の最小 = 20 |
| 17 | `9/20 飲み会` | 飲み会 | 09-20 終日 | 09-21 終日 | null | null | A1 |
| 18 | `9/20〜9/21 合宿` | 合宿 | 09-20 終日 | 09-22 終日 | null | null | A2: 複数日終日 |
| 19 | `9/20〜9/23 文化祭` | 文化祭 | 09-20 終日 | 09-24 終日 | null | null | A2 |
| 20 | `12/30〜1/3 帰省` | 帰省 | 12-30 終日 | 2027-01-04 終日 | null | null | A2: 終了日 < 開始日 → 翌年 |
| 21 | `明日15時から面談` | 面談 | 09-17 15:00 | 09-17 16:00 | null | null | 相対日 |
| 22 | `あさって10時 歯医者` | 歯医者 | 09-18 10:00 | 09-18 11:00 | null | null | 相対日 |
| 23 | `明後日 渋谷で打ち合わせ 10:00` | 打ち合わせ | 09-18 10:00 | 09-18 11:00 | 渋谷 | null | `明後日` は `あさって` の同義語。語順入れ替え |
| 24 | `今日19時 反省会` | 反省会 | 09-16 19:00 | 09-16 20:00 | null | null | `今日`（`本日` も同義） |
| 25 | `来週月曜10時 会議室Aで定例MTG` | 定例MTG | 09-21 10:00 | 09-21 11:00 | 会議室A | null | 来週 + 曜日 |
| 26 | `今週金曜 渋谷で飲み会` | 飲み会 | 09-18 終日 | 09-19 終日 | 渋谷 | null | D5 + A1 |
| 27 | `今週水曜19時 飲み会` | 飲み会 | 09-16 19:00 | 09-16 20:00 | null | null | D5: 今週の当該曜日 = 今日 |
| 28 | `今週月曜19時 渋谷で飲み会` | 飲み会 | 09-21 19:00 | 09-21 20:00 | 渋谷 | null | D5: 今週月曜は過去 → 翌週 |
| 29 | `金曜19時〜 誰でも歓迎` | 誰でも歓迎 | 09-18 19:00 | 09-18 20:00 | null | null | 曜日単独。L1: `で` の直後が `も` なので区切りにしない |
| 30 | `月曜19時 渋谷で飲み会` | 飲み会 | 09-21 19:00 | 09-21 20:00 | 渋谷 | null | D4: 直近の月曜 |
| 31 | `水曜19時 飲み会` | 飲み会 | 09-16 19:00 | 09-16 20:00 | null | null | D4: 今日が当該曜日で時刻は未来 |
| 32 | `水曜8時 朝会` | 朝会 | 09-23 08:00 | 09-23 09:00 | null | null | D4: 今日が当該曜日だが時刻が過去 → +7 日 |
| 33 | `20時から反省会` | 反省会 | 09-16 20:00 | 09-16 21:00 | null | null | T4: 時刻のみ・未来なら今日 |
| 34 | `8時から朝礼` | 朝礼 | 09-17 08:00 | 09-17 09:00 | null | null | T4: 時刻のみ・過ぎていれば翌日 |
| 35 | `3/1 卒業式` | 卒業式 | 2027-03-01 終日 | 2027-03-02 終日 | null | null | D1: 年省略の過去日 → 翌年 |
| 36 | `9/15 打ち上げ` | 打ち上げ | 2027-09-15 終日 | 2027-09-16 終日 | null | null | D1: 昨日 → 翌年 |
| 37 | `9/16 8:00 朝会` | 朝会 | 09-16 08:00 | 09-16 09:00 | null | null | T5: 明示日付 + 過ぎた時刻は繰り上げない。API では `PAST_EVENT`（§5.7）になり、プレビューが修正を促す |
| 38 | `9/16 10:00〜11:00 本社で定例会議` | 定例会議 | 09-16 10:00 | 09-16 11:00 | 本社 | null | D1 の境界: 同日は繰り上げない |
| 39 | `2024/3/1 卒業式` | 卒業式 | null | null | null | null | D2: `past_date` |
| 40 | `2027年10月16日 総会` | 総会 | 2027-10-16 終日 | 2027-10-17 終日 | null | null | D3 の境界: ちょうど 13 ヶ月は許容 |
| 41 | `2027/10/17 総会` | 総会 | null | null | null | null | D3: `beyond_max_lead_time` |
| 42 | `12/31 23:00 忘年会` | 忘年会 | 12-31 23:00 | 2027-01-01 00:00 | null | null | 年またぎの終了時刻（T1） |
| 43 | `9/20 23:00〜1:00 カラオケで打ち上げ` | 打ち上げ | 09-20 23:00 | 09-21 01:00 | カラオケ | null | T3(1)(3): `H:MM` はリテラル。終了 ≤ 開始で翌日 |
| 44 | `2/30 変な日付` | 2/30 変な日付 | null | null | null | null | D6: `invalid_date` + `no_datetime` |
| 45 | `9/20 25時 集合` | 25時 集合 | 09-20 終日 | 09-21 終日 | null | null | T6: 不正な時刻はトークンにしない → 終日 |
| 46 | `９／２０　１９時　渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | null | 全角正規化。#1 と同結果 |
| 47 | `9/20 19時 渋谷` | 渋谷 | 09-20 19:00 | 09-20 20:00 | null | null | L3: `singleTokenTitle = true`。UI で「場所にする」を出す |
| 48 | `9/20 19時` | 9月20日(日) 19:00〜20:00 | 09-20 19:00 | 09-20 20:00 | null | null | T-c: タイトル無しは日時表現（終了込み。T1） |
| 49 | `9/20` | 9月20日(日) | 09-20 終日 | 09-21 終日 | null | null | T-c: 終日の日時表現 |
| 50 | `渋谷で忘年会` | 忘年会 | null | null | 渋谷 | null | A3: `no_datetime`。場所は拾う |
| 51 | `飲み会やります` | 飲み会やります | null | null | null | null | A3: `no_datetime` |
| 52 | `9/20 19時〜21時 みんなで飲み会` | みんなで飲み会 | 09-20 19:00 | 09-20 21:00 | null | null | L2: ストップリスト |
| 53 | `9/20 19時 オンラインで勉強会` | 勉強会 | 09-20 19:00 | 09-20 20:00 | オンライン | null | `オンライン` は場所（ストップリストに入れない） |
| 54 | `9/20 19:00〜21:00 渋谷区役所で飲み会 会費5000円、遅れる人は連絡` | 飲み会 | 09-20 19:00 | 09-20 21:00 | 渋谷区役所 | 会費5000円、遅れる人は連絡 | T-a: `で` 直後の最初のまとまりがタイトル、残りがメモ |
| 55 | `会費5000円 19時から 渋谷区役所で説明会` | 説明会 | 09-16 19:00 | 09-16 20:00 | 渋谷区役所 | 会費5000円 | T-a: 場所より前の残り `B` はメモ |
| 56 | `9/20 19時 渋谷 忘年会` | 渋谷 忘年会 | 09-20 19:00 | 09-20 20:00 | null | null | T-b: 空白区切りの複数語は分割しない。`singleTokenTitle = false` |
| 57 | `9/20 19時 忘年会、会費5000円` | 忘年会 | 09-20 19:00 | 09-20 20:00 | null | 会費5000円 | T-b: 読点で分割 |
| 58 | `9/20 19時 渋谷で飲み会 https://example.com/map` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | https://example.com/map | URL はメモへ。HTML では自動リンクしない（§9.2） |
| 59 | `9/20 19時 渋谷で飲み会\n会費5000円\n遅れる人は連絡` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | 会費5000円\n遅れる人は連絡 | 2 行目以降はそのままメモ |
| 60 | `9/20と10/5どちらか 渋谷で検討会` | 検討会 | 09-20 終日 | 09-21 終日 | 渋谷 | と10/5どちらか | D7: 最初の日付だけ採用。残りはメモに落ちる粗さは既知 |
| 61 | `9.20 19:00 飲み会` | 9.20 飲み会 | 09-16 19:00 | 09-16 20:00 | null | null | `9.20` は未対応。`19:00` だけ消費されて T4 が効く（既知の限界） |
| 62 | `` （空文字） | （空文字） | null | null | null | null | `no_datetime`。クラッシュしないことのみ保証。API は `EMPTY_INPUT` で 400 |
| 63 | `9/20 7:00 集合` | 集合 | 09-20 07:00 | 09-20 08:00 | null | null | T2 は `H:MM` 表記に適用しない（リテラル） |
| 64 | `9/20 10時〜2時 作業` | 作業 | 09-20 10:00 | 09-20 14:00 | null | null | T3(2): 候補 {2, 14} のうち開始より後の最小 = 14 |
| 65 | `9/20 19時〜7時 徹夜作業` | 徹夜作業 | 09-20 19:00 | 09-21 07:00 | null | null | T3(3): 候補 {7, 19} に開始より後のものが無い → E=7 のまま翌日 |
| 66 | `9/20 23時〜1時 打ち上げ` | 打ち上げ | 09-20 23:00 | 09-21 01:00 | null | null | T3(3): 候補 {1, 13} に開始より後のものが無い → 翌日 01:00 |
| 67 | `9/20 6:00〜8:00 早朝ラン` | 早朝ラン | 09-20 06:00 | 09-20 08:00 | null | null | `H:MM` の範囲は両端リテラル |
| 68 | `今週水曜8時 朝会` | 朝会 | 09-23 08:00 | 09-23 09:00 | null | null | D5: 当該曜日が今日で時刻が過去 → +7 日（#32 と同じ扱い） |
| 69 | `2/29 うるう日` | 2/29 うるう日 | null | null | null | null | D1: 2026 年にも 2027 年にも存在しない → `invalid_date` + `no_datetime`（基準が 2027 年なら 2028-02-29 になる） |
| 70 | `9/20 19時 車で移動` | 移動 | 09-20 19:00 | 09-20 20:00 | 車 | null | L1 の誤検出例。UI の「空にする = 使わない」で場所を消せる（§6.1）。ストップリストに `車で` を足すかは実データで判断 |
| 71 | `9/20 19時〜8時 夜勤` | 夜勤 | 09-20 19:00 | 09-20 20:00 | null | null | T3(2): 候補 {8, 20} のうち開始より後の最小 = 20。翌朝 8 時の意図は取れない（既知の限界、§14.1） |
| 72 | `会費3000/5000円 9/20 19時 飲み会` | 会費3000/5000円 飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | 数字列の途中（`00/50`）を日付として切り出さず、有効な `9/20` を採用する |
| 73 | `2/30 or 3/1 飲み会` | 2/30 or 飲み会 | 2027-03-01 終日 | 2027-03-02 終日 | null | null | D6/D7: 最初の `2/30` は invalid のため消費せず、後続の有効な `3/1` を採用（D1 で翌年） |
| 74 | `2026/9 総会` | 2026/9 総会 | null | null | null | null | `年/月` だけの不完全な表記は日付として検出しない。`no_datetime` |
| 75 | `9/20(19時〜) 渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | `( )` | 曜日カッコの中身は曜日・祝に限る。カッコ自体は日付・時刻のどちらでもないため文字として残る |
| 76 | `9/20(渋谷駅集合 19時) 飲み会` | `(渋谷駅集合 ) 飲み会` | 09-20 19:00 | 09-20 20:00 | null | null | カッコの中身が曜日・祝でなければカッコごと文字として残す（データは失わない） |
| 77 | `9/20 25時ではなく 19時 集合` | `25時ではなく 集合` | 09-20 19:00 | 09-20 20:00 | null | null | T6: 最初の `25時` は不正のため消費せず、後続の有効な `19時` を採用する |
| 78 | `9/20 19時〜25時 飲み会` | `19時〜25時 飲み会` | 09-20 終日 | 09-21 終日 | null | null | T6: 範囲の終了だけ不正なら、開始も含めてトークンごと消費しない（既知の挙動） |
| 79 | `9/20 19時まで 受付` | 受付 | 09-20 19:00 | 09-20 20:00 | null | null | 「まで」は から・〜 が無い単独の `H時まで` でも時刻側で消費し、場所として誤検出しない。`まで` は終了だけの指定として扱わず、時刻はそのまま開始として扱う（終了のみを表す表現は Phase 1 では扱わない。T1 で終了は必ず開始から導く） |
| 80 | `9/20 19時から 21時まで 飲み会` | 飲み会 | 09-20 19:00 | 09-20 21:00 | null | null | 「から」の後の空白も範囲として解決する |
| 81 | `9/20 19時 飲み会です` | 飲み会です | 09-20 19:00 | 09-20 20:00 | null | null | L1: `です` の `で` は区切りにしない |
| 82 | `9/20 19時 参加できる人だけ` | 参加できる人だけ | 09-20 19:00 | 09-20 20:00 | null | null | L1: `できる` の `で` は区切りにしない |
| 83 | `9/20 19時 渋谷では飲み会` | 渋谷では飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | L1: `では` の `で` は区切りにしない（`渋谷` は場所として取れなくなるが既知のトレードオフ） |
| 84 | `9/20 19時 みんなで渋谷で飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | みんなで | L2: ストップワードを除いた直後から次の場所候補を探すので、候補が伸びない |
| 85 | `9/20 飲み会 2時間くらい` | 飲み会 2時間くらい | 09-20 終日 | 09-21 終日 | null | null | `H時間`（所要時間）は時刻として消費しない |
| 86 | `9/20 19:00:00 飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | `H:MM:SS` の秒は読み飛ばす |
| 87 | `再来週月曜 会議` | 再来週 会議 | 09-21 終日 | 09-22 終日 | null | null | 「再来週」は未対応（既知の限界）。`来週月曜` として誤読はしないが、単独の `月曜` として D4（直近の月曜）に解決される |
| 88 | `9/20 19時 渋谷で飲み会\r\n会費5000円\r\n遅れる人は連絡`（CRLF） | 飲み会 | 09-20 19:00 | 09-20 20:00 | 渋谷 | `会費5000円\n遅れる人は連絡` | `\r\n` も `\n` と同様に改行として扱い、メモに `\r` を残さない |
| 89 | `\n9/20 19時 飲み会`（先頭が空行） | 飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | 先頭の空行は無視し、最初の空でない行をパース対象にする |
| 90 | `9/20` + ZWSP（U+200B） + `19時 飲み会` | 飲み会 | 09-20 19:00 | 09-20 20:00 | null | null | ゼロ幅スペースは空白に変える（空文字にすると前後の数字がくっつき、日付・時刻のどちらとしても検出できなくなる） |
| 91 | `2027/1/3〜2026/12/30 合宿` | 2027/1/3〜2026/12/30 合宿 | null | null | null | null | D6: 終了年を明示した範囲が開始より前で矛盾するため `invalid_date`。範囲の内側の `2027/1/3` を単日としては拾わない。`no_datetime` |
| 92 | `9/15〜2026/9/16 合宿` | 9/15〜2026/9/16 合宿 | null | null | null | null | D6: 開始が D1 で翌年に繰り上がり、明示した終了年（2026）より後になって矛盾するため `invalid_date`。範囲の内側の `9/15` を単日としては拾わない。`no_datetime` |
| 93 | `9/20 19時 渋谷でしゃぶしゃぶ` | しゃぶしゃぶ | 09-20 19:00 | 09-20 20:00 | 渋谷 | null | L1: `しゃぶしゃぶ` の `し` は `した` ではないので区切りにする |

「明後日」は「あさって」、「本日」は「今日」の同義語として同じ規則で解決する。

### 5.7 API 側のバリデーションとエラーコード

パーサは issue を返すだけで拒否しない。作成・更新 API（§11.5）はプレビューの確定値を受け取り、次を検証する。検証の順序は **(1) Content-Type（415 `UNSUPPORTED_MEDIA_TYPE`）→ Origin（§9.8、403 `FORBIDDEN_ORIGIN`）→ (2) 本文の byte 上限（`MAX_BODY_BYTES` = 32KB。超過は `INVALID_REQUEST`）と JSON の形、および `rawText.length > MAX_INPUT_LENGTH`（`INPUT_TOO_LONG`）→ (3) レート制限（§9.3）→ (4) 下表の項目検証** とし、明らかに不正なリクエストでは D1 に触れない（レート制限カウンタも進まない）。

| コード | HTTP | 条件 | プレビューでの文言（クライアントは同じ `core/validate` を使って事前表示） |
|---|---|---|---|
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type` が `application/json` でない | （プレビューには出ない） |
| `FORBIDDEN_ORIGIN` | 403 | 同一オリジンでない（§9.8） | （同上） |
| `INVALID_REQUEST` | 400 | JSON が壊れている、必須項目が無い、`source` や通報の `reason` が列挙値に無い、型が違う | （同上。クライアントのバグ） |
| `EMPTY_INPUT` | 400 | `rawText.trim()` が空、または `title.trim()` が空 | 「予定を書いてください」 |
| `INPUT_TOO_LONG` | 400 | `rawText` > `MAX_INPUT_LENGTH`（2,000 文字）、`title` > 200、`location` > 200、`memo` > 2,000、通報の `comment` > 500。`rawText` の長さは (2) で先に弾くが、`validateEventFields`（(4)）でも同じ条件を検査し、クライアントのプレビューは `validateEventFields` 1 つで事前表示できるようにする | 「長すぎます（2,000 文字まで）」 |
| `INVALID_RANGE` | 400 | `start` と `end` の片方だけ null、`end <= start`、終日で JST 00:00 でない | 「終了は開始より後にしてください」 |
| `PAST_EVENT` | 400 | 作成: `end < now`。更新: **日時（`start` `end` `isAllDay`）を変更した場合のみ** `end < now` を検証し、日時不変の編集（メモの修正など）は終了後でも通す | 「過去の日時です」 |
| `BEYOND_MAX_LEAD_TIME` | 400 | `start` > `now + 13 ヶ月` | 「作成できるのは13ヶ月先までです」 |
| `TOO_MANY_URLS` | 400 | `title + location + memo` に含まれる URL（`URL_PATTERN`、§5.2）の総数 > `MAX_MEMO_URLS`（3） | 「リンクは3つまでです」 |
| `RATE_LIMITED` | 429 | §9.3 | 「しばらく時間をおいてから試してください」 |

`PAST_EVENT` を更新時に「日時を変更した場合のみ」にする理由: 保持期限は「終了 + 7 日」なので、イベント終了後もページは 7 日間生きている。その間のメモ修正まで拒否する理由は無い。`validateEventFields` は `mode: 'create' | 'update'` と更新時の `previous: EventFields` を受け取り、この分岐を純粋関数の中に閉じる（§11.5）。作成時の猶予（終了直後の記録用途）は設けない。設けるかどうかは §14.2 の未決事項に載せる。

日時が無い（`start = null`）作成は**拒否しない**。下書きとして「作成 + 7 日」で保存する。プレビューには「日時を認識できませんでした。タップして直せます（このままだと7日で消えます）」を出す。`past_date` / `beyond_max_lead_time` の issue があるときは「過去の日付のようです」「作成できるのは13ヶ月先までです」をプレビューに出し、日時項目は空で表示する。

検証を通った場合、`POST /api/pages` と `PATCH /api/pages/:id` はどちらも 200 で `CreatePageResponse` / `UpdatePageResponse`（§11.3）を返す（作成を示す 201 は使わない）。

### 5.8 プリフィルの優先順位

```typescript
// src/core/prefill/resolvePrefill.ts
export interface PrefillParams {
  text?: string       // タイトル
  dates?: string      // 開始/終了。ISO basic UTC（Google の render?action=TEMPLATE と同形式）。終日は YYYYMMDD/YYYYMMDD
  location?: string
  details?: string    // メモ
  q?: string          // 自然文。構造化パラメータに使える値が無いときだけ使う
}

export interface PrefillResult {
  rawText: string          // textarea の初期値（構造化パラメータに使える値があれば text を 1 行にしたもの、q のみなら q）
  fields: Partial<EventFields>
  manualKeys: (keyof EventFields)[]   // 構造化パラメータで来た項目は manual 扱いで固定する
}

export function resolvePrefill(params: PrefillParams, ctx: ParseContext): PrefillResult
```

| 入力 | 挙動 |
|---|---|
| `text` `dates` `location` `details` のいずれかに使える値がある（`q` も同時にあり） | 構造化パラメータを優先し `q` は無視する。来た項目を `manual` として固定 |
| `q` のみ、または構造化パラメータはあるが使える値が 1 つも残らない | `parseEventText(q, ctx)` の結果を `auto` として表示 |
| 何もなし | 空のトップ画面 |

値が空（trim 後空文字）のパラメータは「無い」ものとして扱う。`dates` が不正な形式（存在しない暦・時刻、終了が開始以前、同日終日の `YYYYMMDD/YYYYMMDD` など）なら無視する（`issues` には入れない）。`text` `dates` `location` `details` のうち使える値が 1 つも残らなければ、構造化パラメータが「来た」ことにはせず `q` にフォールバックする。`text` は 1 行のタイトル用パラメータなので、改行は空白に変換してから `title` / `rawText` に使う。プリフィルを踏んだだけでは公開しない。`/new?...` は常に作成画面を表示し、ユーザーが「URLを作る」を押すまで API は呼ばれない（concept §05）。

### 5.9 LLM フォールバックの境界（Phase 1 では未実装）

解釈が走る場所は**ブラウザのプレビューだけ**である（作成 API はプレビューの確定値を検証するだけで、サーバ側で解釈はしない。§2.3）。したがって LLM を差し込む境界もブラウザ側に置く。

```typescript
// src/core/interpret/types.ts
export interface TextInterpreter {
  interpret(input: string, ctx: ParseContext): Promise<ParsedEvent>
}

// src/core/interpret/ruleBasedInterpreter.ts — Phase 1 の唯一の実装
export const ruleBasedInterpreter: TextInterpreter = {
  interpret: async (input, ctx) => parseEventText(input, ctx),
}
```

- `web/create/preview.ts` は `parseEventText` を直接呼ばず、`TextInterpreter` 経由で呼ぶ。Phase 1 の実装は `ruleBasedInterpreter` で、通信は発生しない。
- Phase 2 では「`ruleBasedInterpreter` の結果の `issues` に `no_datetime` が含まれるときだけ `POST /api/interpret` を呼ぶ」合成実装（`fallbackInterpreter`）を足し、プレビュー側は差し替えるだけにする。
- `POST /api/interpret` は **Phase 1 では実装しない**（404 のまま）。パス（§4.1）とレート制限 scope `interpret`（§11.4 の `RateLimitScope` に型としてだけ予約）を今のうちに確保し、Phase 2 で新しい API を切るときに URL 設計とレート制限の設計をやり直さなくて済むようにする。
- サーバ側の `Deps` には `interpreter` を持たせない（Phase 1 で呼ぶ経路が無いため）。Phase 2 で `/api/interpret` を足すときに、そのルートの依存として加える。

---

## 6. 画面仕様

### 6.1 ① トップ（作成）

- 入力欄は自動リサイズの `<textarea>` 1 つ。フォームは出さない。説明文（使い方・FAQ）は入力欄の下に置く。トップページは `noindex` にしない（concept §09 の SEO / AdSense 対策）。
- `input` イベントで 150ms デバウンスし、`TextInterpreter`（§5.9。Phase 1 は `ruleBasedInterpreter`）をブラウザ内で実行してプレビューを更新する（通信なし）。
- プレビュー項目は **タイトル・日時・場所・メモ** の 4 つ。各項目は `auto` / `manual` の 2 状態を持つ。
  - タップすると編集 UI に切り替わり `manual` になる。以後、入力欄を編集してもその項目は上書きされない。
  - **`manual` で値を空にした項目は「この項目は使わない」として保持する**（場所・メモ・日時は `null`、タイトルは空のまま API 側の `EMPTY_INPUT` で止まる）。パーサの誤検出（例: `車で移動` → 場所 = 車）を「無し」にする操作がこれになる。
  - `auto` に戻す操作は、`manual` 中の項目の脇に出す小さな「自動に戻す」リンクに分ける。空にすることと自動に戻すことを 1 つの操作に兼ねると、誤検出した値を消せなくなるため。設定項目は増えないので原則 2 には反しない。
  - タイトル・場所・メモはテキスト入力（メモは複数行）。日時は「開始」「終了」の `datetime-local` と「終日」チェックボックス。終日にすると時刻入力を隠し日付だけにする。
  - 日時が `null`（下書き）のときは日時項目に「日時を認識できませんでした。タップして直せます」を出す。`issues` に応じた文言は §5.7。
- `singleTokenTitle` が true で場所が null、かつ日時が確定している（`start` が非 null）とき、タイトル項目の脇に「場所にする」リンクを出す。タップで場所 = そのタイトル、タイトル = 日時の整形文字列（§5.5 T-c）に入れ替え、両方 `manual` にする。日時未定の下書きでは日時の整形文字列が「日時未定」になってしまうためリンクを出さない。
- プリフィル（§5.8）は初期表示時にクエリ文字列から読む。構造化パラメータ由来の項目は `manual` で固定する（「自動に戻す」で `auto` に戻せる）。
- 「URLを作る」押下で `POST /api/pages`。body は `{ rawText, fields: EventFieldsJson, source }`。`source` はクライアントが決める: クエリに `ref=detail_cta` があれば `'detail_cta'`、プリフィルパラメータ（§5.8）のいずれかに使える値があれば `'prefill'`（空文字は数えない）、それ以外は `'direct'`（両方あれば `detail_cta` を優先）。これが concept §02「KPI の最上位」の転換率を測る唯一の手段になる（§9.6）。成功したら localStorage の履歴（§6.4）に追記し `/done?id={id}` へ遷移する。失敗（400/429）はエラーコードに対応する文言をボタン直下に出す。
- 二重送信防止のためボタンは送信中に無効化する。

### 6.2 ② 完成（`/done?id=:id`）

- 起動時にクエリの `id` を `isValidPageId`（§4.2）で検証する。不正なら `/` へ置き換え遷移する（`?id=//evil.example` のような open redirect を防ぐ）。有効なら localStorage の履歴から `id` を探し、無ければ `/{id}` へ置き換え遷移（直リンクや別端末で開いた場合）。遷移先は `new URL(path, location.origin)` で組み、`origin` が一致することを確認してから `location.replace` する。
- 主役は URL 表示とコピーボタン。コピーは `navigator.clipboard.writeText` を第一候補に、失敗したら非表示 `<textarea>` + `document.execCommand('copy')` にフォールバックする（LINE 内蔵ブラウザ等で clipboard API が制限される環境の対策）。成功時は「コピーしました」を 2 秒表示。両方失敗した場合は「コピーできませんでした。URLを長押しして選択してください」を表示する。
- 「LINEで送る」: `https://line.me/R/share?text={encodeURIComponent(url)}` を新規タブで開く。
- 「共有」: `navigator.share` が使える環境だけ表示（フィーチャー検出。無い環境はボタンごと出さない）。`{ title, url }` を渡す。
- 「自分のカレンダーにも入れる」: Google カレンダーリンク（§7.1）と ics リンク（`/{id}.ics`）の 2 つ。Google リンクは履歴項目の `fields`（§6.4）から `buildGoogleCalendarUrl` で組む（サーバに問い合わせない）。日時が null の下書きでは出さない。
- 期限表示「M/D まで表示されます」（`expiresAt` を JST で整形）。
- 「あとから編集できます」→ `/{id}/edit`。
- 「変更を伝えたいときは同じ URL を送り直してください」は**編集完了後の再掲時だけ**表示する（履歴項目の `version > 1` で判定。§8）。初回作成時には出さない（まだ変更していない段階で変更の注意を出すのは過剰）。`updatedAt ≠ createdAt` では判定しない。`E2E_FIXED_NOW`（固定時計）の下では作成と更新の `now()` が同一になり `updatedAt` が進まないため。
- 広告枠は Phase 1 では実装しない。
- 表示に使う `url` は `https://{PUBLIC_ORIGIN}/{id}`（API レスポンスの `url` をそのまま使う）。

### 6.3 ③ 詳細ページ（`/:id`）の要素順序

1. タイトル（`h1`）
2. 発行者スロット（`issuer_name` が非 null のときだけ「◯◯ 主催」。Phase 1 は常に非表示）
3. **変更バナー**（`changed_at` から 48 時間以内のみ。§8）。日時が変わった場合は「この予定は変更されました 日時: 9/20(日) 19:00 → 9/21(月) 20:00」。タイトル・場所が変わった場合は「タイトルが変更されました」「場所が変更されました」と事実だけ示し、**旧値は出さない**（§3.5）
4. 日時（終日は「9月20日(日)」のみ。時刻ありは「9月20日(日) 19:00〜21:00」。既定の終了も同じ形（「19:00〜20:00」）。複数日は「9月20日(日)〜9月21日(月)」。下書きは「日時未定」）
5. 場所（あれば）。直下に「地図で見る ↗」（`https://www.google.com/maps/search/?api=1&query={encodeURIComponent(location)}`。固定パターンの自前リンクであり、ユーザー入力を URL 化するものではない）
6. カレンダー追加ボタン 2 個（「Googleカレンダー」「その他（ics）」）。日時が null のときは非表示にし「日時が決まったら追加できます」を出す。`version > 1`（編集済み）のときだけ直下に「カレンダーに追加した後の変更は自動では反映されません。最新はこのページで確認してください」を出す（未編集のページでは 11 のフッターにだけ置く。§8）。`updated_at ≠ created_at` では判定しない（`E2E_FIXED_NOW` の下では作成・更新の `now()` が同一になり `updated_at` が進まないため）
7. メモ（改行のみ `<br>` に変換。URL があっても自動リンクしない。§9.2）
8. 区切り
9. 「あなたも予定URLを作れます」+「作ってみる」CTA（`href="/new?ref=detail_cta"`。広告より上。`ref` は作成画面が `source = 'detail_cta'` に変換して作成 API に送る。§6.1）
10. 広告枠（Phase 1 は DOM に何も出さない。テンプレートにコメントのみ）
11. 期限表示「このページは M/D まで表示されます」。`M/D` は `expires_at` の 1ms 前が属する JST 暦日（`expires_at` は JST 0 時ちょうどのことがあり、そのまま暦日に変換すると実際に見えなくなる日を指してしまうため）。`version > 1` なら続けて「最終更新: M/D HH:mm」（`formatDateLabel` と同じ 0 埋め）。その下に小さく「カレンダーに追加した後の変更は自動では反映されません」（免責の常設位置はここ）
12. 「不適切なページを報告」リンク（`/{id}/report`。小さくフッター相当）

`<head>`: `<meta name="robots" content="noindex, nofollow">`、`og:title`（タイトル）、`og:description`（日時 + 場所の 1 行）、`og:image`（`https://{PUBLIC_ORIGIN}/{id}/ogp.png?v={version}`。version を含めるのは SNS 側の画像キャッシュを編集後に更新させるため、§2.4）、`og:url`、`twitter:card=summary_large_image`。絶対 URL は必ず `config.publicOrigin` から組み立て、`request.url` や `Host` ヘッダは使わない（§9.9）。

`status = 'hidden'` のページは 404 と同じ「このページは表示できません」を返す（存在を区別させない）。期限切れで GC 前のページも同様に 404 扱い（`isServable`、§4.1）。

### 6.4 ④ 履歴（`/history`）

- ヘッダの小さな「作ったURL」リンクから開く。
- localStorage のキー `calshare.history` に `HistoryEntry[]` を新しい順に保存する。

```typescript
// src/web/lib/history.ts
export interface HistoryEntry {
  id: string
  url: string
  editToken: string
  fields: EventFieldsJson    // 完成画面の Google カレンダーリンク（§6.2）を組むのに end / location / memo が要る
  expiresAt: string          // ISO8601 UTC
  createdAt: string
  updatedAt: string
  version: number            // 完成画面の「送り直してください」の判定に使う（version > 1。§6.2）
}
```

- 一覧は `fields.title`・日時（`fields.start` `fields.end` `fields.isAllDay` から `formatDateLabel`）・詳細ページへのリンク・編集リンク（`/{id}/edit`）。作成時点のスナップショットであり、その後の編集や期限延長は反映されない（サーバに問い合わせないトレードオフ）。編集完了時（§6.5）には該当項目の `fields` `expiresAt` `updatedAt` `version` を上書きする。
- 一覧の編集リンクと詳細リンクは `isValidPageId` を通した `id` だけから組む（localStorage の内容も信頼しない）。
- 期限切れの項目はグレー表示し、「期限切れ」と出す。
- 端末を変えると空になる。Phase 1 では「ログインしますか」は出さない。

### 6.5 編集画面（`/:id/edit`）

- 起動時に `location.pathname` から `id` を取り `isValidPageId` で検証する（不正なら `/` へ）。localStorage の履歴から `id` の `editToken` を探す。無ければ「この端末では編集できません。作成した端末で開いてください」を表示して終了。
- `GET /api/pages/:id`（`Authorization: Bearer`）で現在値（`GetPageResponse`、§11.3）を取得し、①と同じプレビュー UI に `manual` として埋める。textarea には `rawText` を入れる。
- 保存で `PATCH /api/pages/:id`（body は `{ rawText, fields }`。楽観ロックは持たず「最後の保存が勝つ」）。成功したら履歴を更新し `/done?id={id}` へ遷移（②を再掲して「同じ URL を送り直す」行動を促す）。
- フォーム直下に「保存しても、すでにカレンダーに追加した人には自動で伝わりません。変更後は同じ URL を送り直してください」を常設（編集画面は変更の意思がある人だけが開くので、ここでは常設でよい）。
- 日時を変えずにメモだけ直す編集は、イベント終了後でも通る（§5.7 `PAST_EVENT` の更新時の条件）。日時を消して下書きに戻した場合の保持期限は `now + 7 日`（§3.2）。
- 401 は「編集トークンが無効です」、404 は「ページが見つかりません（期限切れの可能性）」。

> 採らなかった案: `expectedVersion` による楽観ロック（409）。編集トークンは端末ローカルで別端末からは編集できない（§3.3）ので、競合は同一端末の 2 タブ同時保存に限られる。concept に対応する要求は無く、API・クライアント・テストの 3 箇所に分岐が増えるだけなので持たない。

### 6.6 LINE 内蔵ブラウザ向けの扱い

- UA に `Line/` を含むとき、詳細ページ・完成画面の **Google カレンダーボタンと ics ボタンの `href` に `openExternalBrowser=1` パラメータ**を付ける。付け方は `URL` オブジェクトの `searchParams.set('openExternalBrowser', '1')` に統一する（Google カレンダーの URL は既に `?action=TEMPLATE&...` を持つので、`?` の文字列連結だとパラメータが壊れる）。
- このパラメータは LINE の公式ドキュメントに「LINE から開く URL」への挙動として記載されているもので、LINE 内蔵ブラウザで表示中のページ内のリンクにも効くかは**バージョン依存で要検証**。保険としてバナーも出し、実機（iOS / Android の LINE）での確認を H14 に含める。
- 同時に「うまく開けないときは右上メニューの『他のアプリで開く』を使ってください」の案内バナーを表示する。
- UA 判定と `href` の書き換え・バナー表示は**クライアント側の JS**で行う。Cache API のキーは URL のみで、SSR の出力を UA 別に分けない（分けるとキャッシュが効かなくなる）。
- LINE 判定（本節）と Android 判定（§7.3）は独立に行う。Android 版 LINE の UA は両方に該当し、`openExternalBrowser=1` で外部ブラウザ（Android Chrome）に渡った後も ics はダウンロードになるため、案内バナーと ics の注記を両方表示する。
- 「LINEで送る」が渡すテキストの URL 自体に `?openExternalBrowser=1` を付けて、詳細ページごと外部ブラウザで開かせる案は §14.2 の未決事項に載せる（拡散しても無害なパラメータだが、共有 URL の見た目が長くなる）。

---

## 7. カレンダー連携

### 7.1 Google カレンダー追加リンク

```typescript
// src/core/google/buildGoogleCalendarUrl.ts
export interface CalendarEventInput {
  title: string
  location: string | null
  memo: string | null
  start: Date            // 非 null（下書きはボタン自体を出さない）
  end: Date
  isAllDay: boolean
  detailUrl: string      // 詳細ページの絶対 URL
}

export function buildGoogleCalendarUrl(event: CalendarEventInput): string {
  const dates = event.isAllDay
    ? `${formatBasicDateJst(event.start)}/${formatBasicDateJst(event.end)}`   // YYYYMMDD/YYYYMMDD（終了は排他的翌日）
    : `${formatBasicUtc(event.start)}/${formatBasicUtc(event.end)}`         // YYYYMMDDTHHMMSSZ/...
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates, ctz: 'Asia/Tokyo' })
  if (event.location) params.set('location', event.location)
  params.set('details', buildCalendarDetails(event.memo, event.detailUrl))   // メモ + 「詳細: {detailUrl}」
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
```

- `ctz=Asia/Tokyo` は、受け手の Google 側タイムゾーン設定が日本以外でも表示が崩れないための保険。
- `details` にはメモを入れ、末尾に詳細ページ URL を 1 行足す。メモは `MAX_CALENDAR_DETAILS_LENGTH = 500` 文字で切り詰め（末尾に「…」）、詳細ページ URL は切り詰めの対象にしない。メモ全文（最大 2,000 文字）をそのまま載せると URL が日本語のパーセントエンコードで 15KB を超え、Google 側や LINE 内蔵ブラウザで扱えない長さになるため。Google リンクは受け手が自分でクリックする経路なので、ics のような URL 除去はしない（URL 本数は作成時に `MAX_MEMO_URLS` で制限済み。除去に揃えるかは §14.2）。
- `URLSearchParams` は `/` を `%2F` にエンコードするので、`href` 上の `dates` は `20260920T100000Z%2F20260920T110000Z` になる（Google は `%2F` を受け付ける）。テストは文字列一致ではなく URL をパースしてパラメータ値で比較する。
- `detailUrl` は `config.publicOrigin` から組む（§9.9）。

### 7.2 ics の内容

```typescript
// src/core/ics/buildIcs.ts
export interface IcsInput {
  uid: string             // `${eventId}@${config.publicHost}`（`Deps.config.publicHost`、§11.5）
  title: string
  location: string | null
  memo: string | null
  start: Date
  end: Date
  isAllDay: boolean
  sequence: number        // pages.version - 1
  generatedAt: Date       // DTSTAMP
  detailUrl: string
}
export function buildIcs(input: IcsInput): string
/**
 * `\r\n` を `\n` に正規化し制御文字を除去した上で、URL（`core/text/urlPattern.ts` の
 * `WIDE_URL_PATTERN`、§5.2）を「[リンク]」に置換する。
 * 制御文字の除去を URL 判定より先に行わないと、URL の途中に制御文字を挟むことで判定をすり抜けられる。
 * SUMMARY / LOCATION / DESCRIPTION の 3 つに同じ関数を通す。
 */
export function sanitizeIcsText(text: string): string
/**
 * RFC 5545 の TEXT エスケープ。`\r\n` を `\n` に正規化し、残った `\r` と U+0000–U+001F（`\n` `\t` 以外）・
 * U+007F・U+0085（NEL）・U+2028（LINE SEPARATOR）・U+2029（PARAGRAPH SEPARATOR）を除去した上で
 * `\` `;` `,` `\n` をエスケープする。lone `\r` や NEL 等を行区切りとして扱う寛容なパーサへのプロパティ注入を防ぐ
 */
export function escapeIcsText(text: string): string
/**
 * 75 オクテット折り返し。継続行は先頭の半角スペース 1 個を含めて 75 オクテットで数える。
 * マルチバイト文字の途中で切らない
 */
export function foldIcsLine(line: string): string
```

| 項目 | 方針 |
|---|---|
| `VERSION` / `PRODID` / `CALSCALE` / `METHOD` | `2.0` / `-//calshare//calshare//JA`（FPI 形式 `-//owner//product//language`）/ `GREGORIAN` / `PUBLISH` |
| `UID` | `${eventId}@${config.publicHost}`（`publicHost` は `buildDeps` が `new URL(publicOrigin).host` から導出する。§11.5）。編集してもイベント ID は変わらないため同一 |
| `DTSTAMP` | ics 生成時刻（UTC、`Z` 表記）。編集のたびに再生成されるので更新される |
| `DTSTART` / `DTEND` | `TZID` を使わず UTC（`Z`）表記。日本には DST が無いので固定オフセット減算だけで正しく、`VTIMEZONE` を組まない |
| 終日 | `DTSTART;VALUE=DATE:20260920` / `DTEND;VALUE=DATE:20260921`（排他的翌日） |
| `SUMMARY` / `LOCATION` / `DESCRIPTION` | いずれも `sanitizeIcsText`（内部で制御文字除去 → URL 置換の順に行う）→ `escapeIcsText` → `foldIcsLine` の順に通す。URL は「[リンク]」に置換する（削除だと文脈が壊れる）。DESCRIPTION は、メモを `sanitizeIcsText` に通した**後**に「詳細はこちら: {detailUrl}」の行を連結し、その後で `escapeIcsText` → `foldIcsLine` に通す（連結してから sanitize すると自ドメインの URL も「[リンク]」になる）。**ics 上の外部リンクは常に 0 本**、自ドメインのみ 1 本 |
| `URL` | `detailUrl` |
| `SEQUENCE` | `version - 1`（作成時 0）。編集のたびに +1（§8） |
| `STATUS` | `CONFIRMED` |
| 生成しないプロパティ | `ORGANIZER` `ATTENDEE` `ATTACH` `X-ALT-DESC`（HTML 本文や添付を持ち込む経路。`METHOD:PUBLISH` とも整合）。`buildIcs` の出力にこれらが含まれないことをテストで固定する |
| 改行 | `\r\n`。継続行の先頭は半角スペース 1 個 |

配信ヘッダ（`GET /:id.ics`）: `Content-Type: text/calendar; charset=utf-8`、`X-Robots-Tag: noindex`、`Cache-Control: public, max-age=60`。`Content-Disposition` は付けない（iOS Safari で `attachment` にするとダウンロードマネージャに落ちて取り込みプレビューが出ないことがある）。`status = 'hidden'` または期限切れのページは 404（§4.1）。

> URL を SUMMARY / LOCATION にも適用する理由: カレンダースパムは相手のカレンダーアプリが URL を自動リンク化する経路が本丸で、Google カレンダーは location 欄、Apple カレンダーはタイトル・場所の URL も検出する。DESCRIPTION だけを除去してもスパマーは URL をタイトルか場所に置くだけで済む（concept §09）。「URL は 3 本まで」の作成時制限と組み合わせて、ics の外部リンクを 0 本にする。

### 7.3 プラットフォーム別の挙動と回避策

| 環境 | 課題 | 回避策 |
|---|---|---|
| iOS Safari / macOS | 概ね問題なし。https の `text/calendar` を開くと取り込みプレビュー（「すべて追加」）が出る。concept §06 の「照会するカレンダー」は webcal 購読時（Phase 2）の UI | `Content-Disposition` を付けない以外は特別対応なし |
| Android Chrome | ics が単にダウンロードされ、手動で開く必要がある | Google カレンダーボタンを常に先頭・大きめに置く（Android の大半はこちらで完結）。UA が Android のとき ics ボタン直下に「ダウンロード後、通知をタップして開いてください」を出す（クライアント JS） |
| Google カレンダーモバイルアプリ | 購読 UI が無い（Phase 2 領域） | Phase 1 は Google カレンダーボタンで十分 |
| LINE 内蔵ブラウザ | ics のハンドリングが不安定 | §6.6。`openExternalBrowser=1` パラメータ（`searchParams.set` で付与）+ 「他のアプリで開く」案内。ics ボタンは JS の Blob ではなく素の `<a href="/:id.ics">` にする |

---

## 8. 「作成者が予定を変更したとき」の方針（この設計で決定）

Phase 1 は購読を持たないため、**変更は取り込み済みの相手に自動では伝わらない**。これを前提に「伝わらないことを隠さず、詳細ページを正にする」方針を採り、次の 5 点を実装する。

1. **詳細ページに免責を置く**: フッター（期限表示の下、§6.3 の 11）に「カレンダーに追加した後の変更は自動では反映されません」を常設し、`version > 1`（編集済み）のページではカレンダーボタン直下（§6.3 の 6）にも昇格させる。concept §10 が求める「詳細ページに明示」はこれで満たす。未編集のページの主要部分には出さない（concept §03 の「スクリーンショットして LINE に貼れる見やすさ」を損なわないため）。
2. **変更バナーで差分を見せる**: タイトル・日時・場所のいずれかを編集したとき、変更前の**日時**を `previous_snapshot` に保存し、`changed_at` から `CHANGE_BANNER_HOURS = 48` 時間は「この予定は変更されました 日時: … → …」を日時の上（§6.3 の 3）に出す。タイトル・場所は「変更されました」の事実だけを示し旧値は出さない（§3.5 の理由）。再訪した受け手が何が変わったか一目で分かる手段で、コストはカラム 2 本とテンプレート 1 箇所。メモだけの変更ではバナーを出さない。
3. **「最終更新」を常時表示する**: `version > 1` なら期限表示の横に「最終更新: M/D HH:mm」（§6.3 の 11）。48 時間を過ぎた後もこれは残る。
4. **同じ URL を送り直す動線**: 編集完了後の完成画面（②の再掲）に「変更を伝えたいときは同じ URL を送り直してください」。初回作成時には出さない。URL は編集しても変わらない。
5. **ics の UID を固定し SEQUENCE を増分する**: 相手が同じ ics を再取得した場合に限り、多くのクライアント（Apple Calendar 等）は更新として扱う。Google カレンダーの手動取り込みは重複することがあるので「効けば儲けもの」の副次策として扱い、UI 文言で自動通知のように誇張しない。

> 採らなかった案: 変更履歴の一覧（差分ログ）。原則 2 に照らして 48 時間のバナー 1 つに留める。メール・Web Push は送り先を持てない（認証が無い）ので Phase 2 以降（concept §06 の Android 対策と合わせて検討）。

OGP 画像は `og:image` の URL に `?v={version}` を含める（§6.3）ので、LINE・X・Slack のように画像 URL 単位でキャッシュするプラットフォームでは編集後にカードの画像が更新される。ただし**ページ URL 自体に紐づくカード（タイトル・説明文）は、その URL が再共有されるまで更新されない**ことがある。これはプラットフォーム側の挙動で制御できない既知の限界として §14 に記す。

---

## 9. セキュリティ・スパム対策・プライバシー

### 9.1 XSS

- SSR は `hono/jsx` の自動エスケープに全面的に依存する。`dangerouslySetInnerHTML` 相当の生 HTML 挿入はコードベース全体で禁止し、ESLint の `no-restricted-syntax` で機械的に検出する。
- メモの改行は「文字列を `\n` で分割し、各要素の間に `<br>` 要素を挟む」JSX で表現する。HTML 文字列の組み立ては一切行わない。
- クライアント側の描画（①②④・編集画面）は `textContent` / `createElement` のみを使い `innerHTML` に文字列を入れない（ESLint で禁止）。
- OGP 画像の入力はテキストノードとしてのみ扱い、文字列連結で SVG / CSS を組まない（§2.5）。
- レスポンスヘッダ（Worker の全ルートは `server/lib/headers.ts` の定数を `server/middleware/securityHeaders.ts` の `securityHeaders()` ミドルウェアで付与、静的ページは `_headers` ファイル。§2.2）:
  - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`
  - `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`
  - `applySecurityHeaders` 自体は `app.use()` の中から呼ぶ Hono ミドルウェア（`server/middleware/securityHeaders.ts` の `securityHeaders()`）にし、`app.ts` の先頭に `app.use('*', securityHeaders())` を 1 行足して全ルートに適用する。`next()` の後に `c.res = new Response(c.res.body, c.res)` で包み直せば、Cache API から返るレスポンス（ヘッダが不変）にも付け直せる。これにより `POST /api/pages` 等の `/api/*` にも本節のヘッダが付く。`X-Robots-Tag` も含めて全ルートに一律で付ける（`/api/*` に付いても実害は無く、ルートごとに出し分ける分岐を持つ方がコストが高い）。
  - インラインスタイルは使わず、ビルド時に `/assets/*.css` へ出す（`'unsafe-inline'` を外すため）。`base-uri 'none'` は万一 HTML 注入があっても `<base href>` で `/assets/*.js` を外部に向けられないようにする。
  - CSP 文字列は `src/server/lib/headers.ts` の 1 定数にする（T8）。静的ページ用の `src/web/_headers` は**手書きの静的ファイル**（T1、内容は §11.7）で、ビルド時に TS 定数から生成しない（`.mjs` のビルドスクリプトから TS の定数を読むには一度バンドルするか JSON に逃がす必要があり、足場が複雑になる）。二重管理のずれは `test/unit/server/lib/headers.test.ts`（T8）で「`_headers` に書かれた各ヘッダの値と `headers.ts` の定数が一致する」ことを検査して CI で検出する。T1 の時点では `headers.ts` が無いので、`test/unit/web/headers.test.ts` で `_headers` の形式（§11.7 の各ヘッダが載っている）だけを検査する。

### 9.2 URL の扱い

- 詳細ページのメモ内で URL らしき文字列を自動リンク化しない。リンク化ライブラリも導入しない。
- URL の判定は `src/core/text/urlPattern.ts` に集約する（§5.2）。パーサの URL 分離・`countUrls` は抽出用の `URL_PATTERN` を、ics のサニタイズはサニタイズ専用の `WIDE_URL_PATTERN` を参照する。通常の ASCII URL では両者の本数は一致するが、`WIDE_URL_PATTERN` は IDN・記号カテゴリホスト・obfuscated scheme 等も拾う分だけ広いため、「作成時に数えた本数」より「ics で置換される本数」が多くなることがある（§5.2 の非対称性、Issue #19）。この非対称性が「作成時に数えた URL は ics から必ず消える」という向きでしか成立しないことは `test/unit/core/text/urlPattern.test.ts` で固定している。
- 作成・更新時に `title + location + memo` に含まれる URL の総数が `MAX_MEMO_URLS = 3` を超えたら `TOO_MANY_URLS`（400）。`raw_text` は数えない（1 行目の URL はメモへ移されるので二重に数えない）。「地図 URL + 申込フォーム URL」は正当な用途として通す。
- ics の SUMMARY / LOCATION / DESCRIPTION では URL を「[リンク]」に置換する（§7.2）。
- 「地図で見る」は場所文字列を `encodeURIComponent` した固定パターンの Google マップ検索 URL で、ユーザー入力を URL として解釈しない。

### 9.3 レート制限

**IP と device を独立したバケットで数え、いずれかが超過したら 429（OR 判定）**。

| scope | バケット | 窓 | 上限（初期値） |
|---|---|---|---|
| `create` | `ip:{ip_hash}` | 1 時間 | 30 |
| `create` | `ip:{ip_hash}` | 1 日 | 100 |
| `create` | `device:{device_id}` | 1 日 | 20 |
| `report` | `ip:{ip_hash}` | 1 時間 | 10 |
| `report` | `ip:{ip_hash}` | 1 日 | 30 |

- **閾値の根拠**: 日本の携帯回線（docomo・au・SoftBank）は CGNAT で多数のユーザーが同一 IPv4 を共有する。主要導線が LINE（モバイル）なので、IP 側を厳しくするとイベント当日の集団利用で正規ユーザーが 429 を踏む。**device バケットを主、IP バケットは緩めの二次防御**にする。リリース後に 429 のログ（`exceeded` のバケット種別、§9.6）で IP 側に弾かれた比率を見て調整する（§14.2）。
- `ip_hash` の算出（`server/lib/ipHash.ts`）: `HMAC-SHA256(RATE_LIMIT_PEPPER, 正規化した IP)` の hex 先頭 32 文字。**IPv6 は /64 プレフィックスに丸めてから**ハッシュする（`IPV6_BUCKET_PREFIX_BITS = 64`、`limits.ts`）。IPv4 はそのまま。IPv4-mapped IPv6（`::ffff:1.2.3.4`）は IPv4 として扱う。丸める理由: 家庭回線でも /64 が割り当てられ、プライバシー拡張やVPS で下位 64 bit を 1 リクエストごとに変えられるため、アドレス単位では IP バケットが無限に新規になる。生 IP は保存もログもしない。
- `CF-Connecting-IP` が無いとき（`wrangler dev`・CI）は `ip:unknown` の単一バケットにフォールバックし、本番（`PUBLIC_ORIGIN` が `localhost` でない）で無い場合は warn ログを出す。
- `device_id` は `cs_device` Cookie（`HttpOnly; Secure; SameSite=Lax; Max-Age=34560000`（400 日）; Path=/）。値は **`crypto.randomUUID()` が返す UUID 文字列**（`server/lib/deviceCookie.ts` の `readDeviceId` はこの形式以外を null にして再発行させる）。①は静的アセットなので Cookie はサーバから発行できない。**`POST /api/pages` が Cookie 無しで来たら発行し、その ID をそのリクエストのバケットに使う**。Cookie 削除で device バケットは新しくなるが、IP バケットは独立して効くので回避にならない。
- 実装は D1 `rate_limit_counters` への固定窓カウンタ。窓の開始は時間窓なら時、日窓なら日（UTC）で切り捨てる。**`consume` はまず SELECT で各ルールの現在値を読み、1 つでも上限以上なら書かずに `allowed = false` を返す。全て未満のときだけ `INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` を `db.batch()` で行う。** 超過後もリクエストごとに 3 行書くと、429 の連打が D1 の書き込み枠を消費する増幅攻撃になる（§4.3 と同じ構図）ため。読み取りは 250 億行/月の枠で余裕がある。SELECT と書き込みの間は非アトミックなので、同時に来た複数リクエストが全員 SELECT を通過してから書くことがありうる。**書き込みは `RETURNING` で更新後の値を受け取り、上限を超えていれば `allowed = false` にする**（書き込み自体は取り消さない）。これにより超過幅は同時実行数で頭打ちになる。
- レート制限は Content-Type / Origin 検査と JSON の形式検証の後に置く（§5.7 の順序）。
- 通報は同一 `ip_hash` から同一ページへ 24 時間に 1 件しか `reports` に入れない（重複は 200 を返して無視。カウントも増やさない）。
- 404 大量アクセスへの D1 ベースの検知は実装しない（§4.3）。運用側の保険として Cloudflare WAF のレート制限ルール（`/api/*` へのエッジ側制限）を H13 に置く。

> 採らなかった案 1: `ip_hash:device_id` を連結した 1 本のキー（当初案）。Cookie を削除するたびに新しいバケットになり、IP 単位の制限として機能しない。concept §09 の「IP＋デバイス単位」は両方で独立に制限する意味に読む。
>
> 採らなかった案 2: Workers の Rate Limiting バインディング。無料でエッジ内に閉じるが、カウンタが colo 単位で共有されないため日次上限に使えない。時間窓の一次防御として D1 の前段に足す余地はあるので、D1 の書き込みが問題になったら再検討する。

### 9.4 通報導線

- 詳細ページ最下部の「不適切なページを報告」→ `/:id/report`（SSR のフォーム。理由の選択肢: スパム / 個人情報 / 不快な内容 / その他、任意の自由記述 500 文字まで）→ `web/report/main.ts` が `POST /api/pages/:id/reports` へ **JSON で送信**する（素の HTML form の POST は使わない。§9.8）。JS が無効な環境では送信できないが、通報導線はスパム対策であり主要動線ではないので許容する。
- API は `reason` を列挙値（`spam` / `personal_info` / `inappropriate` / `other`）で検証し、`comment` は 500 文字超を 400 にする（§5.7）。hidden / 期限切れのページへの通報は 404。
- 受理したら `ReportRepository.insertIfNotDuplicate`（§11.4）で `reports` に 1 行追加し（同一 `ip_hash`・同一ページの 24 時間以内の重複は `'duplicate'` が返り、何もせず 200。§9.3）、`report_count` を +1、Discord / Slack Webhook へ即時通知。Webhook 失敗は通報自体を失敗させない（`ctx.waitUntil` で送る）。応答が無い送信先で専有し続けないよう `WEBHOOK_FETCH_TIMEOUT_MS` でタイムアウトさせる。
- **Webhook の種別**は `REPORT_WEBHOOK_URL` のホストで判定する（vars は増やさない）: `discord.com` / `discordapp.com` → Discord、`hooks.slack.com` → Slack。どちらでもないホストは `webhookNotifier` が warn ログを出して送らない（通報の受理は成功する）。`REPORT_WEBHOOK_URL` が未設定（ローカル・CI）のときは `buildDeps` が `fakeNotifier` を配線する（§11.5）。
- **通知本文の扱い**（`webhookNotifier`）: 通報者は匿名なので、通知はそのまま「運用者 1 人に任意のリンクを踏ませるチャネル」になりうる。次を仕様にする。
  - 本文に載せる URL は `config.publicOrigin` から組んだ詳細ページ URL の 1 本だけ。コメント内の URL は「[リンク]」に置換（`URL_PATTERN`）した上で `MAX_WEBHOOK_COMMENT_LENGTH = 200` 文字で切り詰める（全文は D1 の `reports` で見る）。
  - Discord: `allowed_mentions: { parse: [] }` を必ず付け、コメントはコードブロック（```）で囲んで自動リンクと Markdown を無効化する。
  - Slack: `&` `<` `>` をエスケープしてから `mrkdwn: false` の text に入れる。
  - 本文に含める情報: ページ URL・理由・累計件数・**同一送信元（`creator_ip_hash` または `creator_device_id` が同じ）の有効ページ数**（`PageRepository.countActiveByCreator`）。`report_count >= 3` を強調する。
- **自動非表示のしきい値は設けない**（結託した虚偽通報で正当ページを落とせるため）。運用者が通知を見て、Cloudflare ダッシュボードの D1 コンソールから非表示にする。スパム波に対しては通報ページと同じ送信元を一括で非表示にする。

  ```sql
  -- 通報されたページ :id と同じ送信元の有効ページを一括で非表示にする（H11 の運用手順）
  UPDATE pages SET status = 'hidden'
  WHERE status = 'active'
    AND (creator_ip_hash = (SELECT creator_ip_hash FROM pages WHERE id = :id)
      OR creator_device_id = (SELECT creator_device_id FROM pages WHERE id = :id));
  ```

- `hidden` にした後も Cache API に最大 60 秒残る（§2.4）。

### 9.5 noindex と robots.txt

- `/:id` `/:id/edit` `/:id/report` `/done` `/history` `/edit` に `<meta name="robots" content="noindex, nofollow">` を出す。`/:id` `/:id.ics` `/:id/ogp.png` `/:id/edit` `/:id/report` のレスポンスヘッダに `X-Robots-Tag: noindex, nofollow` を付ける（Worker 経由なのでアプリから付けられる）。静的ページ `/done` `/history` `/edit` の `X-Robots-Tag` は `_headers` ファイルで付ける（§2.2）。
- **トップページ（`/` `/new`）は noindex にしない**（concept §09 の SEO / AdSense 対策）。
- `robots.txt` は `User-agent: *` / `Allow: /` のみ。**詳細ページのパスを Disallow しない**。Disallow すると LINE / X / Slack の OGP クローラも遮られ、認知獲得の主経路が死ぬ。
- 静的アセットの `<meta>` はビルド時に HTML に埋め込む。

### 9.6 ログに残すもの／残さないもの

| 残す | 残さない |
|---|---|
| ルート名（パスパターン）・メソッド・ステータス・所要時間 | 生の IP アドレス（`ip_hash` のみ。日次で pepper を回す必要はない：HMAC の鍵はシークレット） |
| ページ ID（公開済みの推測不能文字列） | 編集トークン（生・ハッシュとも一切出さない） |
| パース結果の分類（`issues`）と入力文字数 | `raw_text` `title` `memo` `location` の内容 |
| 作成の流入元 `source`（`direct` / `detail_cta` / `prefill`。`pages.source` にも保存） | クエリ文字列全体（パスのみ記録。`ref` は `source` に変換してから残す） |
| 429 のときの `exceeded` のバケット種別（`ip` / `device`）と窓 | |
| エラーの `name` と `message`（200 文字で切り詰め） | 例外オブジェクトそのもの（satori 等の例外メッセージにはレイアウト対象の文字列が混ざる）。スタックトレースも同様に残さない：`consoleLogger` は level によらず `{ name, message }` にしか正規化しない（T1、下記） |
| 大まかな UA 分類（LINE / iOS / Android / その他） | UA 文字列そのもの |
| GC の処理件数・所要時間 | |

ログは `console.log(JSON.stringify({...}))` の構造化ログにする。`Logger` ポートの実装は `adapters/logger/consoleLogger.ts`（T1）の 1 つで、`Deps.logger` にはこれを配線する。`consoleLogger` は `error` フィールドに `Error` インスタンスを受け取ったら `{ name, message }`（message は 200 文字で切り詰め）に正規化し、それ以外の値は捨てる。呼び出し側が例外を渡しても入力内容がログに混ざらないようにするため。`src/server/lib/logger.ts`（T18）はポートの実装ではなく、リクエスト単位の文脈（ルート名・メソッド・ステータス・所要時間・pageId）を `Logger` に載せる薄いヘルパで、`middleware/requestLog.ts` から使う。Cloudflare のエッジが取得するプラットフォームレベルのログは Cloudflare 側の基盤機能であり、ここでの方針は「アプリケーションが自ら生成するログ」に限る。ルートが catch していない例外は Hono の既定の errorHandler が `console.error(err)` で生の Error（スタックトレース込み）を出してしまうため、`app.ts` に `app.onError` を登録して `logUnhandledError`（`src/server/lib/logger.ts`）経由の構造化ログに一本化する（T18）。

**転換率の集計**: concept §02 が KPI の最上位に置く「詳細ページ → 自分も作る」は、`pages.source` の集計（`SELECT source, COUNT(*) FROM pages GROUP BY source`。GC で消えるので日次で控える）と、リクエストログのルート名（Hono の `routePath()` がそのまま返す、ID の Crockford パターンを含んだ `` /:id{[0-9a-hjkmnp-tv-z]{12}} ``）の件数から「詳細 PV」「作成数」「CTA 経由作成数」の 3 つを出せる。個人情報は増えない。`creator_ip_hash` / `creator_device_id` はレート制限と同じ扱い（pepper 付き HMAC、ページと一緒に GC）でログには出さない。

### 9.7 シークレット

`RATE_LIMIT_PEPPER`（HMAC 鍵）、`REPORT_WEBHOOK_URL`、`CLOUDFLARE_API_TOKEN`（CI 用）は `wrangler secret put` / GitHub Secrets で登録し、コードにもリポジトリにも書かない。ローカルは `.dev.vars`（T1 で `.gitignore` に入れる。雛形は `.dev.vars.example`、§11.7）。

### 9.8 CORS / CSRF

状態変更 API（`POST /api/pages`、`PATCH /api/pages/:id`、`POST /api/pages/:id/reports`）は認証を持たない（編集 API は Bearer で守られるが、作成・通報は誰でも呼べる）ため、第三者サイトから閲覧者のブラウザ経由で呼ばれると、閲覧者ごとに別 IP・別 device Cookie で作成や通報が積み上がり、IP + device のレート制限と通報のデデュープが無意味になる。次で防ぐ。

1. `/api/*` に CORS ヘッダを一切付けない（Hono の `cors()` を使わない）。
2. 状態変更 API は `Content-Type: application/json` 以外を 415 で拒否する（`UNSUPPORTED_MEDIA_TYPE`）。`<form method="POST">` や `fetch(..., { mode: 'no-cors' })` は `text/plain` `multipart/form-data` `application/x-www-form-urlencoded` しか送れず、JSON はプリフライトを要するので、CORS ヘッダを返さない限りクロスサイトからは送れない。Hono の `c.req.json()` は Content-Type を検証しないので、ミドルウェアで明示的に検査する。
3. `middleware/sameOrigin.ts`: `Sec-Fetch-Site` ヘッダがあれば `same-origin` 以外を 403、無ければ `Origin` ヘッダが `config.publicOrigin` と一致しないものを 403（`FORBIDDEN_ORIGIN`）。両方無い場合（古いクライアント）は通す（2 の Content-Type 検査が効く）。
4. 通報フォーム（§9.4）は素の HTML form ではなく `web/report/main.ts` から JSON で送る。CSP の `form-action 'self'` は自サイトのフォームにしか効かず、他サイト発の POST は防げないため。
5. 結合テスト（T7・T12）: 「`Origin` が別ドメインの通報は 403 で `reports` に入らない」「`text/plain` の POST は 415」「`Content-Type` と `Origin` が正しければ 200」。

### 9.9 ホスト名と絶対 URL

- レスポンス中の絶対 URL（`url` `og:url` `og:image` ics の `URL` `UID` Webhook 通知のリンク）は必ず `config.publicOrigin` から組み立て、`request.url` / `Host` ヘッダは使わない。Host ヘッダ由来の値を URL 生成に使うと、`*.workers.dev` や偽装 Host で配信された HTML に別ホストの URL が混ざる。
- `wrangler.jsonc` に `workers_dev: false` を書き（H3 完了後）、`*.workers.dev` で同じルートが応答しないようにする。Cache API が効かないホストで詳細ページが取得でき、noindex や通報導線の検証対象が 2 ホストに増えるのを避ける。
- `env.ASSETS.fetch()` に渡す URL だけは `request.url` を基準にする（同一 Worker 内の解決なので外部に出ない）。

---

## 10. テスト戦略

### 10.1 分担

| レイヤ | 対象 | ツール | 環境 |
|---|---|---|---|
| unit | `src/core/**`（パース・保持期限・ics・Google URL・プリフィル・検証・ID 形式・トークン照合） | Vitest（Node、`environment: node`） | 外部依存ゼロ。数秒で完走 |
| integration | `src/adapters/**`（D1・R2・レート制限・OGP レンダラ）、`src/server/**`（各ルート・GC・ミドルウェア） | Vitest + `@cloudflare/vitest-pool-workers` | workerd 上で D1・R2・Cache API・`ctx.waitUntil` を実機同等に再現。`wrangler.jsonc` のバインディングをそのまま使う |
| e2e | ブラウザからの主要シナリオ（§10.3） | Playwright | `wrangler dev` を `webServer` として起動。Chromium デスクトップ + モバイル（LINE UA）の 2 プロジェクト。時刻はブラウザ・Worker とも固定する（§10.3） |

### 10.2 結合テストの書き方

- ルートは `SELF.fetch()`（`wrangler.jsonc` の main を丸ごと起動）で叩く。`ctx.waitUntil` の完了を待つ必要がある経路（OGP の R2 put、通報の Webhook）は `createExecutionContext()` で ctx を作って `app.fetch(req, env, ctx)` を直接呼び、`waitOnExecutionContext(ctx)` で完了を待ってから R2 を検証する。
- **Static Assets バインディングが pool-workers で動くかは確認済み（T1）**（`vitest`・`wrangler`・pool-workers のバージョン組み合わせに依存するため実機で確認した）。実装時の実機確認（`@cloudflare/vitest-pool-workers@0.22.0`）: `env.ASSETS.fetch()` は `wrangler.jsonc` の `assets.directory` からビルド済みの HTML を正しく返し、`_headers` のヘッダ（CSP・`X-Content-Type-Options`・`X-Robots-Tag` 等）も付与された状態で返る（ポート化やヘッダの手動付与は不要）。**一方 `SELF.fetch()` は Worker の `fetch` ハンドラを直接呼ぶだけで、本番・`wrangler dev` で Worker の手前に立つ Static Assets のルーティング層（§2.2 の評価順序 1）を経由しない**ため、`SELF.fetch('/')` は（`/` に一致する Worker 側ルートを定義しない限り）404 になる。この構造は本番の Cloudflare エッジでも同じ（アセットに一致したリクエストはそもそも Worker に届かない）ため、Worker 側に `env.ASSETS.fetch()` へのフォールバックを実装する意味は無いと判断した。したがって結合テストでの Static Assets の検証は `env.ASSETS.fetch()` に対して直接行い（`test/integration/server/staticAssets.test.ts`）、アセット層 + Worker のフルスタックでの `/` のルーティングは e2e（`wrangler dev` は実際のルーティング層を経由する）の `test/e2e/smoke.spec.ts` に委ねる。`_headers` の適用も pool-workers 上で確認できたため、`assets.run_worker_first: true` への切り替えは不要だった。使用する `vitest`・`wrangler`・`@cloudflare/vitest-pool-workers` のバージョンは `package-lock.json` で固定し（§11.7）、T1 の PR 説明に記録する。
- 状態変更 API を叩くテストは `Content-Type: application/json` と `Origin: http://localhost:8787`（`wrangler.jsonc` の `vars.PUBLIC_ORIGIN` と同じ値）を付ける（§9.8）。テストヘルパ `test/integration/helpers/jsonRequest.ts`（§11.7）に集約する。
- D1 のマイグレーションは `vitest.config.ts` が `readD1Migrations('migrations')` の結果を `miniflare.bindings.TEST_MIGRATIONS` に渡し、`test/integration/setup.ts`（`setupFiles`）の `beforeEach` で `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` を適用する。各テストファイルには書かない。ストレージ分離はテストファイル単位で行われる。同じファイル内の `it()` 間ではテーブルの中身が残るため、テーブル全体を走査するテストは対象テーブルを `beforeEach` で `DELETE FROM` してから始める（§11.7 の T5 での確認）。テストだけが使うバインディング（`TEST_MIGRATIONS` 等）をグローバルな `Cloudflare.Env` に追記する宣言は `test/integration/env.d.ts` に置く（§11.7）。
- 時刻と ID は `Clock` / `IdGenerator` のポート（§11.4）を Fake に差し替えて固定する。差し替えは `createApp(deps)` の引数で行い、`SELF.fetch` 用の既定 app は本物のアダプタを使う。
- **e2e は時刻を固定する**（§10.3）。ブラウザは Playwright の `page.clock.setFixedTime`、Worker は `.dev.vars` の `E2E_FIXED_NOW` を `buildDeps` が読んで固定時計を配線する（§11.5）。結合テストは `.dev.vars` に依存せず、上記の Fake で固定する。`vitest.config.ts` の `miniflare.bindings` は `RATE_LIMIT_PEPPER` に加え `E2E_FIXED_NOW` も空文字で明示しており、`.dev.vars` にどちらの値があってもこちらが優先される。`E2E_FIXED_NOW` を上書きしていなかった時期は `.dev.vars` の値が `buildDeps` の `clock` を `fakeClock` にすり替え、`scheduled` ハンドラを実時刻の `now` で叩く `test/integration/scheduled/gc.test.ts` の 1 件だけが `.dev.vars` の有無で結果を変えていた（実機確認済み）。`.dev.vars` の有無で結合テストの実行結果が変わらないことを両方の状態で確認済み。wrangler が読み込み時に出す `Using secrets defined in .dev.vars` ログは `vitest.config.ts` の `WRANGLER_LOG=warn`（§11.7）で抑止する。
- OGP レンダラは `OgpRenderer` ポートを Fake（`fakeOgpRenderer`。1×1 の PNG をコード内の base64 定数で持ち、呼び出し回数を数える。fixtures は不要）に差し替えてルートを検証する。本物の satori + resvg は `test/integration/ogp/satoriOgpRenderer.test.ts` で「日本語を含む入力から PNG が返る」を検証する。**vitest-pool-workers 上で wasm import が動くことを T10 で確認できたため（satori を `harfbuzzjs` 導入前の `0.32.0` に固定。上記「satori の読み込み方」）、Node 側の別プロジェクトへの切り出しは不要だった**。レンダラは wasm とフォントを引数で受け取る作りにしており、切り出しが必要になった場合も対応できる（§11.5）。
- 代表例:
  - `POST /api/pages` → D1 に `pages` 1 行（`source` `creator_ip_hash` `creator_device_id` が入る）+ `events` 1 行、R2 に `ics/{id}.ics`、レスポンスに `editToken` と `url`、`Set-Cookie: cs_device`
  - `POST /api/pages` の `Content-Type: text/plain` は 415、`Origin` が別ドメインは 403、いずれも D1 に書かれずレート制限カウンタも進まない
  - `GET /:id.ics` → `text/calendar`、本文が `buildIcs` の出力と一致、`X-Robots-Tag`。hidden / 期限切れは 404
  - `GET /:id/ogp.png` を 2 回 → 1 回目だけ Fake レンダラが呼ばれ、2 回目は R2 から返る。レンダラが throw する場合はフォールバック PNG が返り、失敗マーカーが置かれる
  - `PATCH /api/pages/:id` → `version` +1、`previous_snapshot`（日時のみ）/ `changed_at` が入る、R2 の `ics/{id}.ics` が新しい `SEQUENCE` になる、Bearer 不一致は 401。終了済みイベントのメモだけの編集は 200、日時を過去に変える編集は 400 `PAST_EVENT`。`status` `report_count` は変わらない
  - `GET /:id/edit` → 200 で HTML 本文（3xx でない）、`X-Robots-Tag`
  - レート制限: 同一 `ip_hash` で 31 回目が 429。Cookie を変えても IP 側で 429。別 IP・同一 device で 21 回目が 429。上限超過後のリクエストでカウンタ行が増えない（SELECT だけで返る）
  - `ipHash`: 同一 /64 内の異なる IPv6 が同じ `ip_hash`、別 /64 は異なる。`::ffff:1.2.3.4` は `1.2.3.4` と同じ
  - `GET /:id` の Cache API: 1 回目 miss → 2 回目 hit（D1 を読まない。`PageRepository` Fake の呼び出し回数で検証）。`/:id?x=1` と `/:id?x=2` でも D1 は 1 回しか読まれない
  - GC: `expires_at` が過去のページが D1・R2 から消え、有効なページは残る。`rate_limit_counters` の古い行が消える。48 時間より古い `previous_snapshot` が NULL になる。101 件以上の期限切れも削除できる
  - `events` が 2 行あるページに対する作成・更新は 500（不変条件）。`events` の INSERT が失敗すると `pages` も残らない（`db.batch()`）
  - 通報: `Origin` が別ドメインは 403 で `reports` に入らない。`@everyone` と `https://` を含むコメントが Webhook の payload 上で無効化されている（Fake Notifier ではなく `webhookNotifier` の payload 生成を unit テスト）

### 10.3 e2e シナリオ

基準時刻は §5.6 と同じ **2026-09-16(水) 10:00 JST**（`2026-09-16T01:00:00Z`）に固定する。e2e は `wrangler dev` の実時計とブラウザの `new Date()` で動くので、固定しないと 2026-09-20 を過ぎた時点で 1・3 の年が繰り上がって曜日が変わり、12 のプリフィルは `PAST_EVENT`、11 は 2026-12 以降に 13 ヶ月以内に入ってしまう。ブラウザ側は `test/e2e/fixtures.ts` の共通フィクスチャが各テストの前に `page.clock.setFixedTime(new Date('2026-09-16T01:00:00Z'))` を呼ぶ（全 spec は `@playwright/test` ではなくこのフィクスチャの `test` / `expect` を import する）。Worker 側は `.dev.vars` の `E2E_FIXED_NOW`（ISO8601）を `buildDeps` が読み、`PUBLIC_ORIGIN` のホスト名が `localhost` のときだけ固定時計を配線する（本番では無視して warn ログ。§11.5）。

1. トップで `9/20 19時 渋谷で飲み会` を入力 → プレビューに 飲み会 / 9月20日(日) 19:00〜20:00 / 渋谷 が出る → 「URLを作る」→ `/done?id=` に遷移し URL とコピーボタンが出る → コピーでクリップボードに URL が入る（`test/e2e/create.spec.ts` の「入力〜プレビュー〜作成〜/done への遷移まで（シナリオ1）」、コピー動作は `test/e2e/done.spec.ts` の「URL・コピー・カレンダーリンク・詳細ページへの遷移・送り直し案内（シナリオ1・2・3）」で固定）
2. 完成画面の URL へ遷移 → 詳細ページに §6.3 の順序で要素が並ぶ → 「作ってみる」で `/new?ref=detail_cta` に遷移する（`test/e2e/done.spec.ts` の「URL・コピー・カレンダーリンク・詳細ページへの遷移・送り直し案内（シナリオ1・2・3）」で固定）
3. 「その他（ics）」のレスポンスが `text/calendar` で `SUMMARY:飲み会` を含む。Google ボタンの `href` を `new URL()` でパースし、ホストが `calendar.google.com`、`searchParams.get('dates')` が `20260920T100000Z/20260920T110000Z` に等しい（`href` 文字列上は `%2F` にエンコードされているため文字列一致にしない）（Google リンクの検証は `test/e2e/done.spec.ts` の「URL・コピー・カレンダーリンク・詳細ページへの遷移・送り直し案内（シナリオ1・2・3）」、ics のレスポンス内容は `test/e2e/full.spec.ts` の通しシナリオ末尾で固定）
4. プレビューの日時をタップして手動修正 → 入力欄を変えても日時は上書きされない → 「自動に戻す」で自動解釈に戻る。別途、`9/20 19時 渋谷で飲み会` で検出された場所（渋谷）を空にして作成 → リクエストの `fields.location` が `null`、詳細ページに `[data-section="location"]` が無い（`test/e2e/create.spec.ts` の「日時を手動修正すると入力欄を変えても上書きされず、自動に戻すで戻る（シナリオ4前半）」「場所を空にすると場所なしとして作成される（シナリオ4後半: 空にすると使わない）」で固定）
5. `9/20 19時 渋谷` → 「場所にする」で場所 = 渋谷、タイトルが日時表現になる（`test/e2e/create.spec.ts` の「「場所にする」で場所とタイトルが入れ替わる（シナリオ5）」で固定）
6. 2 行入力（`9/20 19時 渋谷で飲み会\n会費5000円`）→ プレビューのメモに `会費5000円` → 詳細ページにメモが表示され、URL を含めても `<a>` にならない（`test/e2e/create.spec.ts` の「2 行目がメモに入る（シナリオ6前半）」「詳細ページにメモが表示され、URL を含めても自動リンクにならない（シナリオ6後半）」で固定）
7. 履歴ページに作成したページが出る → 編集リンクから編集画面 → 日時を変更して保存 → `/done` 再掲（「同じ URL を送り直してください」が出る）→ 詳細ページに変更バナー（旧日時 → 新日時）と「最終更新」が出る。場所も変えた場合はバナーに「場所が変更されました」とだけ出て旧場所の文字列が DOM に無い。`buildDeps` は毎リクエストで `fakeClock(new Date(E2E_FIXED_NOW))` を返すため、作成と更新の `now()` が同一になり `updatedAt` は進まない。「同じ URL を送り直してください」・詳細ページの「最終更新」表示はどちらも `updatedAt` ではなく `version > 1` で判定する（§6.2・§6.3・§8）ため、固定時計の下でも編集後に正しく出る（`test/e2e/edit.spec.ts` の「履歴から編集して保存すると /done に再掲され、履歴と詳細ページに変更が反映される（シナリオ7）」で固定）
8. localStorage を消した状態で `/:id/edit` を開く → 「この端末では編集できません」（`test/e2e/edit.spec.ts` の「localStorage にトークンが無ければ「この端末では編集できません」と出る（シナリオ8）」で固定）
9. 通報フォームから送信 → 「報告を受け付けました」（`test/e2e/report.spec.ts` の「通報フォームから送信すると受付メッセージが出る（シナリオ9）」で固定）
10. LINE UA のモバイルプロジェクト: 詳細ページのカレンダーボタン `href` を `new URL()` でパースし `searchParams.has('openExternalBrowser')`、かつ Google 側の `action=TEMPLATE` が壊れていない。案内バナーが出る（`test/e2e/line.spec.ts` の「LINE / Android UA でカレンダーボタンの案内が完成画面・詳細ページの両方に出る（シナリオ10）」で固定。`has` のみで値までは見ていない）
11. 13 ヶ月超の日付（`2028/1/1 予定`）→ プレビューに「作成できるのは13ヶ月先までです」、作成ボタンは下書きとして通る（日時なし）（`test/e2e/create.spec.ts` の「13 ヶ月超の日付は下書きとして作成できる（シナリオ11）」で固定）
12. プリフィル `/new?text=飲み会&dates=20260920T100000Z/20260920T110000Z&location=渋谷` → 各項目が埋まり `manual` 表示、作成 API は押すまで呼ばれない。作成すると `source = 'prefill'` で記録される（`/new?ref=detail_cta` からの作成は `detail_cta`）（`test/e2e/create.spec.ts` の「プリフィルされた項目は manual 表示になり、API は押すまで呼ばれない（シナリオ12前半）」「ref=detail_cta からの作成は source が detail_cta になる（シナリオ12後半）」で固定）
13. `/done?id=//example.com` と `/done?id=%2F%2Fexample.com` を開く → 外部に遷移せず `/` に戻る（`test/e2e/redirect.spec.ts` の「不正なid（生の // による open redirect）は / へ遷移する（シナリオ13）」「不正なid（パーセントエンコードされた // による open redirect）は / へ遷移する（シナリオ13）」で固定）
14. `GET /done` `GET /new` のレスポンスヘッダに CSP と `X-Content-Type-Options` が付く（`_headers` の検証）（`test/e2e/report.spec.ts` の「GET /done と GET /new のレスポンスヘッダに CSP と X-Content-Type-Options が付く（シナリオ14）」で固定）

上記に加えて `test/e2e/full.spec.ts` に「作成 → 完成 → 詳細 → 作ってみる → 履歴 → 編集 → 詳細の変更バナー → ics」の通しシナリオを持つ（個々の画面遷移は上記の各 spec で個別に固定済みだが、画面をまたいだ一連の操作が壊れていないことをこの 1 本で確認する。T19）。詳細ページは編集しても Cache API のエントリを消さない（§2.4。最大 60 秒古い内容が返る）ため、編集前に詳細ページを開いたページを編集直後に開き直すと変更バナーが出ない。このシナリオは「作ってみる」で新たに作った 2 件目のページを編集する（1 件目は「作ってみる」の遷移確認のためだけに詳細ページを開く）ことでこれを避けている。同じ理由で `test/e2e/edit.spec.ts` のシナリオ7も編集対象のページの詳細を編集前には開いていない。

### 10.4 ローカルでの実行方法

```bash
cp .dev.vars.example .dev.vars   # 初回のみ。手元で実時計にしたいときは E2E_FIXED_NOW の行を消す
npx wrangler d1 migrations apply calshare --local   # 初回のみ。wrangler dev はマイグレーションを自動適用しない（§10.5）
npm run dev               # npm run build && wrangler dev（ローカル D1/R2、.dev.vars 読み込み）
npm run build             # node scripts/build-web.mjs（src/web → dist/）
npm run test:unit         # vitest run --project unit
npm run test:integration  # vitest run --project integration（vitest-pool-workers）。Static Assets（env.ASSETS.fetch）を
                           # dist/ から検証するテストがあるため、先に npm run build が必要（確認済み・T1）
npm run test:e2e          # playwright test（webServer で build → wrangler dev を自動起動。E2E_PORT=8791 のように指定すると別ポートで起動し、複数の作業ツリーで同時に走らせられる。
                           # wrangler dev には --var PUBLIC_ORIGIN:http://localhost:<port> も渡すので、API が返す url は実際のポートと一致する）
npm run test              # unit + integration
npm run lint              # eslint . && prettier --check .
npm run typecheck         # wrangler types → tsc -p tsconfig.{core,server,web}.json を順に
```

`E2E_FIXED_NOW` で時計を固定すると `rate_limit_counters` の時間窓が実時間では進まない。`wrangler dev` は `CF-Connecting-IP` を付けないので全テストが `ip:unknown` の単一バケットに入り、全 spec を 1 回通すだけで作成回数が上限に達する。そのため `test/e2e/fixtures.ts` はテストごとに別の送信元 IP を `CF-Connecting-IP` で名乗る（本番では Cloudflare がこのヘッダを上書きするので偽装には使えない）。この IP はテスト ID だけでなく `test/e2e/fixtures.ts` を読み込む Node プロセスごとに生成する salt からも作るため、同じ `.wrangler/state` に対して `npm run test:e2e` を繰り返し実行しても前回の実行と IP が衝突せず、レート制限のカウンタが実行をまたいで積み上がらない。`.wrangler/state` を作り直したいときは `rm -rf .wrangler/state && npx wrangler d1 migrations apply calshare --local` する（CI は毎回クリーンな環境なので影響しない）。

### 10.5 CI（GitHub Actions）

```
ci.yml（pull_request / push main。ステップの詳細は §11.7）
  npm ci → lint → typecheck → test:unit → test:scripts → build → test:integration → wrangler deploy --dry-run
  → playwright install → wrangler d1 migrations apply calshare --local → test:e2e
  （build は test:integration より前。test:integration が env.ASSETS.fetch() で dist/ を読むため。確認済み・T1。
  wrangler dev はローカル D1 にマイグレーションを自動適用しないため、test:e2e の webServer が使う .wrangler/state を
  先に用意する。T14 で e2e が初めて POST /api/pages を実行して判明した。確認済み・T14）
  test:e2e のステップだけ失敗したときに playwright-report/ を actions/upload-artifact で artifact に残す（T19。
  actions/checkout・actions/setup-node に加えて公式 action をもう 1 つ使う形になる。test:e2e より前のステップが
  落ちたときは playwright-report/ が存在しないため upload しない。id: e2e の outcome で判定する）
deploy.yml（push main / 手動実行。運用基盤の PR で作成済み。§13 H9・§12 T19 を参照）
  gate ジョブ: リポジトリ変数 DEPLOY_ENABLED が true でなければここで終了する（H9 の公開承認そのもの）
  deploy ジョブ: 変数 PUBLIC_DOMAIN が未設定なら失敗させて止める（sameOrigin の検証が本番 Origin
    と一致しなくなるため。マイグレーション適用より前に確認する）
    → npm ci → npm run build → `npx wrangler@4 d1 migrations apply calshare --remote`
    → `npx wrangler@4 deploy --var "PUBLIC_ORIGIN:https://$PUBLIC_DOMAIN"`
    → デプロイ直後に RATE_LIMIT_PEPPER が未登録なら生成して登録する（H6 をここで完結させる。§13）
    → GitHub Secret REPORT_WEBHOOK_URL があれば同じ値で Worker のシークレットに登録する
      （H7、任意。§13）
  サードパーティ action は使わない（GitHub 公式の actions/checkout・actions/setup-node のみ。バージョンは
  Dependabot が追従するためここには書かない。wrangler は npx wrangler@4 で都度呼ぶ）。
  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID は GitHub Secrets。手順は docs/runbooks/deploy.md。
```

`test:integration` はモック不要でネットワーク到達性も不要なので、GitHub Actions のホストランナー内で完結する。e2e は `npx playwright install --with-deps chromium` を含める。`wrangler deploy --dry-run` を build に含め、スクリプトサイズ上限（Paid 10MB gzip）を毎 PR で検出する。未ログイン・プレースホルダ `database_id` で通ることは確認済み（T1、§11.7）。ただし **`--dry-run` は Workers の起動時間制限（トップレベル評価 400ms）を検出しない**ので、wasm の初期化を遅延させる設計（§2.5）を守り、実機の確認は T19 の初回デプロイで行う。

`deploy.yml` は `ci.yml` の成功を GitHub Actions の機能（`workflow_run` 等）で待ち合わせていない。`main` への push はブランチ保護で ci.yml の必須チェックを通過した PR のマージに限られる前提で、デプロイ自体のゲートは `DEPLOY_ENABLED` の 1 点に絞っている（docs/runbooks/deploy.md）。

`wrangler dev` はローカルの D1（`--local`）と R2 エミュレーションを使い、ネットワーク到達性を要しない。フォントはリポジトリ内の `test/fixtures/fonts/`（サブセット済み OTF と OFL のライセンスファイル。生成は `scripts/fonts/subset.sh`）から `wrangler r2 object put --local` でローカル R2 に投入するスクリプト `scripts/seed-local-r2.mjs` を用意する。

---

## 11. モジュール構成

### 11.1 ディレクトリ構成

```
.
├── wrangler.jsonc                 # Workers 設定（assets / d1 / r2 / vars / crons。全文は §11.7）
├── package.json  package-lock.json  .nvmrc（22）
├── tsconfig.json                  # base。tsconfig.{core,server,web}.json が継承する（§11.7）
├── eslint.config.js  .prettierrc  .prettierignore  .gitignore  .dev.vars.example
├── vitest.config.ts               # test.projects: unit（Node）/ integration（pool-workers）
├── playwright.config.ts
├── worker-configuration.d.ts      # `wrangler types` が生成する（gitignore）
├── migrations/
│   └── 0001_init.sql
├── scripts/
│   ├── build-web.mjs              # src/web → dist/（src/web/*/main.ts を glob して esbuild。HTML / _headers 等はコピー。後続 PR は触らない）
│   ├── seed-local-r2.mjs          # test/fixtures/fonts/ のサブセット済みフォントをローカル R2 に投入（T10）
│   └── fonts/subset.sh            # Noto Sans JP のサブセット生成（運用基盤 PR が用意。T10 はこれを再利用し新規スクリプトを作らない）
├── src/
│   ├── core/                      # 外部依存ゼロ。Node / Workers / ブラウザで動く（tsconfig.core.json と ESLint で機械的に保証、§11.7）
│   │   ├── config/limits.ts         # 全定数（足場 PR が所有）
│   │   ├── config/reservedPaths.ts
│   │   ├── types.ts                 # EventFields / PageSummary / Json 型 / ChangeSnapshot / ReportReason / ValidationErrorCode（足場 PR が所有）
│   │   ├── api/types.ts             # API のリクエスト / レスポンス型。web と server が共用（足場 PR が所有）
│   │   ├── time/jst.ts              # JST ⇔ UTC 変換・整形（足場 PR が所有）
│   │   ├── text/urlPattern.ts       # URL 判定の正規表現。抽出用（パーサ・countUrls）と ics サニタイズ用の 2 本
│   │   ├── parse/{parseEventText,normalize,dateTokens,timeTokens,locationTitle,stopWords,types}.ts
│   │   ├── interpret/{types,ruleBasedInterpreter}.ts
│   │   ├── prefill/resolvePrefill.ts
│   │   ├── validate/validateEventFields.ts
│   │   ├── change/buildChangeSnapshot.ts   # 編集前後の EventFields から変更バナー用の ChangeSnapshot を作る（§3.5）
│   │   ├── retention/calculateExpiresAt.ts
│   │   ├── ics/buildIcs.ts
│   │   ├── google/buildGoogleCalendarUrl.ts
│   │   ├── id/{types,crockford}.ts  # crockford.ts に isValidPageId（サーバ・クライアント共用）。types.ts は足場 PR（T1）が置く（§12 T1、後述）
│   │   └── token/{hashEditToken,verifyEditToken}.ts
│   ├── ports/                     # サーバ側の境界（インターフェースのみ。足場 PR が所有）
│   │   ├── clock.ts  idGenerator.ts  pageRepository.ts（InvariantViolation もここ）  reportRepository.ts
│   │   ├── objectStorage.ts  rateLimiter.ts  ogpRenderer.ts  notifier.ts  logger.ts
│   ├── adapters/                  # ports の実装（本物 + Fake）
│   │   ├── clock/{systemClock,fakeClock}.ts          # 足場 PR。fakeClock は固定時刻を返す Clock（E2E_FIXED_NOW の配線にも使う）
│   │   ├── id/{webCryptoIdGenerator,fakeIdGenerator}.ts
│   │   ├── d1/{d1PageRepository,d1ReportRepository,d1RateLimiter}.ts
│   │   ├── r2/r2ObjectStorage.ts
│   │   ├── memory/{memoryPageRepository,memoryObjectStorage,memoryRateLimiter}.ts
│   │   ├── memory/memoryReportRepository.ts          # 足場 PR（T1）が用意する
│   │   ├── ogp/{satoriOgpRenderer,ogpTemplate}.ts   fakeOgpRenderer.ts は足場 PR（T1）が用意する
│   │   ├── notifier/webhookNotifier.ts              fakeNotifier.ts は足場 PR（T1）が用意する
│   │   └── logger/consoleLogger.ts                  # Logger ポートの実装。error フィールドの正規化（§9.6）もここ
│   ├── server/
│   │   ├── index.ts               # export default { fetch, scheduled }
│   │   ├── app.ts                 # createApp(deps): Hono。サブアプリを app.route() で 1 行ずつマウント
│   │   ├── deps.ts                # Env → Deps の組み立て（本物のアダプタ。ogpRenderer のみ Fake を配線。notifier は REPORT_WEBHOOK_URL の有無で決まる。§11.7）
│   │   ├── env.ts                 # Env 型（バインディング・vars・secrets。§11.7）
│   │   ├── lib/{edgeCache,headers,ipHash,deviceCookie,logger,errors,pageAccess,assets,ics}.ts
│   │   │                          # pageAccess: isServable。assets: ASSETS から HTML / PNG を取り Response を包み直す（§2.2）
│   │   │                          # ics: PageRecord から buildIcs を呼ぶ（作成・更新・自己修復で共用）。logger: リクエスト文脈のヘルパ（T18、§9.6）
│   │   ├── middleware/{securityHeaders,requestLog,rateLimit,sameOrigin,jsonBody}.ts
│   │   │                          # sameOrigin: Sec-Fetch-Site / Origin 検査。jsonBody: Content-Type 検査と本文 byte 上限・JSON の形式検証
│   │   ├── routes/
│   │   │   ├── health.ts          # GET /api/health
│   │   │   ├── apiPages.ts        # POST /api/pages
│   │   │   ├── apiPagesEdit.ts    # GET/PATCH /api/pages/:id
│   │   │   ├── apiReports.ts      # POST /api/pages/:id/reports
│   │   │   ├── detail.tsx         # GET /:id
│   │   │   ├── ics.ts             # GET /:id.ics（正規表現ルート。ics が無ければ再生成して PUT、§2.3）
│   │   │   ├── ogp.ts             # GET /:id/ogp.png
│   │   │   ├── editPage.ts        # GET /:id/edit → ASSETS の /edit
│   │   │   └── reportPage.tsx     # GET /:id/report
│   │   ├── views/                 # hono/jsx テンプレート
│   │   │   ├── Layout.tsx  DetailPage.tsx  ReportPage.tsx  NotFound.tsx
│   │   └── scheduled/gc.ts
│   └── web/                       # 静的アセットのソース（build-web.mjs で dist/ へ。配置は §2.2）
│       ├── pages/{index,new,done,history,edit}.html   # dist/ 直下へコピー
│       ├── robots.txt  favicon.ico                    # dist/ 直下へコピー
│       ├── _headers               # 静的ページのレスポンスヘッダ（手書き。headers.ts との一致を unit テストで検査、§9.1）。dist/ 直下へコピー
│       ├── img/ogp-fallback.png   # dist/assets/img/ へコピー
│       ├── styles/*.css           # dist/assets/css/ へコピー。インラインスタイルを持たない（CSP の style-src 'self'）
│       ├── lib/{history,api,clipboard,share,lineUa,dom}.ts
│       ├── create/{main,preview,tapEdit,prefill}.ts   # ① と編集画面が共用。prefill: クエリ文字列からの初期値と流入元 source の判定
│       ├── done/main.ts
│       ├── history/main.ts
│       ├── edit/main.ts
│       ├── report/main.ts         # 通報フォームを JSON で送信（§9.8）
│       └── detail/main.ts         # 詳細ページ用の小さな JS（LINE UA 判定・Android 注記）
├── test/
│   ├── unit/                      # src と同じ階層構造（core / adapters / server / web）
│   ├── integration/               # adapters / server / scheduled。setup.ts（マイグレーション適用）env.d.ts helpers/{jsonRequest,fakeDeps}.ts
│   ├── e2e/                       # Playwright。fixtures.ts（時刻固定の共通フィクスチャ）
│   └── fixtures/fonts/            # サブセット OTF と OFL.txt（OFL）。T10 で追加
└── docs/
```

### 11.2 定数（`src/core/config/limits.ts`、足場 PR が所有）

```typescript
export const MAX_EVENT_LEAD_TIME_MONTHS = 13
export const RETENTION_DAYS_AFTER_LAST_EVENT = 7
export const RETENTION_DAYS_FOR_DRAFT = 7
export const DEFAULT_EVENT_DURATION_MINUTES = 60
/** 午前・午後の語が無い 1〜N 時を午後と読む（規則 T2）。0 にするとリテラル解釈になる */
export const PM_HEURISTIC_MAX_HOUR = 7
/** input イベントからプレビューを再解釈するまでのデバウンス（§6.1） */
export const PREVIEW_DEBOUNCE_MS = 150
/** 完成画面でコピー結果のメッセージを表示し続ける時間（§6.2） */
export const COPY_MESSAGE_DURATION_MS = 2000
export const MAX_INPUT_LENGTH = 2000
/** 作成・更新・通報 API の本文の byte 上限。JSON をパースする前に弾く（§5.7 の (2)） */
export const MAX_BODY_BYTES = 32 * 1024
export const MAX_TITLE_LENGTH = 200
export const MAX_LOCATION_LENGTH = 200
export const MAX_MEMO_LENGTH = 2000
export const MAX_MEMO_URLS = 3
export const MAX_REPORT_COMMENT_LENGTH = 500
/** Webhook 通知に載せる通報コメントの最大文字数。全文は D1 の reports で見る（§9.4） */
export const MAX_WEBHOOK_COMMENT_LENGTH = 200
/** 通報件数がこれ以上なら Webhook 通知の本文で強調する（§9.4） */
export const REPORT_COUNT_WARNING_THRESHOLD = 3
/** Webhook 通知の fetch を打ち切るまでの時間。応答が無い送信先で waitUntil を専有し続けないため（§9.4） */
export const WEBHOOK_FETCH_TIMEOUT_MS = 5000
/** Google カレンダーリンクの details に載せるメモの最大文字数（§7.1） */
export const MAX_CALENDAR_DETAILS_LENGTH = 500
export const PAGE_ID_LENGTH = 12
export const CHANGE_BANNER_HOURS = 48
export const DETAIL_CACHE_MAX_AGE_SECONDS = 60
export const ICS_CACHE_MAX_AGE_SECONDS = 60
export const OGP_CACHE_MAX_AGE_SECONDS = 300
export const OGP_FAILURE_CACHE_SECONDS = 300
export const OGP_IMAGE_WIDTH = 1200
export const OGP_IMAGE_HEIGHT = 630
export const DEVICE_COOKIE_NAME = 'cs_device'
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
export const RATE_LIMITS = {
  create: { ipPerHour: 30, ipPerDay: 100, devicePerDay: 20 },   // IP 側は CGNAT を考慮して緩め（§9.3）
  report: { ipPerHour: 10, ipPerDay: 30 },
} as const
/** IPv6 はこのプレフィックス長に丸めてから ip_hash を計算する（§9.3） */
export const IPV6_BUCKET_PREFIX_BITS = 64
export const REPORT_DEDUPE_HOURS = 24
/** D1 は 1 クエリのバインドパラメータが 100 個まで。GC のバッチと deleteByIds の分割単位に使う */
export const D1_MAX_BIND_PARAMS = 100
export const GC_BATCH_SIZE = 100
export const GC_MAX_BATCHES_PER_RUN = 20
export const RATE_LIMIT_COUNTER_RETENTION_DAYS = 2
/** ログの error.message を切り詰める長さ（§9.6） */
export const MAX_LOG_ERROR_MESSAGE_LENGTH = 200
```

### 11.3 共有型（`src/core/types.ts`、足場 PR が所有）

```typescript
export interface EventFields {
  title: string
  location: string | null
  memo: string | null
  start: Date | null
  end: Date | null
  isAllDay: boolean
}

/** API レスポンス・詳細ページ・履歴で共通に使う、公開してよい情報 */
export interface PageSummary {
  id: string
  url: string
  fields: EventFields
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
  version: number
}

/** Date を ISO8601 文字列にした JSON 用の型。API のリクエスト／レスポンスと localStorage で使う */
export type Jsonified<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] }
export type EventFieldsJson = Jsonified<EventFields>
export type PageSummaryJson = Omit<Jsonified<PageSummary>, 'fields'> & { fields: EventFieldsJson }
export function toEventFieldsJson(fields: EventFields): EventFieldsJson
// 形式不正は例外（API 側で INVALID_REQUEST にする）。ISO8601 は toISOString() の形式（UTC、Z 終端）だけを受け付ける。
// 2/30 や 24:00 のような暦に存在しない日時は Date 化で別の日時に繰り上がるため、toISOString() に戻して先頭 19 文字が
// 入力と一致するかで弾く
export function fromEventFieldsJson(json: EventFieldsJson): EventFields

/** 作成の流入元（§6.1）。pages.source に保存し転換率の集計に使う */
export type CreateSource = 'direct' | 'detail_cta' | 'prefill'

/** 通報理由（§9.4）。API リクエスト・ports/notifier・ports/reportRepository で共用 */
export type ReportReason = 'spam' | 'personal_info' | 'inappropriate' | 'other'

/** core/validate が返す検証エラー（§5.7）。API の ApiError.code の一部でもあるので T1 でここに置く */
export type ValidationErrorCode =
  | 'EMPTY_INPUT' | 'INPUT_TOO_LONG' | 'INVALID_RANGE' | 'PAST_EVENT' | 'BEYOND_MAX_LEAD_TIME' | 'TOO_MANY_URLS'

/** 変更バナー用の編集前スナップショット。日時だけを持ち、タイトル・場所は変わった事実だけを持つ（§3.5） */
export interface ChangeSnapshot {
  start: Date | null
  end: Date | null
  isAllDay: boolean
  titleChanged: boolean
  locationChanged: boolean
}

export type ManualState = 'auto' | 'manual'
export type FieldKey = keyof EventFields
```

API のリクエスト / レスポンス型はクライアント（`src/web`）とサーバの両方が import するので `src/core/api/types.ts` に置く（§11.7 の tsconfig 分割で `src/web` から `src/server` は参照できない）。足場 PR が所有する。

```typescript
// src/core/api/types.ts
export interface CreatePageRequest { rawText: string; fields: EventFieldsJson; source: CreateSource }   // Date は ISO8601 文字列
export interface CreatePageResponse extends PageSummaryJson { editToken: string }
/** GET /api/pages/:id。Bearer 必須なので公開情報ではない rawText を含む（§6.5） */
export type GetPageResponse = PageSummaryJson & { rawText: string }
export interface UpdatePageRequest { rawText: string; fields: EventFieldsJson }
export type UpdatePageResponse = PageSummaryJson
export interface CreateReportRequest { reason: ReportReason; comment: string | null }
export type ApiErrorCode =
  | ValidationErrorCode | 'UNSUPPORTED_MEDIA_TYPE' | 'FORBIDDEN_ORIGIN' | 'INVALID_REQUEST'
  | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'INTERNAL'
export interface ApiError { code: ApiErrorCode; message: string }
/** GET /api/health（§11.7） */
export interface HealthResponse { ok: true }
```

### 11.4 ポート（`src/ports/*.ts`、足場 PR が所有）

```typescript
// ports/clock.ts
export interface Clock { now(): Date }

// ports/idGenerator.ts
export type { IdGenerator } from '../core/id/types'

// ports/pageRepository.ts
/** Phase 1 の不変条件（events は 1 ページ 1 行）が破れているときに PageRepository が投げる。ルート側で 500 にする */
export class InvariantViolation extends Error {}

export interface PageRecord {
  id: string
  ownerId: string | null
  editTokenHash: string
  rawText: string
  issuerName: string | null
  issuerLogoUrl: string | null
  status: 'active' | 'hidden'
  reportCount: number
  version: number
  previousSnapshot: ChangeSnapshot | null
  changedAt: Date | null
  source: CreateSource
  creatorIpHash: string
  creatorDeviceId: string
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  event: EventRecord            // Phase 1 は常に 1 件。複数行あれば PageRepository が InvariantViolation を投げる
}
export interface EventRecord extends EventFields {
  id: string
  pageId: string
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}
export interface NewPageInput {
  id: string
  editTokenHash: string
  rawText: string
  event: { id: string } & EventFields
  expiresAt: Date
  source: CreateSource
  creatorIpHash: string
  creatorDeviceId: string
  now: Date
}
export interface PagePatch {
  rawText: string
  event: EventFields
  expiresAt: Date
  previousSnapshot: ChangeSnapshot | null   // 変更バナー対象の変更が無ければ null（既存値を維持）
  now: Date
}
export interface PageRepository {
  /** pages と events の INSERT を db.batch() で 1 トランザクションにする（§3.1） */
  create(input: NewPageInput): Promise<'ok' | 'id_conflict'>
  findById(id: string): Promise<PageRecord | null>
  /** version+1 で更新する。楽観ロックは持たず最後の保存が勝つ（§6.5）。status / report_count は触らない */
  update(id: string, patch: PagePatch): Promise<'ok' | 'not_found'>
  incrementReportCount(id: string): Promise<number>   // 更新後の件数
  /** 同一送信元（ip_hash または device_id が一致）の active なページ数。通報通知に載せる（§9.4） */
  countActiveByCreator(creatorIpHash: string, creatorDeviceId: string): Promise<number>
  listExpired(before: Date, limit: number): Promise<string[]>
  /** D1_MAX_BIND_PARAMS 件ずつに分割して db.batch() に載せる。101 件以上でも動く */
  deleteByIds(ids: string[]): Promise<void>
  /** changed_at が before より古い行の previous_snapshot / changed_at を NULL にする（§2.6） */
  clearExpiredSnapshots(before: Date): Promise<number>
}

// ports/reportRepository.ts（ReportReason は core/types.ts、§11.3）
export interface NewReportInput {
  id: string                    // UUID
  pageId: string
  reason: ReportReason
  comment: string | null
  ipHash: string
  now: Date
}
export interface ReportRepository {
  /**
   * 同一 ipHash・同一 pageId の通報が dedupeSince 以降に既にあれば 'duplicate' を返して INSERT しない（§9.3 の 24 時間デデュープ）。
   * 無ければ INSERT して 'inserted'。report_count の +1 は呼び出し側が PageRepository.incrementReportCount で行う
   */
  insertIfNotDuplicate(report: NewReportInput, dedupeSince: Date): Promise<'inserted' | 'duplicate'>
}

// ports/objectStorage.ts
export interface ObjectStorage {
  /** キーは ics/{pageId}.ics（version を含めない。§1.3） */
  putIcs(pageId: string, body: string): Promise<void>
  /** 無ければ null。routes/ics.ts は null かつ isServable なページなら buildIcsForPage で再生成し putIcs してから返す（作成時の PUT 失敗の自己修復、§2.3） */
  getIcs(pageId: string): Promise<string | null>
  putOgpImage(pageId: string, version: number, png: Uint8Array): Promise<void>
  getOgpImage(pageId: string, version: number): Promise<Uint8Array | null>
  putOgpFailureMarker(pageId: string, version: number, ttlSeconds: number): Promise<void>
  getOgpFailureMarker(pageId: string, version: number): Promise<boolean>
  getFont(key: string): Promise<ArrayBuffer | null>
  deleteAllForPage(pageId: string): Promise<void>
}

// ports/rateLimiter.ts
/** 'interpret' は Phase 2 の POST /api/interpret 用に予約（§5.9）。Phase 1 では使わない */
export type RateLimitScope = 'create' | 'report' | 'interpret'
export type RateLimitWindow = 'hour' | 'day'
export interface RateLimitRule { scope: RateLimitScope; bucketKey: string; window: RateLimitWindow; limit: number }
export interface RateLimiter {
  /**
   * まず全ルールの現在値を読み、1 つでも上限以上なら書かずに allowed=false を返す。
   * 全て未満のときだけカウンタを進める（§9.3）
   */
  consume(rules: RateLimitRule[], now: Date): Promise<{ allowed: boolean; exceeded: RateLimitRule[] }>
  deleteExpired(before: Date): Promise<void>
}

// ports/ogpRenderer.ts
export interface OgpInput { title: string; dateLabel: string; location: string | null; serviceName: string }
export interface OgpRenderer { render(input: OgpInput): Promise<Uint8Array> }

// ports/notifier.ts（ReportReason は core/types.ts から import する、§11.3）
export interface ReportNotification {
  pageId: string
  url: string                    // config.publicOrigin から組んだ詳細ページ URL
  reason: ReportReason
  comment: string | null         // 実装側で URL 置換と 200 文字の切り詰めを行う（§9.4）
  reportCount: number
  activePagesFromSameCreator: number
}
export interface Notifier { notifyReport(n: ReportNotification): Promise<void> }

// ports/logger.ts
export interface Logger {
  /** data.error に Error を渡してよい。実装が { name, message } に正規化する（§9.6） */
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
}
```

### 11.5 サーバの組み立てと API の型

```typescript
// server/deps.ts
export interface Deps {
  clock: Clock                 // 本番は systemClock。E2E_FIXED_NOW があり PUBLIC_ORIGIN のホスト名が localhost なら fakeClock で固定（§10.3）
  ids: IdGenerator
  pages: PageRepository
  reports: ReportRepository
  storage: ObjectStorage
  rateLimiter: RateLimiter
  ogpRenderer: OgpRenderer     // T10 までは fakeOgpRenderer（固定 PNG）を使う
  notifier: Notifier           // REPORT_WEBHOOK_URL が無ければ fakeNotifier（no-op）。§9.4
  logger: Logger
  config: {
    publicOrigin: string       // new URL(env.PUBLIC_ORIGIN).origin
    publicHost: string         // new URL(env.PUBLIC_ORIGIN).host。ics の UID に使う（§7.2）
    serviceName: string        // env.SERVICE_NAME
    ratePepper: string         // env.RATE_LIMIT_PEPPER
  }
}
/** Env → Deps。ogpRenderer は本物のアダプタが無いため Fake のまま。notifier は REPORT_WEBHOOK_URL があるときだけ webhookNotifier、無ければ fakeNotifier（§9.4） */
export function buildDeps(env: Env): Deps

// server/app.ts
export function createApp(deps: Deps): Hono<{ Bindings: Env }>
// 各 routes/*.ts は `export function xxxRoutes(deps: Deps): Hono` を export し、
// app.ts は `app.route('/', xxxRoutes(deps))` を §2.2 の評価順で 1 行ずつ足すだけにする。
// API のリクエスト / レスポンス型（CreatePageRequest / GetPageResponse / ApiError 等）は core/api/types.ts（§11.3）
```

```typescript
// core/validate/validateEventFields.ts（ValidationErrorCode は core/types.ts、§11.3）
export type ValidationResult = { ok: true } | { ok: false; code: ValidationErrorCode }
export type ValidationMode =
  | { mode: 'create' }
  | { mode: 'update'; previous: EventFields }   // PAST_EVENT は日時が previous と異なるときだけ検証する（§5.7）
export function validateEventFields(rawText: string, fields: EventFields, now: Date, mode: ValidationMode): ValidationResult
export function countUrls(texts: (string | null)[]): number    // core/text/urlPattern.ts の URL_PATTERN を使う

// core/text/urlPattern.ts
export const URL_PATTERN: RegExp                               // §5.2 の 3 形式（抽出用）。g フラグ付きで使う側が lastIndex を管理しない（毎回 new RegExp）
export function replaceUrls(text: string, replacement: string): string
export const WIDE_URL_PATTERN: RegExp                          // ics のサニタイズ専用（置換用、§5.2・§7.2）。URL_PATTERN より広く一致する
export function replaceUrlsWide(text: string, replacement: string): string
export const WIDE_BARE_DOMAIN_MAX_LABELS: number               // テスト専用。ベアドメインで許容する中間ラベル数の上限

// core/change/buildChangeSnapshot.ts（T3）
/** 編集前後を比べ、タイトル・日時・場所のいずれかが変わっていれば変更前の日時 + titleChanged / locationChanged を返す。メモだけの変更は null（§3.5） */
export function buildChangeSnapshot(previous: EventFields, next: EventFields): ChangeSnapshot | null

// core/token
export async function hashEditToken(token: string): Promise<string>          // SHA-256 hex（Web Crypto）
export function verifyEditTokenHash(actual: string, expected: string): boolean // 定数時間比較

// core/time/jst.ts
export function jstDate(y: number, m: number, d: number, h = 0, mi = 0): Date  // JST の壁時計 → Date(UTC)
export interface JstParts { y: number; m: number; d: number; h: number; mi: number; weekday: number }   // weekday: 0 = 日曜〜6 = 土曜
export function toJstParts(date: Date): JstParts
export function formatDateLabel(fields: EventFields): string   // 「9月20日(日) 19:00〜21:00」等。詳細・OGP・タイトル代替で共用。start のみ（保存前の途中状態）のときは開始だけを返す
export function formatBasicUtc(date: Date): string             // 20260920T100000Z
export function formatBasicDateJst(date: Date): string         // 20260920
export function addDays(date: Date, days: number): Date
export function addMonths(date: Date, months: number): Date

// adapters/ogp/satoriOgpRenderer.ts
export interface SatoriOgpRendererOptions {
  /**
   * yoga と resvg の wasm。Workers では `import` した WebAssembly.Module を返す。
   * ArrayBuffer を返す経路は Node 専用（Workers は WebAssembly.compile(bytes) を許可しない）
   */
  loadWasm: () => Promise<{ yoga: WebAssembly.Module | ArrayBuffer; resvg: WebAssembly.Module | ArrayBuffer }>
  loadFont: () => Promise<ArrayBuffer>                        // Workers では R2、Node では fs
}
/** init は初回 render 時に遅延実行し、結果とフォントをメモ化する。モジュール読み込み時に重い処理をしない（§2.5） */
export function createSatoriOgpRenderer(options: SatoriOgpRendererOptions): OgpRenderer
/** サブセットフォントに無い文字を除去し、タイトルを 2 行相当に切り詰める（§2.5） */
export function toOgpInput(page: PageRecord, serviceName: string): OgpInput

// server/lib/ics.ts（T7）
/**
 * PageRecord と config から IcsInput（uid = `${event.id}@${publicHost}`、sequence = version - 1、detailUrl）を組んで buildIcs を呼ぶ。
 * 日時の無い下書きは ics を持たないので null（routes/ics.ts は 404、作成・更新は PUT しない）。作成（T7）・更新（T11）・自己修復（T9）で共用
 */
export function buildIcsForPage(page: PageRecord, config: Deps['config'], generatedAt: Date): string | null

// web/lib/api.ts（クライアント。型は core/api/types.ts）
export function createPage(req: CreatePageRequest): Promise<CreatePageResponse>
export function getPage(id: string, editToken: string): Promise<GetPageResponse>
export function updatePage(id: string, editToken: string, req: UpdatePageRequest): Promise<UpdatePageResponse>
```

### 11.6 並列実装のための規約

- 定数は `core/config/limits.ts` にだけ置き、足場 PR で全部そろえる。他 PR は定数を足さない（必要なら足場 PR に追記してから）。
- 共有型（`core/types.ts` `core/api/types.ts`）・ポート（`ports/*.ts`）は足場 PR で確定させ、後続 PR は変更しない。変更が必要になったら設計書を直してから単独の PR にする。`InvariantViolation` は `ports/pageRepository.ts` に置く（`server/lib/errors.ts` は T7 で作られるため、T5 が先に使えるように）。
- 足場 PR は `adapters/ogp/fakeOgpRenderer.ts`（1×1 PNG の base64 定数を返し呼び出し回数を数える）・`adapters/notifier/fakeNotifier.ts`（no-op で呼び出しを記録）・`adapters/memory/memoryReportRepository.ts` も用意する。`server/deps.ts` の `ids` `pages` `storage` `rateLimiter` `reports` は T7 で本物のアダプタに差し替え済み（§11.7）。`ogpRenderer` は本物のアダプタが無いため T10 で差し替える（`deps.ts` の 1 行変更）まで Fake のまま。`notifier` は T12 で実装し、`REPORT_WEBHOOK_URL` の有無で `webhookNotifier` / `fakeNotifier` を切り替える（§11.1・§11.7）。
- `server/app.ts` は各ルート PR が `app.route()` を 1 行足すだけ。ルートの中身は `routes/*.ts` に閉じる。
- 各アダプタ PR は本物と Fake（`adapters/memory/*`）を同じ PR で届け、同じテストスイートを両方に流す。
- クライアント側は `web/create/*` を①と編集画面で共用し、画面固有のエントリ（`web/*/main.ts`）だけを分ける。
- 静的 HTML 内のアセット参照（`<script src>` `<link href>` 画像）は `/assets/...` の絶対パスに固定する。`edit.html` が `/:id/edit` で配信されるため（§2.2）。
- インラインスタイル・インラインスクリプトを HTML に書かない（CSP の `'self'` のみ。§9.1）。
- レスポンスに含める絶対 URL は `config.publicOrigin` から組む。`request.url` / `Host` は使わない（§9.9）。

### 11.7 足場（T1）の構成ファイル

T1 が置く設定ファイルと足場コードの確定値。後続 PR はここに書かれた値を前提にしてよい。「要検証」と書いた項目は T1 の完了条件に検証結果の記録を含め、外れたら本節を直してから後続に進む（確認が済んだ項目は「確認済み（T1）」に書き換えてある）。

**パッケージ管理と Node**

- パッケージマネージャは npm。`package-lock.json` をコミットする。依存は caret（`^`）指定で、実際のバージョンは lockfile で固定する。
- Node は `>=22`（`package.json` の `engines`）。`.nvmrc` = `22`。ローカルは v22.19、CI は `node-version-file: .nvmrc` で同じ 22 系を使う。（実装時の実測: `wrangler@4.133.0` は `package.json` の `engines.node` が `>=22.0.0` で、Node 20 では起動時に明示的に拒否される。設計時点の想定（Node 20 系）と `wrangler` 4.133 系の実際の要件が食い違ったため、実物を優先して 22 系に変更した。T1 の完了条件）

**依存パッケージ**（T1 時点。satori / `@resvg/resvg-wasm` は T10 で追加する。yoga は `satori/standalone` に同梱の `yoga.wasm` を使うため別パッケージの追加は無い）

| 種別 | パッケージ | 備考 |
|---|---|---|
| dependencies | `hono` | 4 系 |
| devDependencies | `wrangler` | 4 系。`wrangler types` で `worker-configuration.d.ts`（ランタイム型 + バインディング型）を生成する。生成物は gitignore し、`npm run typecheck` の先頭で毎回生成する。`@cloudflare/workers-types` は使わない |
| | `typescript` | 5 系（5.9）。7 系は typescript-eslint が未対応（`<6.1`）なので使わない |
| | `vitest` | 4.1 系。`@cloudflare/vitest-pool-workers` 0.22 の peer が `^4.1.0` で、5 系は非対応 |
| | `@cloudflare/vitest-pool-workers` | 0.22 系（vitest 4.1 対応）。`peerDependencies` の範囲を `npm install` 時に確認し、解決済みバージョンを PR 説明に記録する |
| | `@playwright/test` | |
| | `esbuild` | web アセット専用。Worker 本体は wrangler がバンドルする |
| | `eslint` `@eslint/js` `typescript-eslint` | eslint 10 系 flat config（typescript-eslint 8.70 が `^10.0.0` 対応）。9 系でも可 |
| | `prettier` | |
| | `@types/node` | `wrangler types` の「Install @types/node」案内を消すためだけに入れる。`tsconfig.core.json` `tsconfig.web.json` の `types: []` で core / web には漏れない |

`@types/node` は devDependencies に入れる（`wrangler types` が nodejs_compat を見て導入を促すメッセージを消すため。実機確認済み: 入れないと `npm run typecheck` の度に「Action required Install @types/node」が出る）。`tsconfig.core.json` `tsconfig.web.json` はどちらも `types: []` なので `@types/node` を入れても `src/core` `src/web` から `process` `Buffer` を参照すると TS2591 で `tsc` が落ち、「core / web は DOM にも Node にも依存しない」保証は変わらない（実機確認済み）。設定ファイル（`*.config.ts` `scripts/*.mjs`）は tsc の対象外で、テストがファイルを読む箇所は Vite の `?raw` import（下記 `_headers` のテスト）で済ませる。

**`package.json` の scripts**

```jsonc
{
  "dev": "npm run build && wrangler dev",
  "build": "node scripts/build-web.mjs",
  "typecheck": "wrangler types && tsc -p tsconfig.core.json && tsc -p tsconfig.server.json && tsc -p tsconfig.web.json",
  "lint": "eslint . && prettier --check .",
  "format": "prettier --write .",
  "test:unit": "vitest run --project unit",
  "test:integration": "vitest run --project integration",
  "test": "npm run test:unit && npm run test:integration",
  "test:e2e": "playwright test"
}
```

**`wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "calshare",
  "main": "src/server/index.ts",             // wrangler が直接バンドルする。esbuild は web アセットのみ
  "compatibility_date": "2026-08-22",         // 実装時の実機確認: T1 実施日（2026-09-17）そのままだと
                                               // 「このワーカーは compatibility date "2026-09-17" を要求するが、
                                               // このサーバのバイナリが対応する最新の日付は "2026-08-22"」で
                                               // pool-workers（miniflare 同梱の workerd）が起動に失敗した。
                                               // wrangler 4.133.0 に同梱の workerd が対応する最新日付を使う
  "compatibility_flags": ["nodejs_compat"],  // 確認済み（T1）: T1 自体は nodejs_compat を必要としないが、
                                              // wrangler.jsonc は crons（T13）以外での変更が §12 の規約で禁じられているため、
                                              // T10（satori/resvg）で必要になることを見越して T1 の時点で付けておく。付けても
                                              // T1 のテスト・dry-run・wrangler dev はすべて通ることを実機確認済み
  "workers_dev": true,                        // H3 でカスタムドメインを割り当てたら false（§9.9）
  "observability": { "enabled": true },
  "assets": {
    "directory": "./dist",                    // §2.2 の配置
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "none"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "calshare",
      "database_id": "00000000-0000-0000-0000-000000000000",   // H4 で本番の ID に置換
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "calshare" }],
  "vars": { "PUBLIC_ORIGIN": "http://localhost:8787", "SERVICE_NAME": "calshare" }
  // "triggers": { "crons": ["0 19 * * *"] } は T13 で追加する（§2.6）
}
```

- `vars` はローカル・CI の値。本番の `PUBLIC_ORIGIN`（H1 のドメイン）は `deploy.yml` の `wrangler deploy --var PUBLIC_ORIGIN:https://...` で上書きする（T19。`env.production` を作ると D1 / R2 のバインディングを環境ごとに再宣言する必要があり二重管理になる）。
- 確認済み（T1、wrangler 4.133.0、`CLOUDFLARE_API_TOKEN` 等を明示的に外した環境で実行）: `wrangler deploy --dry-run --outdir dist-worker` はプレースホルダの `database_id`・未ログインのまま通り、バインディング一覧（`DB` `BUCKET` `ASSETS` `PUBLIC_ORIGIN` `SERVICE_NAME`）と Upload サイズ（Total 66.51 KiB / gzip 16.79 KiB、T1 時点）が表示された。通らない場合に備えていた代替（CI のそのステップを `npx wrangler check startup` に置き換え、サイズ計測を `dist-worker` のファイルサイズで代替する案）への切り替えは不要だった。

**`src/server/env.ts` と `.dev.vars.example`**

```typescript
// src/server/env.ts
export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS: Fetcher
  PUBLIC_ORIGIN: string        // vars
  SERVICE_NAME: string         // vars
  RATE_LIMIT_PEPPER: string    // secret（ローカルは .dev.vars）
  REPORT_WEBHOOK_URL?: string  // secret。無い（または空文字）なら fakeNotifier を使う（§9.4）
  E2E_FIXED_NOW?: string       // .dev.vars のみ。ISO8601。PUBLIC_ORIGIN のホスト名が localhost のときだけ有効（§10.3）
}
```

`D1Database` `R2Bucket` `Fetcher` は `wrangler types` が生成する `worker-configuration.d.ts` の型を使う。生成ファイルにも global な `Env` が宣言されるが、`env.ts` の `Env` はモジュールスコープなので衝突しない。手書きにするのは secrets の optional 性（`?`）を表すため。

```
# .dev.vars.example（cp して .dev.vars にする。.dev.vars は gitignore）
RATE_LIMIT_PEPPER=dev-pepper
REPORT_WEBHOOK_URL=
E2E_FIXED_NOW=2026-09-16T01:00:00Z
```

**`buildDeps` の配線**

| Deps | 配線 | 本物に差し替える PR |
|---|---|---|
| `clock` | `E2E_FIXED_NOW` があり `new URL(PUBLIC_ORIGIN).hostname === 'localhost'` なら `fakeClock(new Date(E2E_FIXED_NOW))`、それ以外は `systemClock`（`E2E_FIXED_NOW` があるのに localhost でなければ warn ログを出して無視。localhost でも `E2E_FIXED_NOW` が Invalid Date になる値なら `e2e_fixed_now_invalid` を warn して `systemClock` にする） | — |
| `ids` | `createWebCryptoIdGenerator()` | — |
| `pages` | `createD1PageRepository(env.DB)` | — |
| `reports` | `createD1ReportRepository(env.DB)` | — |
| `storage` | `createR2ObjectStorage(env.BUCKET, clock)` | — |
| `rateLimiter` | `createD1RateLimiter(env.DB)` | — |
| `ogpRenderer` | `fakeOgpRenderer` | T10 |
| `notifier` | `REPORT_WEBHOOK_URL` があれば `webhookNotifier`、無ければ `fakeNotifier` | — |
| `logger` | `consoleLogger` | — |
| `config` | `publicOrigin` = `new URL(PUBLIC_ORIGIN).origin`、`publicHost` = `new URL(PUBLIC_ORIGIN).host`、`serviceName` = `SERVICE_NAME`、`ratePepper` = `RATE_LIMIT_PEPPER` | — |

`src/server/index.ts` は `export default { fetch: (req, env, ctx) => createApp(buildDeps(env)).fetch(req, env, ctx) }`（`scheduled` は T13 で追加）。`buildDeps` はリクエストごとに呼んでよい（アダプタの生成は軽い。wasm やフォントのメモ化はモジュールスコープで行う、§2.5）。

**足場の Fake**

- `adapters/ogp/fakeOgpRenderer.ts`: `createFakeOgpRenderer(): OgpRenderer & { calls: OgpInput[] }`。返す PNG は 1×1 透明 PNG をコード内の base64 定数で持つ（`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`）。fixtures ディレクトリは要らない。
- `adapters/notifier/fakeNotifier.ts`: `createFakeNotifier(): Notifier & { calls: ReportNotification[] }`。何も送らず記録だけする。
- `adapters/memory/memoryReportRepository.ts`: `${pageId}:${ipHash}` をキーに最終通報時刻を `Map` で持ち、`dedupeSince` 以降なら `'duplicate'`。T5 が D1 実装と同じスイートを流す。
- `adapters/clock/fakeClock.ts`: `fakeClock(now: Date): Clock & { set(now: Date): void }`。`systemClock` は `new Date()` を返す。

**`GET /api/health`**: `200`、本文 `{ "ok": true }`（`HealthResponse`、§11.3）、`Content-Type: application/json`、`Cache-Control: no-store`。

**`vitest.config.ts`**（Vitest 4 の `test.projects` を 1 ファイルに書く。`vitest.workspace.ts` は 4 系で廃止されているので作らない）

```typescript
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// ローカルに .dev.vars があると wrangler が読み込みログ（"Using secrets defined in .dev.vars"）を出す。
// 値は下記 miniflare.bindings が上書きするので実害は無いが、テスト出力を汚さないよう log レベルを warn に絞る
process.env.WRANGLER_LOG ??= 'warn'

export default defineConfig(async () => {
  const TEST_MIGRATIONS = await readD1Migrations('migrations')
  return {
    test: {
      projects: [
        { test: { name: 'unit', environment: 'node', include: ['test/unit/**/*.test.ts'] } },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              // .dev.vars に依存しないよう secrets はここで与える
              miniflare: { bindings: { TEST_MIGRATIONS, RATE_LIMIT_PEPPER: 'test-pepper' } },
            }),
          ],
          test: {
            name: 'integration',
            include: ['test/integration/**/*.test.ts'],
            setupFiles: ['test/integration/setup.ts'],
          },
        },
      ],
    },
  }
})
```

- 確認済み（T1。設計時点の想定と食い違ったため記述を更新した）: `@cloudflare/vitest-pool-workers@0.22.0`（vitest 4.1 系に対応する現行バージョン）は `defineWorkersProject` も `/config` サブパスも提供しない。`readD1Migrations` はパッケージのルートエントリから export され、pool の指定は `cloudflareTest(options)` が返す **Vite プラグイン**を `test.projects` の各要素の `plugins` に渡す形に変わっている（`poolOptions.workers` の `isolatedStorage` / `singleWorker` に相当するオプションは無くなっている）。`test.projects` の要素は Vite の `UserConfig`（`plugins` を含む）に `test` を足した形をそのまま置けるため、`vitest.integration.config.ts` への分離は不要だった。`readD1Migrations('migrations')` は `migrations/` ディレクトリが無いと `ENOENT` で例外を投げるため、T5 で `migrations/0001_init.sql` が置かれるまでの間 T1 は空の `migrations/.gitkeep` を置く（git は空ディレクトリを追跡できないため）。
- 確認済み（T5。上記のストレージ分離の記述を訂正した）: D1 バインディングのストレージ分離はテストファイル単位で行われ、同じファイル内の複数の `it()` 間ではテーブルの中身が残る（別ファイルの `it()` からは見えない）。2 つの `it()` で一方が行を INSERT し、他方が件数を読むテストで実測して確認した。テーブル全体を走査する結合テスト（`clearExpiredSnapshots` や、`reports` を FK 経由で先に用意する `ReportRepository` のテストなど）は、対象テーブルを `beforeEach` で `DELETE FROM` してから始める。
- `test/integration/setup.ts`: `import { applyD1Migrations, env } from 'cloudflare:test'` と `import { beforeEach } from 'vitest'` で、`beforeEach(() => applyD1Migrations(env.DB, env.TEST_MIGRATIONS))`。`applyD1Migrations` は適用済みのマイグレーションを飛ばすので `beforeEach` でも二重適用にならない。
- `test/integration/env.d.ts`: 実機確認済み。上記と同じバージョンの型定義（`cloudflare-test.d.ts`）には設計時点で想定していた `cloudflare:test` モジュールの `ProvidedEnv` インターフェースが無く、`env` エクスポートは `wrangler types` が生成するグローバルな `Cloudflare.Env`（`worker-configuration.d.ts`）の型を持つ。そのため `declare module 'cloudflare:test' { interface ProvidedEnv extends Env {...} }` ではなく、`declare global { namespace Cloudflare { interface Env { RATE_LIMIT_PEPPER: string; REPORT_WEBHOOK_URL?: string; E2E_FIXED_NOW?: string; TEST_MIGRATIONS: D1Migration[] } } }`（`D1Migration` は `@cloudflare/vitest-pool-workers` が提供する型）で不足分だけをグローバル宣言にマージする形にした。
- `test/integration/helpers/jsonRequest.ts`: `export const TEST_ORIGIN = 'http://localhost:8787'`（`wrangler.jsonc` の `vars.PUBLIC_ORIGIN` と一致させる）と `jsonRequest(path, { method: 'POST' | 'PATCH', body: unknown, headers?: Record<string, string> }): Request`。`new URL(path, TEST_ORIGIN)` に `Origin: TEST_ORIGIN`・`Content-Type: application/json` を付け、`body` を `JSON.stringify` する。`headers` で上書きできる（`Origin` 不一致や `text/plain` のテスト用）。

**tsconfig**（base を 3 つのプロジェクトが継承する。`npm run typecheck` は 3 つを順に `tsc -p`）

```jsonc
// tsconfig.json（base。include を持たず、単体では使わない）
{
  "compilerOptions": {
    "strict": true, "module": "ESNext", "moduleResolution": "bundler", "target": "ES2022", "lib": ["ES2022"],
    "noEmit": true, "isolatedModules": true, "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx", "jsxImportSource": "hono/jsx"
  }
}
// tsconfig.core.json — core が DOM にも Workers にも依存しないことを型で保証する
{ "extends": "./tsconfig.json", "compilerOptions": { "types": [], "lib": ["ES2022", "WebWorker"] }, "include": ["src/core"] }
// tsconfig.server.json
{
  "extends": "./tsconfig.json",
  // cloudflare:test の型宣言は 0.22 では `@cloudflare/vitest-pool-workers` のルートエントリではなく
  // `/types` サブパス（types/cloudflare-test.d.ts）にある
  "compilerOptions": { "types": ["@cloudflare/vitest-pool-workers/types"] },
  "include": ["src/core", "src/ports", "src/adapters", "src/server", "worker-configuration.d.ts",
              "test/unit/core", "test/unit/adapters", "test/unit/server", "test/integration"]
}
// tsconfig.web.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": [], "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src/core", "src/web", "test/unit/web", "test/e2e"]
}
```

- `tsconfig.core.json` の `lib` に `WebWorker` を足すのは、core が使う `URL` `URLSearchParams` `TextEncoder` `crypto.subtle`（`core/google`・`core/token`）が `ES2022` の lib に無いため。`WebWorker` は `document` `window` を含まず、Workers 固有の型（`D1Database` 等）も含まないので「DOM にも Workers にも依存しない」保証は保たれる。確認済み（T1）: `tsc -p tsconfig.core.json` は通り、`src/core` に `document` や `process` `Buffer`（`@types/node` を入れた後も `types: []` のため）の参照を足すとエラーになる。`hono` の import は `tsc` ではなく ESLint の `no-restricted-imports` が検出する。
- `test/unit` は `web` 以下だけ `tsconfig.web.json`（DOM）側に入れる。`src/web/lib/*` の unit テストは DOM の型が要り、それ以外の unit テストは Workers の型で足りるため。
- `worker-configuration.d.ts` が無いと `tsconfig.server.json` が通らないので、`typecheck` は必ず `wrangler types` を先に走らせる。

**ESLint / Prettier**

- `eslint.config.js` は flat config。`@eslint/js` の `recommended` と `typescript-eslint` の `recommended`（`recommendedTypeChecked` は使わない。速度優先）。`ignores`: `dist/` `dist-worker/` `.wrangler/` `worker-configuration.d.ts` `.claude/`（作業用の一時ファイル置き場。`.claude/skills/` 以外は gitignore 済みだが、lint の対象探索からは `.claude/` ごと外す）。
- 全ファイルに `no-restricted-syntax` で次を禁止する（§9.1）: `MemberExpression[property.name='innerHTML']`、`MemberExpression[property.name='outerHTML']`、`CallExpression[callee.property.name='insertAdjacentHTML']`、`JSXAttribute[name.name='dangerouslySetInnerHTML']`、`Property[key.name='dangerouslySetInnerHTML']`。
- `@typescript-eslint/no-unused-vars` は `argsIgnorePattern: '^_'` にする。`routes/*.ts` は `Deps` を型で揃えるため使わない引数も受け取る規約（§11.5）があり、先頭 `_` の引数を未使用エラーの対象外にする。
- `src/core/**` に対して `no-restricted-imports` で相対パス以外の import を禁止する。確認済み（T1）: `group`（`ignore` パッケージ = gitignore 相当のグロブ）を使う `patterns: [{ group: ['**', '!./**', '!../**'] }]` は実装できなかった: `ignore` パッケージは `./x` のような相対パス文字列の否定パターン（`!./**`）を意図通りに除外せず、`./x` `../x/y` も一律に「制限対象」と判定してしまう（ESLint 10.10.0 + eslint 内蔵 `ignore` で実機確認）。代わりに `regex: '^(?!\\.\\.?/)'`（`./` `../` で始まらない import 指定子にだけマッチする正規表現）を使う `patterns: [{ regex: '^(?!\\.\\.?/)', message: 'core は相対 import のみ' }]` に変更した。`hono` の import はエラーになり、`./x` `../x/y` は通ることを確認済み。
- `.prettierrc`: `{ "semi": false, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }`。`.prettierignore`: `dist/` `dist-worker/` `.wrangler/` `worker-configuration.d.ts` `package-lock.json` `docs/`（実装時に追加。`docs/design.md` は手書きの日本語 Markdown で Prettier の整形結果と一致せず `prettier --check .` が赤くなるため。設計書自体を Prettier 対象にする意図は無かったと判断し除外した）。

**`scripts/build-web.mjs`**（後続 PR はこのファイルを変更しない）

1. `dist/` を空にする。
2. `src/web/*/main.ts` を glob してエントリにし、esbuild で `bundle: true, format: 'esm', target: 'es2020', minify: true, outdir: 'dist/assets/js', outbase: 'src/web', entryNames: '[dir]'` でビルドする（`src/web/create/main.ts` → `dist/assets/js/create.js`）。ファイル名にハッシュは付けない（`/assets/*` は `_headers` で `Cache-Control: public, max-age=300`）。エントリが 0 件（T1 時点）なら esbuild を呼ばない。
3. `src/web/styles/*.css` → `dist/assets/css/`、`src/web/img/*` → `dist/assets/img/` にコピーする。
4. `src/web/pages/*.html` と `src/web/{robots.txt,favicon.ico,_headers}` を `dist/` 直下にコピーする。ルートファイルは存在チェックをせず、欠けていれば `copyFile` の `ENOENT` でビルドが落ちる（`_headers` を静かに欠落させて CSP の無い `dist/` を作らないため）。

**`src/web` の雛形（T1）**

- `pages/{index,new,done,history,edit}.html`: `<!doctype html>` `<html lang="ja">` `<meta charset>` viewport `<title>` `<link rel="stylesheet" href="/assets/css/base.css">` と、画面ごとのエントリ `<script type="module" src="/assets/js/{create|done|history|edit}.js">`（`index` `new` は `create.js`）を持つ最小 HTML。`index` `new` は `<textarea id="input">` を含む。`done` `history` `edit` は `<meta name="robots" content="noindex, nofollow">` を含む。エントリの JS は T14〜T17 まで存在しないので `/assets/js/*.js` は 404 になるが、T1 の smoke はスクリプトに依存しない。インラインスタイル・スクリプトは書かない（§9.1）。
- `robots.txt`: `User-agent: *` / `Allow: /`（§9.5）。`favicon.ico`: 仮のアイコン。`img/ogp-fallback.png`: 1200×630 の仮 PNG（サービス名のテキストのみ。§14.2-2 のデザイン確定で差し替える）。`styles/base.css`: リセットと最小の余白、`<header class="app-header">` を持つ画面向けのヘッダ（`.app-header` `.app-title` `.history-link`。T17 で `create.css` から移動）。
- `_headers`（手書き。§9.1 の値と一致させ、T8 の unit テストで検査する）:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/done
  X-Robots-Tag: noindex, nofollow
/history
  X-Robots-Tag: noindex, nofollow
/edit
  X-Robots-Tag: noindex, nofollow
/assets/*
  Cache-Control: public, max-age=300
```

- `test/unit/web/headers.test.ts`（T1）は `import headersText from '../../../src/web/_headers?raw'`（Vite の raw import。型は `/// <reference types="vite/client" />`）で読み、上記の各パスに各ヘッダが載っていることを検査する。T8 の `test/unit/server/lib/headers.test.ts` は同じ読み方で「`_headers` の CSP / `X-Content-Type-Options` / `Referrer-Policy` の値 === `headers.ts` の定数」を検査する。

**`playwright.config.ts`**

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'test/e2e',
  use: { baseURL: 'http://localhost:8787' },
  webServer: {
    command: 'node scripts/seed-local-r2.mjs && npm run build && npx wrangler dev --port 8787',   // T10 で前置済み
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'line-ios',
      // iPhone 13 の既定は WebKit だが CI は chromium しか install しないので上書きする（isMobile / touch は Chromium でも効く）
      use: { ...devices['iPhone 13'], browserName: 'chromium', userAgent: `${devices['iPhone 13'].userAgent} Line/14.0.0` },
    },
  ],
})
```

- `test/e2e/fixtures.ts`: `@playwright/test` の `test.extend` で `page` を包み、`await page.clock.setFixedTime(E2E_FIXED_NOW)` を各テストの前に呼ぶ（`E2E_FIXED_NOW = new Date('2026-09-16T01:00:00Z')` を export）。`setFixedTime` は `Date` だけを固定しタイマーは動かすので、プレビューの 150ms デバウンス（§6.1）はそのまま動く。全 spec はこのファイルの `test` / `expect` を import する。
- `wrangler dev` は `.dev.vars` を読む。CI では e2e の前に `cp .dev.vars.example .dev.vars` する（下記）。

**`.github/workflows/ci.yml`**（`pull_request` と `push: main` で起動）

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version-file: .nvmrc, cache: npm }
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm run test:unit
- run: npm run build
- run: npm run test:integration
- run: npx wrangler deploy --dry-run --outdir dist-worker   # 未ログインで通る（T1 で確認済み）
- run: npx playwright install --with-deps chromium
- run: cp .dev.vars.example .dev.vars
- run: npm run test:e2e
  timeout-minutes: 15
```

確認済み（T1。設計時点の順序と食い違ったため入れ替えた）: `test:integration` は `env.ASSETS.fetch()` で Static Assets（`wrangler.jsonc` の `assets.directory: ./dist`）を検証するため、`dist/` がビルド済みであることに依存する。クリーンチェックアウト直後（`npm run build` 未実行）に `test:integration` を先に走らせると `dist/` が空で 404 になることを実機確認したため、`npm run build` を `test:integration` より前に実行する順序に変更した。

**`.gitignore`**（T1 で Next.js テンプレートから書き換える）: `node_modules/` `dist/` `dist-worker/` `.wrangler/` `.dev.vars` `worker-configuration.d.ts` `test-results/` `playwright-report/` `coverage/` `.DS_Store`。`.claude/` は `/.claude/*` + `!/.claude/skills/` にし、プロジェクトスキル（`.claude/skills/`）だけリポジトリで共有する。

---

## 12. 実装タスク分解（PR 単位）

- 各 PR は単独でビルド・lint・該当レイヤのテストが通る。
- 依存は base branch で表す（直列チェーン）。T1 は `main` から切り、T2 以降は直前の PR のブランチを base にする。前の PR がマージされたら base を `main` に付け替える。
- 担当ファイルは PR 間で重複させない（§11.6）。例外は次の 4 つ。(1)〜(3) は「1 行追加」または「雛形を埋める」だけ、(4) は次に挙げる 2 種類だけを許す: (1) `server/app.ts` `server/deps.ts` `server/index.ts` へのルート／アダプタ／`scheduled` の配線、(2) T1 が最小の雛形（§11.7）として置く `src/web/pages/*.html` を T14〜T17 が埋める、(3) `wrangler.jsonc` への `crons`（T13）、`playwright.config.ts` の `webServer.command` への `seed-local-r2.mjs` の前置（T10）、`vitest.config.ts` への project 追加（T10、wasm が pool-workers で動かない場合のみ）、(4) 他 PR が定義した関数を export に変える 1 行（T17 の `readHistory`）、複数画面で共通のスタイルルールを画面固有の CSS から `base.css` に切り出す（T17 の `.app-header` 等、追加と削除の対で閉じた変更）。`scripts/build-web.mjs` は `src/web/*/main.ts` を glob するので、エントリを足す PR がこれを触ることはない。触れた PR は該当行にその旨を記録する。
- 「完了条件」に `wrangler deploy --dry-run` が含まれる PR は、スクリプトサイズ（gzip 後）を PR 説明に記録する。
- 「要検証」の項目はその PR の完了条件に検証結果の記録を含める。

| ID | ブランチ | タイトル | 依存 | 主なファイル | テスト観点 | 完了条件 |
|---|---|---|---|---|---|---|
| T1 | `feat/scaffold` | chore: 足場（wrangler / Hono / テスト 3 層 / CI / 共有型・定数・ポート・Fake。構成は §11.7） | — | `wrangler.jsonc` `package.json` `package-lock.json` `.nvmrc` `.gitignore` `.dev.vars.example` `tsconfig.json` `tsconfig.{core,server,web}.json` `eslint.config.js` `.prettierrc` `.prettierignore` `migrations/.gitkeep`（`readD1Migrations('migrations')` が存在しないディレクトリで例外を投げるため。`migrations/0001_init.sql` 自体は T5 が置く） `vitest.config.ts` `playwright.config.ts`（`chromium` + `line-ios` の 2 プロジェクト）`.github/workflows/ci.yml` `scripts/build-web.mjs` `src/core/config/*` `src/core/types.ts` `src/core/api/types.ts` `src/core/time/jst.ts` `src/core/id/types.ts`（`ports/idGenerator.ts` の re-export 先。§11.4 の時点で `core/id/types.ts` への依存が生じるが、`crockford.ts` は T3 の担当のままなので `types.ts` だけ先に置く。実装時に判明した §11.1 / §12 の食い違いの是正） `src/ports/*`（`reportRepository.ts` を含む）`src/server/{index,app,env,deps}.ts` `src/server/routes/health.ts` `src/server/lib/notWired.ts` `src/adapters/clock/*` `src/adapters/logger/consoleLogger.ts` `src/adapters/ogp/fakeOgpRenderer.ts` `src/adapters/notifier/fakeNotifier.ts` `src/adapters/memory/memoryReportRepository.ts` `src/web/pages/*.html`（§11.7 の最小雛形）`src/web/_headers` `src/web/styles/base.css` `src/web/{robots.txt,favicon.ico}` `src/web/img/ogp-fallback.png` `test/unit/core/time/*` `test/unit/core/types.test.ts` `test/unit/adapters/logger/*` `test/unit/adapters/memory/memoryReportRepository.test.ts`（テスト観点に `memoryReportRepository` の `'inserted'`/`'duplicate'` が挙げられているにもかかわらず本節のファイル一覧に無かったため追加） `test/unit/web/headers.test.ts` `test/integration/{setup.ts,env.d.ts}` `test/integration/helpers/jsonRequest.ts` `test/integration/helpers/jsonRequest.test.ts` `test/integration/server/{health,staticAssets}.test.ts` `test/unit/server/deps.test.ts` `test/unit/server/lib/notWired.test.ts` `test/e2e/fixtures.ts` `test/e2e/smoke.spec.ts` | unit: `jst.ts` の変換・整形（`formatDateLabel` が「19:00〜20:00」形式）・`addMonths` の月末境界。`toEventFieldsJson` / `fromEventFieldsJson` の往復と不正入力。`consoleLogger` が `Error` を `{ name, message }` に正規化し message を 200 文字で切る。`_headers` に §11.7 の各パス・各ヘッダが載っている。`memoryReportRepository` の `'inserted'` / `'duplicate'`。`buildDeps` の `clock`（`E2E_FIXED_NOW` なし・`localhost` + `E2E_FIXED_NOW`・非 `localhost` + `E2E_FIXED_NOW` で warn）。`notWired` がどのメソッド呼び出しでも `not wired: <name>` を投げる。integration: `GET /api/health` が 200 で `{ ok: true }`・`Cache-Control: no-store`。**`env.ASSETS.fetch('/')` が静的 HTML を返す（pool-workers の Static Assets 対応。`SELF.fetch` は Worker の手前の Static Assets ルーティング層を経由しないため使わない。確認済み〈T1〉、詳細は §10.2）**。`env.ASSETS.fetch('/done')` のレスポンスに CSP・`X-Content-Type-Options`・`X-Robots-Tag` が付く（`_headers`。確認済み〈T1〉）。`jsonRequest` が `Origin` と `Content-Type` を付ける。e2e: 固定時刻（§10.3）の下で `/` が 200 で `textarea` がある（`chromium` `line-ios` の両方） | `npm run lint/typecheck/test:unit/test:integration/test:e2e` が全部通り、CI が green。`tsc -p tsconfig.core.json` が通り、`src/core` に `document` の参照を足すとエラーになる（確認済み〈T1〉。`hono` の import は tsc ではなく ESLint の `no-restricted-imports` が検出する。§11.7 の ESLint の項を参照）。`wrangler deploy --dry-run --outdir dist-worker` が未ログイン・プレースホルダ `database_id` で通る（確認済み〈T1〉、§11.7 参照）。`compatibility_flags` の `nodejs_compat` の要否と、`test.projects` 内で pool-workers の Vite プラグイン（`cloudflareTest`）が動くかを記録（確認済み〈T1〉。§11.7 参照）。ESLint で `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `dangerouslySetInnerHTML` と、`src/core` からの相対パス以外の import が禁止されている。`vitest` `wrangler` `@cloudflare/vitest-pool-workers` `hono` `typescript` `esbuild` の解決済みバージョンを PR 説明に記録。`_headers` と Static Assets はいずれも pool-workers で動作確認済み（§10.2）|
| T2 | `feat/core-parse` | feat: 日時パーサ（1 行目の解釈）と URL 判定 | T1 | `src/core/text/urlPattern.ts` `src/core/parse/*` `test/unit/core/{text,parse}/*` | §5.6 の基本 71 ケースを `test.each` で、追加の 22 ケース（#72〜#93、レビュー対応）を個別のテストで検証する。正規化（`．` を含む）・ストップリスト・URL 分離の個別テスト。`URL_PATTERN` の 3 形式（scheme / `www.` / ベアドメイン）と非該当（`9.20`、`hxxps://`、`hxxp://www...`、`example.company`）。ベアドメインの末尾ラベル条件（§5.2）: `Node.js 勉強会` は URL 0 本、`example.com` `example.co.jp` `example.xyz/path` は 1 本。**2,000 文字の繰り返し入力（`9/` × 1000、`〜` × 2000、`http://` × 200、`a.` × 1000、`-.` × 1000）が 50ms 以内に返る** | 表が全部 green。`parseEventText` が同期・純粋で `core/` 外を import しない |
| T3 | `feat/core-rules` | feat: 保持期限・ID・トークン・検証・プリフィル・インタープリタ境界 | T2 | `src/core/retention/*` `src/core/id/crockford.ts`（`id/types.ts` は T1 が置く済み） `src/core/token/*` `src/core/validate/*` `src/core/prefill/*` `src/core/interpret/*` `src/core/change/*` `src/adapters/id/*` `test/unit/core/{retention,id,token,validate,prefill,interpret,change}/*` | 13 ヶ月ちょうど／+1 秒、下書き（`baseDate` 基準）。ID が 12 文字・許可文字のみ・予約パスと不一致（1 万件生成）。`isValidPageId` が `//example.com` `%2F%2F` 11 文字・13 文字・大文字を拒否。トークン 43 文字。§5.7 の各エラーコード（`mode: 'update'` で日時不変なら終了後でも ok、日時を過去に変えると `PAST_EVENT`）。`countUrls` が `URL_PATTERN` と一致。§5.8 の優先順位。`buildChangeSnapshot`: メモだけの変更は null、日時だけの変更は変更前の日時 + `titleChanged = locationChanged = false`、タイトルだけの変更は `titleChanged = true` で日時は変更前の値（§3.5） | 全 unit green。`calculateExpiresAt` の戻り値が非 null の `Date` |
| T4 | `feat/core-calendar` | feat: ics ビルダーと Google カレンダー URL | T3 | `src/core/ics/*` `src/core/google/*` `test/unit/core/{ics,google}/*` | 終日／時刻あり／年またぎ、エスケープ（`\r\n` 正規化、`\rATTACH:` を含む title が 1 行のまま、C0 制御文字の除去）、日本語混在の 75 オクテット折り返し（継続行のスペース込み）、`sanitizeIcsText` が SUMMARY / LOCATION / DESCRIPTION の URL を「[リンク]」に置換し自ドメイン 1 本だけ残る、`ORGANIZER` `ATTENDEE` `ATTACH` `X-ALT-DESC` が出力に無い、`PRODID` の形式、`SEQUENCE`。Google: `ctz`、`dates` を URL パースで検証、`details` の 500 文字切り詰めと末尾の詳細 URL | §7.1 / §7.2 の表を満たす。折り返しがマルチバイト境界で切れない |
| T5 | `feat/d1-repository` | feat: D1 スキーマと PageRepository（本物 + インメモリ） | T4 | `migrations/0001_init.sql` `src/adapters/d1/{d1PageRepository,d1ReportRepository}.ts` `src/adapters/memory/memoryPageRepository.ts` `test/integration/adapters/{pageRepository,reportRepository}.test.ts` | create（`source` `creator_*` が入る、`events` の INSERT 失敗で `pages` も残らない）/ findById / update（`status` `report_count` 不変、`previousSnapshot` に日時のみ）/ incrementReportCount / countActiveByCreator / listExpired / deleteByIds（CASCADE、**101 件以上**）/ clearExpiredSnapshots。`events` 2 行で InvariantViolation。`ReportRepository.insertIfNotDuplicate`: 初回は `'inserted'`、同一 `ip_hash`・同一ページで `dedupeSince` 以降に既にあれば `'duplicate'` で行が増えない、別ページ・`dedupeSince` より前なら `'inserted'`。同じスイートを D1 と memory（`memoryReportRepository` は T1 のもの）の両方に流す | integration green。`wrangler d1 migrations apply --local` が通る（`window_kind` 列名で構文エラーが出ない） |
| T6 | `feat/adapters-storage-ratelimit` | feat: R2 ObjectStorage とレート制限（本物 + インメモリ） | T5 | `src/adapters/r2/r2ObjectStorage.ts` `src/adapters/memory/{memoryObjectStorage,memoryRateLimiter}.ts` `src/adapters/d1/d1RateLimiter.ts` `src/server/lib/{ipHash,deviceCookie}.ts` `test/integration/adapters/{objectStorage,rateLimiter}.test.ts` `test/unit/server/lib/*` | put/get ics（`ics/{id}.ics` の上書き）・ogp・失敗マーカー（TTL 経過で false）・deleteAllForPage・getFont。固定窓の境界（時／日の切り替わり）、ip と device の独立、**上限超過後は行が増えない**、`deleteExpired`。`ipHash`: HMAC で決定的、IPv6 の /64 丸め（同一 /64 は同じ、別 /64 は異なる）、IPv4-mapped、IP 無しで `ip:unknown`。Cookie 属性 | integration green（両実装） |
| T7 | `feat/api-create` | feat: 作成 API（POST /api/pages）とレート制限・同一オリジン・JSON ミドルウェア | T6 | `src/server/routes/apiPages.ts`（POST のみ）`src/server/middleware/{rateLimit,sameOrigin,jsonBody}.ts` `src/server/lib/{errors,ics}.ts` `src/server/deps.ts`（`notWired` を本物のアダプタに差し替え、Fake はそのまま）`src/server/app.ts`（1 行）`test/integration/server/{apiPages.create,sameOrigin}.test.ts` | 正常系（D1 2 行・`source` `creator_*`・R2 `ics/{id}.ics`・レスポンス形・Set-Cookie）、§5.7 の各 400（`source` 不正は `INVALID_REQUEST`）、`text/plain` は 415、`Origin` 不一致 / `Sec-Fetch-Site: cross-site` は 403（D1 に書かれずカウンタも進まない）、検証順序（`MAX_BODY_BYTES` 超過・`MAX_INPUT_LENGTH` 超過でレート制限カウンタが進まない）、下書き作成（R2 に ics を置かない）、ID 衝突時の再採番、429（IP 側／device 側それぞれ）、`events` 不変条件 | integration green。`POST` から `url` `editToken` `expiresAt` が返る |
| T8 | `feat/detail-page` | feat: 詳細ページ SSR（Cache API・noindex・セキュリティヘッダ） | T7 | `src/server/routes/detail.tsx` `src/server/views/{Layout,DetailPage,NotFound}.tsx` `src/server/lib/{edgeCache,headers,pageAccess}.ts`（`headers.ts` は CSP 等の定数）`src/server/middleware/securityHeaders.ts` `src/server/app.ts`（1 行）`test/unit/server/lib/headers.test.ts` `test/integration/server/{detail,securityHeaders}.test.ts` | §6.3 の順序（DOM を解析して検証）、OGP メタ（`og:image` に `?v={version}`、絶対 URL が `publicOrigin` 由来）、`hidden`／期限切れ／不正 ID の 404（`isServable`）、XSS 回帰（`<script>` を含むタイトルがエスケープされる）、メモの改行と非リンク化、Cache API の hit（`?x=1` `?x=2` でも D1 は 1 回）、CSP 文字列の固定・Referrer-Policy・X-Robots-Tag、unit: `src/web/_headers` の CSP / `X-Content-Type-Options` / `Referrer-Policy` の値が `headers.ts` の定数と一致（§9.1）、変更バナー（日時の差分のみ。旧タイトル・旧場所が DOM に無い）の 48 時間境界、免責の位置（未編集はフッターのみ、編集済みはボタン直下にも）、発行者スロットが空で DOM に出ない | integration green |
| T9 | `feat/ics-route` | feat: ics 配信（GET /:id.ics） | T8 | `src/server/routes/ics.ts` `src/server/app.ts`（1 行）`test/integration/server/ics.test.ts` | 正規表現ルートで `.ics` が必須（`/:id.ics` 以外は詳細ページに落ちない）、`text/calendar`、本文が現在の内容、`X-Robots-Tag`、不正 ID・hidden・期限切れの 404、下書き（日時なし）は 404、Cache API。**自己修復**: R2 に ics が無い `isServable` なページで `GET /:id.ics` が `buildIcsForPage` の出力を 200 で返し、R2 に `ics/{id}.ics` が PUT されている（2 回目は再生成しない） | integration green |
| T10 | `feat/ogp` | feat: OGP 画像の遅延生成（satori/standalone + resvg-wasm、R2 フォント、フォールバック） | T9 | `src/adapters/ogp/{satoriOgpRenderer,ogpTemplate}.ts` `src/server/routes/ogp.ts` `src/server/lib/assets.ts` `src/server/app.ts`（1 行）`src/server/deps.ts` `scripts/seed-local-r2.mjs`（`scripts/fonts/subset.sh` は既存を再利用し新規作成しない）`playwright.config.ts`（`webServer.command` に seed を前置、1 行）`wrangler.jsonc`（`.otf` を Data モジュールとして import するテスト専用の `rules` 追加。§11.6 の共有ファイル一覧に無い例外、本文で理由を記録）`test/fixtures/fonts/*`（サブセット OTF と `OFL.txt`）`test/integration/server/ogp.test.ts` `test/integration/ogp/satoriOgpRenderer.test.ts` `test/unit/adapters/ogp/ogpTemplate.test.ts` | Fake レンダラで「初回のみ生成」「`waitUntil` 後に R2 にある」「throw 時はフォールバック PNG（ASSETS を包み直して `Cache-Control` 付き）と失敗マーカー」「マーカーがあればレンダラを呼ばない」「hidden はフォールバック」。本物で日本語を含む PNG が返る（PNG シグネチャ・サイズ 1200×630、IHDR を実際に検証）。**未収録文字（絵文字・第 1 水準外の漢字）を含む入力でも例外にならず PNG が返る**。title に `<script>` `&` `"` を含めても satori が生成する SVG 文字列自体にその文字列が現れない（PNG バイト列ではなく SVG を直接検証）。テンプレートに固定文言とサービス名が含まれることをテンプレートの出力を走査して確認する | integration green。`wrangler deploy --dry-run` で gzip 後サイズが 10MB 未満（PR 説明に記録）。フォント読み込みが R2 経由で `scripts/fonts/subset.sh` で生成したフォントで PNG が返る。**`wrangler dev` の起動と初回リクエストが通る（トップレベルで wasm 初期化をしない）**。1 回の render の CPU 時間（フォントパース込み）とフォントの再パース有無を実測して PR 説明に記録 |
| T11 | `feat/api-edit` | feat: 編集 API（GET/PATCH /api/pages/:id）と編集画面の配信 | T10 | `src/server/routes/apiPagesEdit.ts` `src/server/routes/editPage.ts` `src/server/app.ts`（2 行）`test/integration/server/{apiPagesEdit,editPage}.test.ts` | Bearer 一致で 200・不一致 401・欠落 401、hidden／期限切れは 404、`version` +1、`previous_snapshot`（日時のみ）／`changed_at`（タイトル・日時・場所の変更時のみ）、`expires_at` 再計算（日時を消した下書きは `now + 7 日`）、R2 の ics が新 `SEQUENCE` で上書き、終了済みイベントのメモだけの編集は 200、日時を過去に変えると 400、`status` `report_count` 不変、`GET` のレスポンスに `rawText` が入る（`GetPageResponse`）、同一ページへの 2 連続 PATCH が両方 200（最後の保存が勝つ）、**`GET /:id/edit` が 200 で HTML 本文を返す（3xx でない）** かつ `X-Robots-Tag` 付き、不正 ID は 404 | integration green |
| T12 | `feat/reports` | feat: 通報（フォーム・API・Webhook 通知） | T11 | `src/server/routes/{apiReports.ts,reportPage.tsx}` `src/server/views/ReportPage.tsx` `src/adapters/notifier/webhookNotifier.ts` `src/web/report/main.ts` `src/core/config/limits.ts`（`REPORT_COUNT_WARNING_THRESHOLD` `WEBHOOK_FETCH_TIMEOUT_MS` を追記） `src/server/app.ts`（2 行） `src/server/deps.ts`（1 行）`test/integration/server/reports.test.ts` `test/unit/adapters/notifier/*` | 通報で `reports` 1 行（`deps.reports.insertIfNotDuplicate`）・`report_count` +1・Fake Notifier が `activePagesFromSameCreator` 付きで呼ばれる、`reason` 不正は 400、`comment` 501 文字は 400、同一 ip_hash の 24 時間重複は無視、429、`text/plain` は 415、`Origin` 不一致は 403 で `reports` に入らない、hidden／期限切れは 404、Webhook 失敗でも 200、フォームの noindex とインラインスクリプト無し。unit: `webhookNotifier` の payload で `@everyone` と `https://` が無効化され（Discord: `allowed_mentions` とコードブロック、Slack: エスケープと `mrkdwn: false`）、コメントが 200 文字に切られ、URL は詳細ページの 1 本だけ。Webhook 種別が URL のホストで決まる（`discord.com` / `discordapp.com` → Discord、`hooks.slack.com` → Slack、未知のホストは送らず warn。§9.4） | integration green |
| T13 | `feat/gc-cron` | feat: 保持期限切れの GC（Cron Trigger） | T12 | `src/server/scheduled/gc.ts` `src/server/index.ts`（`scheduled` 配線）`wrangler.jsonc`（`crons`）`test/integration/scheduled/gc.test.ts` | 期限切れが D1・R2（`ics/{id}.ics` と `ogp/{id}/*`）から消え有効なものは残る、ちょうど期限の境界、バッチ繰り返し（101 件以上）、`rate_limit_counters` の掃除、48 時間より古い `previous_snapshot` の NULL 化、ログの件数 | integration green |
| T14 | `feat/web-create` | feat: 作成画面（textarea・ライブプレビュー・タップ編集・プリフィル・流入元） | T13 | `src/web/pages/{index,new}.html` `src/web/create/*` `src/web/lib/{history,api,dom}.ts` `src/web/styles/create.css` `test/e2e/create.spec.ts` | e2e §10.3 の 1・4（「自動に戻す」と「空にすると使わない」）・5・6・11・12（`source` が `prefill` / `detail_cta` / `direct` で送られる。リクエスト本文を Playwright で捕捉）。`core/` バンドルがブラウザで動く。プレビューが `TextInterpreter` 経由で呼ばれる（unit 相当の e2e ではなくコードレビューで確認） | e2e green。`npm run build` の `dist/assets/js/create.js` が 60KB（gzip）以下。HTML にインラインスタイル・スクリプトが無く、アセット参照が絶対パス |
| T15 | `feat/web-done` | feat: 完成画面（コピー・LINE・共有）と LINE / Android 向け JS | T14 | `src/web/pages/done.html` `src/web/done/main.ts` `src/web/lib/{clipboard,share,lineUa}.ts` `src/web/detail/main.ts` `src/web/styles/{done,detail}.css` `src/core/config/limits.ts`（`COPY_MESSAGE_DURATION_MS` を追記） `test/e2e/{done,line,redirect}.spec.ts` `test/unit/web/lib/{clipboard,share,lineUa}.test.ts` | e2e §10.3 の 1（コピー）・2・3・10・13。`navigator.share` 非対応時にボタンが出ない。直リンク時に `/:id` へ遷移、不正 `id` は `/` へ。Google リンクが履歴の `fields` から組める。「送り直してください」は `version > 1` のときだけ。`openExternalBrowser=1` が `searchParams.set` で付き `action=TEMPLATE` が壊れない | e2e green |
| T16 | `feat/web-edit` | feat: 編集画面（localStorage のトークンで編集） | T15 | `src/web/pages/edit.html` `src/web/edit/main.ts` `src/web/styles/edit.css` `test/e2e/edit.spec.ts` `test/unit/web/lib/{api,history}.test.ts`。`src/web/lib/api.ts` `src/web/lib/history.ts` は T14 が置いたファイルで、`getPage` / `updatePage` は T14 時点で既にある。本タスクの担当ファイルとして割り当てられており、`api.ts` は `ApiRequestFailedError` の message を作成専用の文言から呼び出し元が操作名を渡せる形に汎用化し、`history.ts` に編集完了時専用の `updateHistoryEntry`（fields / expiresAt / updatedAt / version だけを差し替え、並び順は変えない。§6.4）を追加した | e2e §10.3 の 7・8。保存後に `/done` 再掲、履歴の `fields` `updatedAt` `version` の更新。`pathname` の `id` が不正なら `/` へ | e2e green |
| T17 | `feat/web-history` | feat: 作成履歴画面 | T16 | `src/web/pages/history.html` `src/web/history/main.ts` `src/web/styles/history.css` `src/web/lib/history.ts`（`readHistory` を export に変更。元は T14 が private で定義） `src/web/styles/base.css`（`.app-header` `.app-title` `.history-link` を追加）`src/web/styles/create.css`（同 3 ルールを削除。§12 冒頭の例外(4)） `test/e2e/history.spec.ts` | 作成後に一覧に出る、期限切れのグレー表示、空状態の文言、localStorage に不正な `id` を仕込んでもリンクが生成されない | e2e green |
| T18 | `feat/observability` | feat: 構造化ログとリクエストログミドルウェア | T17 | `src/server/lib/logger.ts` `src/server/middleware/requestLog.ts` `src/server/app.ts`（`requestLog` の登録と `app.onError` の 2 箇所。後者は Hono の既定 errorHandler の `console.error(err)` を構造化ログに置き換えるために追加）`src/server/routes/apiPages.ts`（1 行。作成成功時に `page_created` を出す）`test/integration/server/requestLog.test.ts` | §9.6 の表: ログに生 IP・トークン・クエリ・本文が出ない（`console.log` をスパイ）、ルート名と所要時間が出る、作成ログに `source` が出る、429 のログに `exceeded` のバケット種別が出る、catch していないルートの例外は `app.onError` 経由で `unhandled_error`（`{ name, message }` に正規化、生のスタックトレースは出さない）として残る | integration green |
| T19 | `feat/e2e-finish` | ci: e2e 一式の仕上げと CI の安定化 | T18 | `test/e2e/{report,full}.spec.ts`（シナリオ 9・14 と通しシナリオ）、`test/e2e/create.spec.ts` への不足分の追記（シナリオ 4・6 の詳細ページ側）、`test/e2e/fixtures.ts`（レート制限を避ける salt、`DONE_URL_PATTERN`・`createPage`・`waitForCreateRequest` の共通化）、`playwright.config.ts`、`.github/workflows/ci.yml` | §10.3 の全シナリオが CI で安定して green（3 回連続。時刻固定 §10.3 により実日付に依存しない）。シナリオ 7 の「同じ URL を送り直してください」・詳細ページの「最終更新」は version 判定により固定時計の下でも `test/e2e/edit.spec.ts` で固定済み（§10.3 シナリオ 7 参照）。履歴 `updatedAt` の上書き自体は `test/unit/web/lib/history.test.ts` で検証済みだが、固定時計の下で値が進むことは e2e では検証しない | CI green。`deploy.yml` は運用基盤の PR で作成済み（§13・§10.5）なので T19 はこれを作らない。main マージ後に `DEPLOY_ENABLED` が true なら `wrangler d1 migrations apply --remote` → `wrangler deploy` が走る（初回は §13 の人間作業が前提）。**初回デプロイが起動時間制限（400ms）で失敗しないことを確認**し、失敗したら §2.5 の wasm 初期化を見直す |

並列に着手したい場合: T2〜T4（core）は互いにファイルが重ならないので、同時に着手して T2 → T3 → T4 の順にスタックできる。T14〜T17（web）も同様。ただし base は常に直前の PR にし、ダイヤモンドを作らない。

---

## 13. 人間（リポジトリオーナー）にしかできない作業

H1〜H14 の運用手順は docs/runbooks/README.md にまとめてある。各項目の手順書・スクリプト・
ワークフロー名は「自動化」列を参照。方針は「エージェントが土台を作り、オーナーは承認と判断
だけを行う。同じ作業が再発してもスクリプト・ワークフロー・スキルのいずれかが先に動く」
（docs/runbooks/README.md の方針をそのまま踏襲する）。

| # | 作業 | なぜ人間が必要か | 自動化（準備済みの土台 / オーナーに残る最小の作業） | ブロックするタスク |
|---|---|---|---|---|
| H1 | サービス名と独自ドメインの決定・取得 | ブランディング判断（concept §10）であり支払いを伴う契約行為。`PUBLIC_ORIGIN`・ics の UID ドメイン・OGP のサービス名表記に使う | 土台: `docs/runbooks/naming.md`（候補17件の比較・ドメイン確認・J-PlatPat 手順）、`scripts/check-domain.mjs`、`docs/runbooks/rename.md` + `scripts/apply-service-name.mjs`（反映を自動化）。残る作業: 候補の絞り込み、商標検索、ドメインの購入（本人認証・支払い）、`apply-service-name.mjs` の実行と PR マージ | T19（本番デプロイ）。開発中は `calshare.example` の仮値で進める |
| H2 | Cloudflare アカウント作成と **Workers Paid（$5/月）** の契約 | 決済情報の入力はレジストラ・アカウント登録と同様に本人認証を伴う契約行為 | 土台: concept.md §09 への「Phase 1 の固定費は Workers Paid $5/月のみ」の追記は反映済み。`docs/runbooks/provisioning.md` が契約後の手順を全部引き継ぐ。残る作業: アカウント作成と Paid プランへの契約そのもの（1 回） | T19 |
| H3 | ドメインの DNS を Cloudflare に移管（ゾーン作成）し Worker にカスタムドメインを割り当てる | レジストラ側のネームサーバー変更は本人認証が要る。Cache API はカスタムドメイン配下でのみ効く（§1.2）。`*.workers.dev` を閉じるのは §9.9 | 土台: `scripts/cf/ensure-zone.mjs`（ゾーン作成）・`scripts/cf/ensure-waf-rate-limit.mjs`（H13 も同時に自動実行）・`scripts/cf/write-wrangler-domain.mjs`（`routes`・`workers_dev: false` を書き換える PR を自動作成）、`.github/workflows/provision.yml` の `zone_and_waf` ジョブ、`docs/runbooks/custom-domain.md`。残る作業: レジストラでのネームサーバー設定、ゾーンが `active` になるまでの再実行、自動作成された PR のレビューとマージ | T19 |
| H4 | `wrangler login` と D1 データベース・R2 バケットの本番作成、`wrangler.jsonc` のプレースホルダ `database_id`（§11.7）の置換 | 課金主体のリソース発行は運用者の承認の下で行う | 土台: `scripts/cf/ensure-resources.mjs`（作成 or 流用し `wrangler.jsonc` を書き換える PR を自動作成）、`.github/workflows/provision.yml` の `resources` ジョブ。残る作業: 自動作成された PR（`chore/provision-ids`）のレビューとマージ、初回のみ「Allow GitHub Actions to create and approve pull requests」の設定 | T19 |
| H5 | Cloudflare API トークン（Workers / D1 / R2 の編集権限）の発行と GitHub Secrets（`CLOUDFLARE_API_TOKEN` `CLOUDFLARE_ACCOUNT_ID`）への登録 | トークン発行はダッシュボード操作で本人認証が要り、最小権限スコープの選定はオーナー権限が必要 | 土台: `docs/runbooks/cloudflare-api-token.md`（権限テンプレート）、`scripts/cf/set-github-secrets.sh`（対話的に 1 回登録）、`scripts/cf/check-token.mjs`（`provision.yml` の `preflight` が実行のたびに自動検証）。残る作業: トークンの発行そのもの、`set-github-secrets.sh` の実行（1 回） | T19 |
| H6 | `RATE_LIMIT_PEPPER` の生成と `wrangler secret put` | シークレットの生成・登録は権限分離のため人間の承認下で行う | 土台: `scripts/cf/ensure-secret.mjs`。`deploy.yml` が初回デプロイ直後に自動登録し、`provision.yml` の `secrets` ジョブが再実行時に登録済みであることを確認する。残る作業: なし（完全自動化。H9 のデプロイ承認に含まれる） | T19（ローカルは `.dev.vars` で任意の値） |
| H7 | Discord または Slack の通報通知チャンネル作成と Incoming Webhook URL の発行、`REPORT_WEBHOOK_URL` の登録 | 通知先ワークスペースの管理権限が要る | 土台: `scripts/cf/ensure-secret.mjs --force`（`provision.yml` の `secrets` ジョブと `deploy.yml` の両方から登録できる）。残る作業: Webhook URL の発行そのもの（管理者権限操作）と GitHub Secrets への登録（1 回）。任意だが、未設定のまま公開すると通報が誰にも届かないので公開前の登録を推奨 | —（任意。T12 は Fake で完結） |
| H8 | OGP 用フォント（Noto Sans JP、SIL OFL）のライセンス確認と、サブセットフォントの本番 R2 への配置 | ライセンス遵守の責任は人間が持つ | 土台: `scripts/fonts/{download-noto-sans-jp,generate-jis-level1}.mjs` + `scripts/fonts/subset.sh`、`.github/workflows/provision.yml` の `font` ジョブ（取得・サブセット化・R2 配置と fonttools のインストールまで自動）、`docs/runbooks/fonts.md`、`docs/licenses/noto-sans-jp.md`（ライセンス審査記録）。`font` ジョブは著作権表示入りの `OFL.txt` も R2 の `fonts/` に置く。サブセットは JIS 第 1 水準のみで確定（§2.5、`docs/licenses/noto-sans-jp.md`。第 2 水準の字は OGP 上で空白になる制限を受け入れる）。残る作業: `docs/licenses/noto-sans-jp.md` の審査記録を読んで承認する（異論があれば第 2 水準の追加を Issue #9 で依頼する） | T19（ローカルは `scripts/seed-local-r2.mjs`） |
| H9 | 初回の本番デプロイ承認と公開判断 | 公開はプロダクトオーナーの意思決定そのもの | 土台: `.github/workflows/deploy.yml` の `gate` ジョブ（`DEPLOY_ENABLED` の確認のみ）、`docs/runbooks/deploy.md`。承認後は build・マイグレーション・デプロイ・`RATE_LIMIT_PEPPER` 登録まで全自動。残る作業: `PUBLIC_DOMAIN` の設定と `DEPLOY_ENABLED=true` にする決定（1 回の変数設定 2 つ） | — |
| H10 | 利用規約・プライバシーポリシー・通報ポリシーの文言承認と `/` への掲載 | 法的文言の責任は運用者本人に帰属する | 土台: `docs/legal/{terms,privacy,report-policy}.md`（実装仕様に基づくドラフト）、`scripts/legal/apply-legal-values.mjs`（施行日・運営者・管轄裁判所を一括反映）、`scripts/legal/checkLegalDocs.mjs --strict`（掲載可否の機械検査）、`docs/runbooks/legal.md`。残る作業: 施行日・運営者表記・管轄裁判所の決定、`.claude/skills/legal-review` の指摘を読んだ上での内容承認（掲載 HTML 化は実装 PR 側の作業） | — |
| H11 | 通報の一次対応（通知を見て `status='hidden'` にする。スパム波は同一送信元を一括非表示）の運用 | 自動非表示を持たない設計（§9.4）なので、通報 1 件ごとの継続的な人間の判断が要る | 土台: `.github/workflows/moderation.yml`（`hide` / `unhide` / `hide-by-creator` を 1 回の実行で処理し、対象件数・id 一覧を Issue に記録）、`scripts/cf/moderation-sql.mjs`、`docs/runbooks/moderation.md`、`.claude/skills/moderation-triage`（判定の下書き）。残る作業: 通報ごとの hide / unhide / 維持の判断そのもの（設計上、自動化しない） | — |
| H12 | Cloudflare の Usage を定期確認し、込み枠の 8 割に達したら §14 の対応を判断 | 課金に関わる判断 | 土台: `.github/workflows/usage-report.yml`（毎週自動実行し、しきい値超過時だけ Issue を作成）、`scripts/cf/usage-report.mjs`、`docs/runbooks/usage.md`。残る作業: 通常は無し。しきい値超過の Issue が来たときだけ対応方針を判断する | — |
| H13 | Cloudflare WAF のレート制限ルール（`/api/*` へのエッジ側制限）の作成 | Free プランの制約（period は 10 秒単位）に合わせた値をどこまで許容するかの判断（§9.3 の保険） | 土台: `scripts/cf/ensure-waf-rate-limit.mjs`、`.github/workflows/provision.yml` の `zone_and_waf` ジョブ（H3 のドメイン確定時に自動実行）。残る作業: なし（H3 の provision 実行に含まれる。個別の操作は不要） | —（公開前に設定するのが望ましい） |
| H14 | iOS / Android の LINE 実機で、詳細ページのカレンダーボタン（`openExternalBrowser=1`）と ics の取り込みが動くことの確認 | 実機と LINE アカウントが要る。パラメータの挙動はバージョン依存（§6.6、要検証） | 土台: `docs/runbooks/line-device-test.md`（チェックリストと結果記録欄）。残る作業: 実機での目視確認そのもの（自動化不可）。公開前と LINE のメジャー更新時に実施 | —（公開前と LINE のメジャー更新時） |

---

## 14. リスクと未決事項

### 14.1 リスク

| 項目 | 内容 | 対応方針 |
|---|---|---|
| OGP 生成の CPU 時間と wasm 初期化 → 実測済み（T10） | `wrangler dev`（ローカル、壁時計。isolate の CPU-ms とは異なる）で計測: 初回（wasm 初期化 + R2 からのフォント取得 + render + PNG エンコード）約 80〜100ms、2 回目以降（wasm・フォント・`fonts` 配列の参照をすべてメモ化した状態での render + エンコードのみ）約 20〜25ms、Cache API ヒットは約 3ms。`fonts` 配列を使い回して satori 内部の WeakMap キャッシュを効かせる対策（上記「フォント」）をした後の数値。500ms 超のリスクは実測範囲では観測されず | Cache API・R2・ネガティブキャッシュで再生成を防ぐ構成は既存のまま。本番の isolate 内 CPU-ms は T19 の初回デプロイで別途確認する。超過が常態化したら OGP 生成専用 Worker（Service Binding）へ分離 |
| Workers の起動時間制限（要検証） | satori の既定エントリ（asm.js 版 yoga）はトップレベル評価が 400ms を超えてデプロイが失敗しうる。`wrangler deploy --dry-run` では検出できない | `satori/standalone` + wasm import + 遅延 init（§2.5）。T19 の初回デプロイで確認 |
| vitest-pool-workers での wasm import → 確認済み（T10、§10.2） | `.wasm` の静的 import・`init()`/`initWasm()`・satori + resvg-wasm による PNG 生成のすべてが pool-workers 上で動くことを `test/integration/ogp/satoriOgpRenderer.test.ts` で確認した。Node 側への切り出しは不要だった | 対応不要。satori のバージョンは `harfbuzzjs`（fs 前提の wasm 読み込みで Workers 非対応）が入る前の `0.32.0` に固定する必要があった（上記「satori の読み込み方」） |
| `_headers` ファイルの対応 → 確認済み（T1、§10.2） | wrangler のバージョンによっては Static Assets で `_headers` が効かない懸念だったが、pool-workers・`wrangler dev` のいずれでも効くことを確認した | 対応不要。効かなくなった場合の代替は `run_worker_first` で Worker を通す案（§2.2、§14.3） |
| CPU-ms が Paid の込み枠上限近傍 | 月 10 万作成規模で 1,500〜3,000 万 CPU-ms | 超過分は月数十円。H12 の監視ルール |
| 日時パースの精度 | 「8 割当たる」は仮説。特に T2（1〜7 時は午後）は `7時集合` を壊す | 外れたケースを §5.6 の表に足す運用。T2 は実データで外れが多ければリテラル解釈に戻す（定数 1 つで切替できるよう `PM_HEURISTIC_MAX_HOUR = 7` を `limits.ts` に置く） |
| 場所抽出のストップリスト | 未知のパターンで誤検出しうる（例: `車で移動` → 場所 = 車） | タップ編集で空にすれば「使わない」になる（§6.1）。外れたケースをストップリストとテスト表に足す継続メンテ |
| `9/20 19時 渋谷` の解釈 | タイトル扱いにしたため、場所のつもりのユーザーは 1 タップ要る | プレビューの「場所にする」で 1 操作。実データで場所意図が多ければ規則 L3 を場所側に倒す |
| `H時〜H時` で翌朝を意図した範囲 | `19時〜8時` は T3(2) の候補方式で 19:00〜20:00 になり、翌朝 8 時の意図は取れない（§5.6 #71） | 既知の限界として期待値を固定。`19時〜翌8時` のような明示表記も Phase 1 では未対応。実データで要望があれば T3 の候補に「翌日の E」を足すか判断 |
| LINE 内蔵ブラウザの `openExternalBrowser=1`（要検証） | 公式ドキュメント記載だが、ページ内リンクへの適用はバージョン依存 | 案内バナーを常時併用。H14 で実機確認 |
| OGP のフォント未収録文字 | サブセット外の文字は描けない。除去する方針なので、絵文字だけのタイトルは OGP 上で空になる | 空になった場合は日時だけを描く。テンプレートの固定文言とサービス名は常に出る |
| Cache API の古さ | 編集・非表示後に最大 60 秒は旧内容が返る。`cache.delete()` はローカル colo のみ | 許容と明記。問題になれば `max-age` を短縮 |
| SNS 側の OGP キャッシュ | `og:image` は `?v=` で更新されるが、ページ URL 自体に紐づくカード（タイトル・説明文）は再共有されるまで更新されないことがある | プラットフォーム側の挙動。詳細ページ自体を正にする方針（§8）で吸収 |
| CGNAT による IP バケットの誤検知 | 携帯回線では無関係な利用者が IP バケットを共有する | IP 側を緩め・device 側を主にした閾値（§9.3）。429 ログのバケット種別で比率を見て調整 |
| D1 の `rate_limit_counters` 肥大 | GC の掃除を怠ると行数が積み上がる | T13 に掃除を含め、GC ログの件数を H12 で見る |
| GC のサブリクエスト上限 | Workers は 1 回の invocation あたりのサブリクエスト数に上限があり（Paid でも 1,000）、R2 バインディングの `delete` / `list` も 1 回として数える。`deleteAllForPage` は 1 ページにつき 2〜3 回かかるため、`GC_BATCH_SIZE`（100 件）を 3〜4 バッチ処理した時点で上限に達し、ページ削除ループが例外で止まる。1 回の Cron 実行で実際に消せるのは 300〜450 ページ程度で、設計が想定する月 10 万作成（1 日あたり約 3,300 件が期限切れ）には全く足りない。5・6 は先に実行されるため実行はされる（§2.6）が、ページ削除は毎日未処理分が積み増しになり、次回の実行で追いつくことはない | オーナー判断が必要（Phase 1 の運用規模に達する前に決める）。選択肢: Cron を毎時に増やして 1 回あたりの必要件数を減らす／`GC_MAX_BATCHES_PER_RUN` を上限に達しない値まで下げて実行頻度で補う／`ObjectStorage` に複数ページをまとめて削除するメソッドを足して R2 呼び出し回数を減らす（ポート変更のため別 PR）／ページ削除ループ側にサブリクエスト予算を持たせて上限前に打ち切る（`truncated: true` をログに残す） |
| `/:id.ics` の Phase 2 webcal 化 | 毎回 Worker + R2 を挟む。定常ポーリングになるとリクエスト数が増える | Cache API の TTL を伸ばす。込み枠 1,000 万/月で当面は足りる。R2 キーを `ics/{id}.ics` にしてあるので R2 直配信へキー移行なしで切り替えられる（§1.3） |
| 通報の運用が手動 | 集中時は運用者の判断に依存 | Phase 1 の規模では許容。同一送信元の一括非表示 SQL（§9.4）で 1 ページずつの対応を避ける。件数が増えたら簡易管理画面を検討 |
| 別端末で編集できない | トークンを URL に載せない設計の帰結 | concept §08 の割り切り。Phase 2 の Google ログインで解消 |
| AdSense 審査（Phase 2） | トップに実質的コンテンツが必要 | Phase 1 でも `/` の説明文・FAQ を書き、`noindex` にしない |
| `WIDE_URL_PATTERN` が記号カテゴリのホストを取りこぼす（Issue #19） | `https://eⓥⓘⓛ.com` のような、IDNA で英字に写像される囲み英数字（Unicode カテゴリ So）を含むホストは、絵文字等の非対応 So 文字と正規表現だけでは区別できず、`ⓥⓘⓛ.com` が本文に残る（外部リンクにはならない） | 実害は限定的なため Phase 1 では見送り。対応するなら IDNA 正規化テーブルを引く処理が要るため、正規表現の範囲を超える |

### 14.2 未決事項（オーナー判断を仰ぐ）

1. **サービス名・ドメイン**（H1）。設計書中の `calshare` `PUBLIC_ORIGIN` は仮。
2. **OGP 画像のデザイン**（配色・サービス名の位置・タイトルの最大行数）。制約: 固定文言「予定の共有」とサービス名を必ず含め、ユーザーテキストは 2 行まで（§2.5）。T10 のテンプレートは仮のレイアウトで進める。
3. **「1〜7 時は午後」ヒューリスティック（規則 T2）の採否**。本設計は採用にしたが、`7時集合` を朝と読ませたい用途を重く見るなら定数で無効化する。
4. **レート制限の初期閾値**（§9.3）。CGNAT を考慮して IP 側を緩めにした仮置き。リリース後のログで調整する。
5. **Google カレンダーリンクの `details` にメモの URL をそのまま載せるか**。本設計は載せる（受け手が自分でクリックする経路のため）。ics と揃えて `WIDE_URL_PATTERN` で「[リンク]」に置換する選択もある。
6. **`/new` と `/` の使い分け**。本設計は同内容の 2 パス（プリフィルリンクは `/new`、素のランディングは `/`）。`/` に説明コンテンツを厚くして `/new` を入力専用にするかは Phase 2 のテンプレページ設計と一緒に決める。
7. **Workers Paid（$5/月）の契約承認**（H2）。concept §09 の「無料枠のまま放置できる」から固定費 $5/月だけ逸脱する。承認後に concept を追記する。
8. **`PAST_EVENT` に猶予を設けるか**。本設計は作成時 `end < now` を厳密に拒否する。「終了直後の記録用途」を許すなら `end < now - 24 時間` のように緩める。緩めると「作成直後に過去のページ」が増えるので、実データで要望が出てから判断する。
9. **「LINEで送る」の共有 URL に `?openExternalBrowser=1` を付けるか**。付けると詳細ページごと外部ブラウザで開き ics の問題を根本から避けられるが、共有 URL が長くなり、H14 の実機確認が前提になる。本設計は付けない。
10. **PATCH で R2 の ics が古い版のまま残りうる**。`PATCH /api/pages/:id` は D1 の更新と R2 への ics 上書きを別々に行うため、(a) R2 への `putIcs` が失敗した場合、(b) 同一ページへの並行 PATCH が到着順と異なる順で R2 に書き込んだ場合に、D1 の `version` と R2 の ics の `SEQUENCE` がずれたまま残ることがある。`GET /:id.ics` の自己修復（§2.3）は R2 に ics が存在しない場合にのみ再生成するため、この状態は自己修復されない。対応するなら、`GET /:id.ics` で R2 の `SEQUENCE` と `version - 1` を比較し、不一致なら再生成する案がある。
11. **`PATCH /api/pages/:id` にレート制限を設けるか**。編集トークンを持つ作成者本人しか叩けないため第三者による増幅は無いが、自作ページへの連打で R2 と D1 の書き込みを消費できる。設けるなら `RateLimitScope` に `update` を追加し、device 単位の閾値を決める（§9.3）。

### 14.3 レビュー指摘のうち採らなかったもの

2026-09-17 のレビューで出た指摘のうち、設計に反映しなかったものとその理由。読み手が「なぜこの形になっていないのか」を辿れるように残す。

| 指摘 | 判断 | 理由 |
|---|---|---|
| 開放端「19:00〜」を `EventFields.hasExplicitEnd` で表現する | 採らない（表示を「19:00〜20:00」に統一） | 型・DB・表示の 3 箇所に分岐が増える。既定 60 分をそのまま見せる方が、受け手がカレンダーに入る内容と画面で一致する（§5.5 T1） |
| `PAST_EVENT` を `end < now - 猶予` に緩める | 未決事項に載せた（§14.2-8） | 猶予の長さは実データが無いと決められない。作成時は厳密、更新時は日時不変なら通す、で当面の矛盾は解消している |
| ics の R2 キーを version 付きと安定キーの両方で書く | 安定キーのみにした | ics は作成・編集時に同期生成するので version 付きキーの用途が無い。書き込み回数と GC の削除対象を増やさない |
| 絵文字を satori の `graphemeImages` で描く | 採らない（除去する） | 絵文字画像の外部取得が要り、OGP 生成の依存先が増える。Phase 1 は詳細ページで正しく見えれば足りる |
| Workers の Rate Limiting バインディングを D1 の前段に置く | 採らない（§9.3 に判断を残す） | colo 単位で非グローバルなため日次上限に使えない。D1 の check-before-write で書き込み増幅は抑えられる。WAF のルール（H13）を保険にする |
| `hxxps://` のような難読化 URL を `URL_PATTERN` で拾う | 採らない | 受け手のカレンダーアプリもリンク化しないので、スパムの経路にならない。パターンを広げるほど正規の文字列を誤って置換する |
| 通報フォームを HTML form のまま CSRF トークンで守る | 採らない（JS で JSON 送信） | JSON 必須と同一オリジン検査で作成 API と同じ仕組みに揃う。トークンの発行・検証を別に持つより単純 |
| 静的ページを `run_worker_first` で常に Worker に通す | `_headers` が効かない場合の代替に留める | Worker リクエスト数と CPU を静的ページ分だけ消費する。`_headers` で足りるなら不要 |
| `Deps.interpreter` を残して用途を書く | 削除した | Phase 1 でサーバ側から呼ぶ経路が無い。Phase 2 で `/api/interpret` を足すときにそのルートの依存として加える方が、使われないポートを配線しなくて済む |
