# security-audit チェックリスト（docs/design.md §9 準拠）

各項目は「何を確認するか / どのファイルを見るか / 合格の証拠 / 該当する実装 PR（§12）」の4列。`src/` が無い時点では、多くの項目が「未実装」になるのが正しい判定であり「不合格」ではない——不合格は「実装されているのに基準を満たしていない」ときだけに使う。

## 9.1 XSS

| 何を確認するか                                                                           | どのファイルを見るか                                                                                             | 合格の証拠                                                                                                                         | 実装 PR                                   |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| SSR が `hono/jsx` の自動エスケープに全面依存し、生 HTML 挿入が無い                       | `src/server/views/**`（`dangerouslySetInnerHTML` 相当の有無）、`eslint.config.js` の `no-restricted-syntax` 設定 | 該当箇所が無い ＋ ESLint ルールが存在し `npx eslint` が通る                                                                        | T1（lint設定）/ T8（詳細ページ）          |
| メモの改行を `<br>` の JSX 要素で表現し、文字列連結で HTML を組んでいない                | `src/server/views/DetailPage.tsx`                                                                                | 改行表示部分が `split('\n').map(...)` + JSX 要素で、テンプレートリテラルで HTML を組む箇所が無い                                   | T8                                        |
| クライアント側描画が `textContent`/`createElement` のみで `innerHTML` に文字列を入れない | `src/web/**/*.ts`、ESLint 設定                                                                                   | `innerHTML`/`outerHTML`/`insertAdjacentHTML` の使用箇所が無い（ESLint で機械検出できていればなお良い）                             | T14〜T17                                  |
| OGP 生成がテキストノードとしてのみ入力を扱い、文字列連結で SVG/CSS を組んでいない        | `src/adapters/ogp/{satoriOgpRenderer,ogpTemplate}.ts`                                                            | satori の JSX 風オブジェクトに文字列を渡す構造で、`<script>` `&` `"` を含むタイトルでも例外にならず PNG が返る（T10 のテスト観点） | T10                                       |
| CSP・X-Content-Type-Options・Referrer-Policy が SSR/API と静的ページの両方に付く         | `src/server/lib/headers.ts`、`src/web/_headers`                                                                  | 両者の値が一致する（`test/unit/server/lib/headers.test.ts` で機械検証）                                                            | T1（`_headers` 雛形）/ T8（`headers.ts`） |

## 9.2 URL の扱い（説明欄の非リンク化・本数制限）

| 何を確認するか                                                                            | どのファイルを見るか                                                 | 合格の証拠                                                          | 実装 PR |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------- |
| 詳細ページでメモ中の URL を自動リンク化しない・リンク化ライブラリを入れていない           | `src/server/views/DetailPage.tsx`、`package.json`                    | リンク化ライブラリが依存に無い。表示に `<a>` 生成ロジックが無い     | T8      |
| URL 判定が `URL_PATTERN` 1 本に集約されている                                             | `src/core/text/urlPattern.ts` とその利用箇所（parse・ics・validate） | grep して独自の URL 正規表現が他にない                              | T2      |
| 作成・更新時に `title+location+memo` の URL 合計が `MAX_MEMO_URLS=3` を超えると 400       | `src/core/validate/*`、`src/core/config/limits.ts`                   | `TOO_MANY_URLS` のテストケースがあり通る                            | T3      |
| 「地図で見る」がユーザー入力を URL として解釈せず `encodeURIComponent` 経由の固定パターン | `src/server/views/DetailPage.tsx`                                    | `https://www.google.com/maps/search/?api=1&query=` への固定連結のみ | T8      |

## 9.3 レート制限

| 何を確認するか                                                              | どのファイルを見るか                                                     | 合格の証拠                                                                                                                      | 実装 PR                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| IP・device 独立バケットで OR 判定（いずれか超過で 429）                     | `src/server/middleware/rateLimit.ts`、`src/adapters/d1/d1RateLimiter.ts` | 429 の結合テストが IP 側・device 側それぞれで通る                                                                               | T7（middleware）/ T6（実装） |
| `ip_hash` が pepper 付き HMAC で IPv6 は /64 丸め、生 IP を保存・ログしない | `src/server/lib/ipHash.ts`                                               | 同一 /64 が同一ハッシュ、生 IP がコード上のどこにも残らない（grep で `CF-Connecting-IP` の使用箇所が `ipHash.ts` に閉じている） | T6                           |
| 上限超過後にカウンタ行を追加で書かない（増幅防御）                          | `src/adapters/d1/d1RateLimiter.ts`                                       | SELECT 先読み→未満のときだけ INSERT/UPDATE、のテストがある                                                                      | T6                           |
| device Cookie が `HttpOnly; Secure; SameSite=Lax; Max-Age=34560000; Path=/` | `src/server/lib/deviceCookie.ts`                                         | Cookie 属性のテストがある                                                                                                       | T6                           |

## 9.4 通報導線・Webhook 通知本文

| 何を確認するか                                                                               | どのファイルを見るか                       | 合格の証拠                                                                    | 実装 PR |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- | ------- |
| 通報 API が `reason` を列挙値検証、`comment` 500 文字超で 400                                | `src/server/routes/apiReports.ts`          | 400 系テストが通る                                                            | T12     |
| 同一 `ip_hash`・同一ページ24時間以内の重複を無視して200・件数も増やさない                    | `src/adapters/d1/d1ReportRepository.ts`    | `insertIfNotDuplicate` のテストがある                                         | T5/T12  |
| Discord は `allowed_mentions:{parse:[]}` とコードブロックでメンション・自動リンクを無効化    | `src/adapters/notifier/webhookNotifier.ts` | `@everyone`/URL を含むコメントでも payload にメンション有効化フィールドが無い | T12     |
| Slack は `&`/`<`/`>` エスケープ＋ `mrkdwn:false`                                             | 同上                                       | エスケープ済みテキストが `mrkdwn:false` で送られる                            | T12     |
| Webhook 本文の URL は詳細ページ1本のみ。コメント中の URL は「[リンク]」置換＋200文字切り詰め | 同上                                       | テストで確認                                                                  | T12     |
| Webhook 種別判定がホスト名ベースで、未知ホストは送らず warn のみ（受理は成功）               | 同上                                       | テストで確認                                                                  | T12     |

## 9.5 noindex と robots.txt

| 何を確認するか                                                                | どのファイルを見るか                                   | 合格の証拠                             | 実装 PR           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- | ----------------- |
| `/:id` 系（詳細・ics・OGP・edit・report）に `X-Robots-Tag: noindex, nofollow` | `src/server/middleware/securityHeaders.ts` or 各ルート | ヘッダ検証テストがある                 | T8/T9/T10/T11/T12 |
| `/` `/new` は noindex にしない                                                | `src/web/_headers`、`src/web/pages/index.html`         | meta タグ・ヘッダ両方に noindex が無い | T1                |
| `robots.txt` が `Disallow` で詳細ページを塞いでいない                         | `src/web/robots.txt`                                   | `Allow: /` のみ                        | T1                |

## 9.6 ログ

| 何を確認するか                                                                                                    | どのファイルを見るか                                                                       | 合格の証拠                                     | 実装 PR                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------- |
| 生 IP・`ip_hash`・`device_id`・UA 文字列・編集トークン・`raw_text`/`title`/`memo`/`location` の内容がログに出ない | `src/server/lib/logger.ts`、`src/adapters/logger/consoleLogger.ts`、各ルートの呼び出し箇所 | `console.log` をスパイした結合テストで確認済み | T18（`consoleLogger` 自体は T1） |
| 例外はスタックトレースでなく `{name, message}`（200文字切り詰め）に正規化                                         | `src/adapters/logger/consoleLogger.ts`                                                     | ユニットテストがある                           | T1                               |
| クエリ文字列全体を残さずパスのみ、`ref` は `source` に変換してから残す                                            | `src/server/middleware/requestLog.ts`                                                      | テストがある                                   | T18                              |

## 9.7 シークレット

| 何を確認するか                                                                                       | どのファイルを見るか                                                           | 合格の証拠                                                                      | 実装 PR |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------- |
| `RATE_LIMIT_PEPPER`/`REPORT_WEBHOOK_URL`/`CLOUDFLARE_API_TOKEN` がコード・リポジトリに書かれていない | リポジトリ全体を grep（`RATE_LIMIT_PEPPER\s*=\s*['"]` のような直書きパターン） | ヒットなし。`.dev.vars` は `.gitignore` 済みで `.dev.vars.example` のみコミット | T1      |
| ローカル雛形 `.dev.vars.example` に実際のシークレット値が入っていない                                | `.dev.vars.example`                                                            | プレースホルダのみ                                                              | T1      |

## 9.8 CORS / CSRF（Origin 検証・JSON 必須）

| 何を確認するか                                                     | どのファイルを見るか                  | 合格の証拠                                                                 | 実装 PR |
| ------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------- | ------- |
| `/api/*` に CORS ヘッダを一切付けない                              | `src/server/app.ts`、ミドルウェア設定 | `Access-Control-Allow-Origin` が応答に無い                                 | T7      |
| 状態変更 API が `Content-Type: application/json` 以外を 415 で拒否 | `src/server/middleware/jsonBody.ts`   | `text/plain` の POST が 415 になるテスト                                   | T7      |
| `Sec-Fetch-Site`/`Origin` 検証ミドルウェアがクロスオリジンを 403   | `src/server/middleware/sameOrigin.ts` | 別ドメイン Origin の通報/作成が403で、D1に書かれずカウンタも進まないテスト | T7/T12  |
| 通報フォームが素の HTML form ではなく JSON 送信                    | `src/web/report/main.ts`              | `<form action>` の直接 POST が無く `fetch` で JSON を送っている            | T12     |

## 9.9 ホスト名と絶対 URL（open redirect を含む）

| 何を確認するか                                                                                                                                                | どのファイルを見るか                              | 合格の証拠                                                                                                  | 実装 PR        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| 応答中の絶対URL（`url`/`og:url`/`og:image`/ics `URL`・`UID`/Webhook本文）が `config.publicOrigin` から組まれ `request.url`/`Host` を使わない                  | `src/server/deps.ts`、各ルートの URL 組み立て箇所 | grep で `request.url`/`c.req.header('Host')` が URL 生成に使われていない（`env.ASSETS.fetch()` 向けを除く） | T7〜T12        |
| クライアント側の `id` 由来の遷移が `isValidPageId` 通過後に `new URL(path, location.origin)` で組まれ origin 一致を確認してから遷移する（open redirect 対策） | `src/web/done/main.ts`、`src/web/lib/*`           | `?id=//evil.example` のようなペイロードで `/` にフォールバックするテスト（e2e `redirect.spec.ts`）          | T15            |
| `workers_dev: false` で `*.workers.dev` からの応答を止めている                                                                                                | `wrangler.jsonc`                                  | H3 完了後に設定される（オーナー作業）                                                                       | H3（人間作業） |

## 補足：この表に無い項目

- **ID の推測不能性**（Crockford Base32 12文字・約1.15×10^18キースペース）は §4.2 対応。`src/core/id/crockford.ts` の `isValidPageId`/生成関数と、1万件生成での重複・パターン一致テスト（T3）を見る。
- **編集トークンの保管と検証**（生トークンは保存せずSHA-256のみ、定数時間比較、URLに載せない）は §3.3 対応。`src/adapters/d1/*`（`edit_token_hash` のみ格納）と `src/server/routes/apiPagesEdit.ts`（Bearer 検証）を見る（T5/T11）。
- **ics のサニタイズ**（SUMMARY/LOCATION/DESCRIPTION の URL を「[リンク]」に置換、C0制御文字除去、ORGANIZER/ATTENDEE/ATTACH/X-ALT-DESCを出力しない）は §7.2 対応。`src/core/ics/buildIcs.ts` を見る（T4）。
- **プリフィルの即公開禁止**（`/new?...` を踏んだだけでは `POST /api/pages` を呼ばず、ユーザーが「URLを作る」を押すまで公開されない）は §5.8 対応。`src/web/create/prefill.ts` を見る（T14）。プリフィルパラメータをそのまま自動送信する実装になっていないかを重点的に確認する。
- **GitHub Actions の inputs 注入・シークレットの露出**は ops-audit スキルの担当領域。security-audit は結果を要約して引用するに留め、詳細な監査はそちらに委ねる。
