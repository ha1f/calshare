# calshare 実装ガイドライン

> 更新日: 2026-09-27 / 根拠の確認日: 2026-09-27（npm view・公式ドキュメント・リリースノートを当日に確認）

## この文書の位置づけ

- docs/concept.md は「なぜ作るか」、docs/design.md は「何を作るか」を決める。本書は「どう書くか」を決める。
- 本書の規則は、2026-09-27 時点で一次資料（公式ドキュメント・型定義・npm のメタデータ）で確認できたものだけを載せる。確認できなかった提案は末尾の「要検証」に分けてあり、規則ではない。
- docs/concept.md の 3 原則（入力欄は 1 つ、設定を選ばせない、詳細ページの仕事は次の作成者を作ること）と docs/design.md §11.6 の規約（core は外部依存ゼロ、定数は `core/config/limits.ts` にだけ置く、`app.ts` はルートの登録だけ）に反する提案は、技術的に優れていても採らない。
- コメントの書き方は §3.3 に従う。
- 各規則には理由を 1 文添える。根拠の URL は文末の脚注にまとめる。
- docs/design.md §11.6 の「後続 PR は変更しない」は並列実装期間（T1〜T19）の規約で、完了後は本書に従う。本書と設計書が食い違う箇所は、実装を変える PR で設計書側も同時に直す。

依存の更新方針は §1、判断の背景と採らなかった案は §9〜§11 にある。何かを追加・変更したくなったら、まず §9 と §10 に同じ提案が無いかを見る。

---

## 1. ランタイムとバージョン方針

### 1.1 方針の要約

| 対象 | 現在 | 方針 | 理由 |
|---|---|---|---|
| Node | 22（`.nvmrc`、`engines.node >=22`） | 22 系を維持。24 への移行は別タスク（§11） | wrangler 4 の最小要件は 22.0.0 で、22 は 2027-04-30 までサポートされる[^node-schedule]。移行には wrangler・pool-workers・esbuild の実機確認が要る |
| npm | lockfile v3、`npm ci` | `package-lock.json` をコミットし、CI とローカルは `npm ci`。`.npmrc` に `engine-strict=true` を置く | `engines` を満たさない Node で `npm install` / `npm ci` を走らせたとき、警告だけで通り過ぎず拒否させる。wrangler は Node 22 未満で起動時に落ちるので、install の時点で止めたい[^npm-engine-strict] |
| wrangler | `^4.136.3`（lockfile は 4.141.0 に解決済み。最新と一致） | caret 指定。Dependabot で追随し、`wrangler deploy --dry-run` と `npm run test:e2e` で確認する | 結合テスト（pool-workers）は wrangler 本体ではなく pool-workers に同梱の wrangler / workerd で動くため、wrangler 単体の更新は結合テストの実行基盤を変えない（`npm ls workerd` で 2 系統あることを確認できる） |
| `compatibility_date` | `2026-08-22` | `@cloudflare/vitest-pool-workers` に同梱の workerd（`npm ls workerd` の `@cloudflare/vitest-pool-workers` 配下）が対応する最新日付まで。判定は `npm run test:integration` が起動すること。wrangler 単体の更新では動かさず、pool-workers の更新と同じ PR で `wrangler.jsonc` と docs/design.md §11.7 の注記を一緒に変える | 実測: 日付を 2026-09-25 にすると結合テストが `newest date supported by this server binary is "2026-08-22"` で全件起動失敗する。トップレベルの wrangler 4.141.0（workerd 1.20260925.1）と pool-workers 0.22.0（workerd 1.20260815.1）は別物 |
| `compatibility_flags` | `["nodejs_compat"]` | そのまま残す | 2026-08-04 以降の日付では既定で有効なので冗長だが、書いてあっても動作は同じ。差分を作らない[^cf-compat-flags] |
| TypeScript | `^5.9.0`（最新 7.0.2） | 5.9 系を維持。6.0.x は typescript-eslint の peer（`<6.1.0`）に入っており技術的には上げられるが、7 系への橋渡し版で本リポジトリに新機能の利益が無い。typescript-eslint が 7.1 の API に対応した版を出したら 7 系へ一度に上げる | 7.0 はプログラム API を持たず typescript-eslint がクラッシュする[^ts7][^tseslint-ts7]。6.0 の破壊的変更のうち本リポジトリに関わるのは `types` の既定が `[]` になる点だけで、3 つの tsconfig はいずれも明示済み |
| Vitest | `^4.1.0`（最新 5.0.2） | 4.1 系を維持。`@cloudflare/vitest-pool-workers` の peer が `^4.1.0` を外すまで上げない | peer 違反で結合テストが動かなくなる[^pool-workers-peer] |
| `@cloudflare/vitest-pool-workers` | `^0.22.0` | caret 指定。上げたら結合テストと D1 のストレージ分離の挙動を確認する | Vitest 4 対応でストレージ分離がファイル単位に変わった（§7.2）[^pool-workers-migration] |
| Hono | `^4.13.0`（lockfile は 4.13.9 に解決済み。最新と一致） | caret 指定。Dependabot で追随 | メジャー内で破壊的変更は無い前提。上げたら結合テストで確認する |
| satori | `0.32.0`（完全固定。最新 0.33.5） | 固定を維持。0.33 系は Workers で初期化できない | 0.33 で追加された harfbuzzjs の初期化が Workers（fs も `self.location` も無い）で失敗する（docs/design.md §2.5）。0.33.5 でも依存は外れていない[^satori-harfbuzz] |
| `@resvg/resvg-wasm` | `2.6.2`（完全固定。最新と一致） | 固定を維持。上げるときは `index_bg.wasm` の import パスと結合テストを確認する | wasm ファイルを直接 import しており、パスが変わるとビルドが壊れる |
| esbuild | `^0.28.0`（lockfile は 0.28.2 に解決済み。最新と一致） | caret 指定。web アセットのビルド専用 | Worker 本体は wrangler がバンドルする（docs/design.md §11.7） |
| ESLint / typescript-eslint | `^10.11.0` / `^8.70.1` | caret 指定。flat config のみ | ESLint 10 で eslintrc 形式は撤廃済み[^eslint10] |
| Prettier | `^3.9.9` | caret 指定。experimental オプションと、既定値を変えるオプションを足さない（§3.2） | 前者は将来削除か既定化される。後者は一斉に差分が出る |
| `@types/node` | `^22.20.0` | Node のメジャーに合わせる（22 系のまま） | ランタイムに無い API の型が混入するのを防ぐ |
| Playwright | `^1.63.0` | caret 指定。CI は chromium のみ install | line-ios プロジェクトも chromium で動かす（playwright.config.ts） |
| GitHub Actions（checkout / setup-node / upload-artifact） | v7 タグ | フルコミット SHA + `# vX.Y.Z` コメントで固定し、Dependabot にまとめて更新させる | GitHub の公式ガイドが SHA 固定を唯一の不変な参照方法としている[^gha-hardening] |

### 1.2 更新の運用

- Dependabot（weekly）が minor / patch をまとめた PR を出す。CI が通れば取り込む。
- major は Dependabot の個別 PR で来る。peer 依存と本書の表を確認し、dependency-audit スキルの手順で破壊的変更を洗ってから判断する。
- 四半期に一度、次の 3 点を `npm view <pkg> peerDependencies` / `npm view <pkg> dependencies` で確認し、解除できるものがあれば §1.1 の表と `.github/dependabot.yml` の ignore を更新する。
  - `typescript-eslint` の peer `typescript` が 7.x を含むか（含んだら 7 系へ更新する）
  - `@cloudflare/vitest-pool-workers` の peer `vitest`（Vitest 5 の可否）
  - `satori` の `dependencies` に `harfbuzzjs` が残っているか（Workers で読める公開 API が付いたか）
- 依存を上げた PR には、解決されたバージョンと確認したコマンド（`npm run typecheck` / `npm test` / `npm run test:e2e` / `npx wrangler deploy --dry-run`）を書く。

---

## 2. TypeScript

### 2.1 tsconfig の構成

base（`tsconfig.json`）を `tsconfig.core.json` / `tsconfig.server.json` / `tsconfig.web.json` が継承し、`include` で対象を絞る。`npm run typecheck` は 3 つを順に流す。Project References（`composite` + `references`）は使わない。3 プロジェクトを順に tsc で流す現状で typecheck の所要時間に問題が無く、`composite` / `references` を足しても設定が増えるだけという本リポジトリの判断。

| 設定 | 値 | 理由 |
|---|---|---|
| `strict` | `true` | 既定の厳格チェック一式 |
| `module` / `moduleResolution` | `ESNext` / `bundler` | wrangler・esbuild・Vite のどれも拡張子なしの相対 import を解決できる |
| `target` / `lib` | `ES2022` | Workers・モバイルブラウザともに ES2022 を実行できる。esbuild の target もこれに揃える（§6.1） |
| `noEmit` / `isolatedModules` | `true` | tsc は型チェックだけ。出力はバンドラの仕事 |
| `jsx` / `jsxImportSource` | `react-jsx` / `hono/jsx` | hono/jsx の公式設定[^hono-jsx] |
| `verbatimModuleSyntax` | `true`（追加） | 型だけの import を `import type` に強制し、バンドラが消す import と tsc の解釈を一致させる。既存コードは `import type` を徹底しているので影響は小さい[^tsconfig-ref] |
| `noUncheckedIndexedAccess` | `true`（追加） | 配列・Record の添字アクセスが `T \| undefined` になる。パーサ（`core/parse`）の正規表現マッチ結果の取り扱いを型で守る[^tsconfig-ref] |
| `exactOptionalPropertyTypes` | `true`（追加） | `prop?: string` に `undefined` を明示代入できなくなる。`Env` の optional な secret と「空文字」の区別を型で守る[^tsconfig-ref] |
| `noImplicitOverride` | `true`（追加） | `Error` を継承するエラークラスの上書きを明示する[^tsconfig-ref] |
| `types` | core / web は `[]`、server は `["@cloudflare/vitest-pool-workers/types"]` | core と web に Node の型（`process` `Buffer`）が漏れないことを tsc で保証する（docs/design.md §11.7） |
| `lib` の追加 | core: `WebWorker`、web: `DOM` `DOM.Iterable` | core は Web Crypto を使うため WebWorker が要る。web だけが DOM を触る |

追加 4 項目（`verbatimModuleSyntax` 以下）は 2026-09-27 に HEAD `5930ec4` で 4 フラグ付きの tsc を流して実測した。core 15 件（`core/prefill/resolvePrefill.ts` 10、`parse/dateTokens.ts` 3、`parse/locationTitle.ts` 2）、server プロジェクト合計 67 件（`src/server` 12、`src/adapters` 6、`src/core` 15、`test/unit` + `test/integration` 34）、web プロジェクト合計 33 件（`src/web` 11、`src/core` 15、`test/unit/web` 7）。core の 15 件は 3 プロジェクトに重複して数えられている。導入は層ごとの PR で行った。core → server / web の順に、0 件になった層の tsconfig に先に入れ、3 つがそろった時点で base（`tsconfig.json`）へ集約した（§10）。

`noPropertyAccessFromIndexSignature` は採らない。`element.dataset.testid` のような慣用的な書き方が `dataset['testid']` になり、読みにくくなる割に守れるものが少ない（実測で web 40 件・server 27 件）。`erasableSyntaxOnly` `allowImportingTsExtensions` `rewriteRelativeImportExtensions` も採らない。tsc がファイルを直接実行する構成向けの設定で、noEmit + バンドラの構成には当てはまらない[^tsconfig-ref]。

### 2.2 import の書き方

- 相対パス、拡張子なし。`src/core` は相対 import のみ（ESLint の `no-restricted-imports` で機械的に検査。docs/design.md §11.1）。
- 型だけを使う import は `import type { X } from '...'`。値と型を同じモジュールから取るときは 2 行に分ける。本リポジトリの書き方の統一であり、ESLint の `no-restricted-syntax`（§2.4）で検出する。`verbatimModuleSyntax` は inline の `type` 修飾子も許すので、tsc では検出されない。
- Node の組み込みは `node:` プレフィックス付き（`scripts/**/*.mjs` のみ。src からは使わない）。
- 並び順は「外部パッケージ → `core` → `ports` → `adapters` → 同じ層のローカル」を目安にする。ESLint での強制はしない（§9 の perfectionist の項）。
- 動的 import はパスがリテラルのときだけ使う（例: `import('satori/yoga.wasm')`）。バンドラが静的に解析でき、実行時に取りに行くわけではない（`src/server/deps.ts` の注記）。
- `package.json` の `imports`（`#core/*`）は要検証（§12）。現時点では使わない。

### 2.3 型の書き方

- 境界（サーバが受け取るリクエストの JSON、web が受け取るエラー本文、localStorage、D1 の TEXT 列に入れた JSON）から入る値は `unknown` で受け、手書きの判定で狭めてから core の型に変換する。`as` は判定が済んだ直後の 1 箇所だけに使う（`src/server/routes/apiPagesEdit.ts` の `parseUpdatePageRequest`、`src/web/lib/history.ts` の `isStoredHistoryEntry` が手本）。
  - web が受け取るエラー本文は Cloudflare の 502 など API 以外が返すこともあるので判定の対象にする。web が自分の API から受け取る成功レスポンスは、`src/core/api/types.ts` の型をサーバと共用しているので、判定せずに `as` で型付けしてよい（`response.json()` は `any` を返すため、型注釈で受けると `@typescript-eslint/no-unsafe-assignment` に当たる）。
  - D1 の行は、書き込むのが本リポジトリのアダプタと scripts に限られるので `.first<T>()` などで型付けしてよい。スキーマが中身を保証しない JSON を入れた TEXT 列だけは unknown で受けて判定する。
- 状態は判別可能なユニオン（`{ mode: 'auto' } | { mode: 'manual'; value: T }`、`{ ok: true } | { ok: false; code }`）で表す。`enum` は使わず、文字列リテラルのユニオンと `as const` を使う。
- 依存は `Deps`（`src/server/deps.ts`）の引数で渡す。モジュールスコープのシングルトンやグローバルからの参照はしない。テストは Fake を渡して差し替える（docs/design.md §11.4）。
- `any` は使わない。`@ts-ignore` は使わず、必要なら `@ts-expect-error` に理由を添える。
- 非 null アサーション（`!`）は避け、`?? ` か型ガードで書く。どうしても使うときは直前の行に不変条件を書く。
- 関数の戻り値型は公開関数（export するもの）には書く。ローカル関数は推論に任せてよい。
- docs/design.md §11.5 の公開シグネチャ（`createApp` `buildDeps` `validateEventFields` など）を変えるときは、設計書を先に直す。

### 2.4 禁止事項（ESLint で検出するもの）

- `innerHTML` `outerHTML` `insertAdjacentHTML` `dangerouslySetInnerHTML`（docs/design.md §9.1）
- `src/core` からの非相対 import
- 未使用変数（引数は `_` 始まりのみ許可。`Deps` を型で揃えるため使わない引数を受け取るルートがある）
- 値と型を同じモジュールから取る inline の `type` 修飾子（§2.2）

---

## 3. Lint / Format

### 3.1 ESLint

- 設定は `eslint.config.js` の flat config 1 ファイル。`.eslintrc*` は置かない[^eslint10]。
- ベースは `@eslint/js` の `recommended` と typescript-eslint の `recommendedTypeChecked`。型情報付き lint（floating promise・誤った `await` 漏れの検出）を有効にする[^tseslint-typed]。
  - `languageOptions.parserOptions` は `project: ['./tsconfig.core.json', './tsconfig.server.json', './tsconfig.web.json']` と `tsconfigRootDir: import.meta.dirname`。`projectService: true` は採らない。projectService は各ファイルに最も近い `tsconfig.json` を使うため、本リポジトリでは `include` を持たない root の `tsconfig.json`（`lib: ES2022` のみ、DOM なし）が全ファイルに当たり、web の DOM 型が解決されない[^tseslint-parser]。実測（2026-09-27、`recommendedTypeChecked`）: projectService では `src/**/*.{ts,tsx}` に 362 件（web 3 ファイルだけで `no-unsafe-member-access` 24 件を含む 47 件）、`project` 配列では `src` に 26 件（`require-await` 22、`no-unsafe-*` 4）。
  - `src/core` は 3 つの tsconfig に重複して含まれるが、typescript-eslint は最初に一致した project を使うので問題にならない。
  - どの tsconfig にも含まれないファイル（`*.config.ts`、`eslint.config.js`、`scripts/**/*.mjs`）には `tseslint.configs.disableTypeChecked` を当てる。
  - `@typescript-eslint/require-await` だけは off にする。ポート（`src/ports/*`）は Promise を返す契約で、メモリ実装や Fake のように同期で済む実装も `async` で書く。`async` を外して `Promise.resolve()` で返す書き方にすると、関数内の `throw` が reject にならず同期の例外になり、本物のアダプタと挙動がずれる。await 漏れは `no-floating-promises` と `await-thenable` が検出する。
  - `npm run lint` は先に `wrangler types` を実行する。`worker-configuration.d.ts`（生成物、gitignore 対象）が無いと `env` などの型が解決できず、`no-unsafe-*` が大量に出る。
  - lint の所要時間は導入前の約 1.6 倍（手元で 6 秒台 → 10 秒台、2026-09-27）。
- プロジェクト固有のルールは、設計原則に直結するもの（§2.4）と、tsc では検出できない書き方の統一（§2.2 の import の分割）だけを持つ。汎用のスタイルプラグイン（unicorn、perfectionist、import-x）は入れない（§9）。
- `scripts/**/*.mjs` のグローバル定義は必要な名前だけを手書きで列挙する。`globals` パッケージ（`globals.node`）は許可範囲が数十個に広がるため入れない。

### 3.2 Prettier

- `.prettierrc`: `semi: false`、`singleQuote: true`、`printWidth: 100`、`trailingComma: 'all'`。変えない。
- `experimentalOperatorPosition` などの experimental オプションは使わない。experimental options policy により将来削除されるか既定になる[^prettier-35]。`objectWrap` など既定値を変えるオプションも `.prettierrc` に足さない。差分が一斉に出る。
- `npm run lint` が `prettier --check .` を含む。整形は `npm run format`。
- `.prettierignore` に生成物（`dist/` `dist-worker/` `.wrangler/` `worker-configuration.d.ts` `package-lock.json`）と `docs/` を置く。docs は表の整形が崩れるため対象外。

### 3.3 コメント

- コメントは日本語で。
- 読み手は、PR や議論の経緯を知らない同僚。今のコードだけを見て読む。
- 各コメントに「これを読まないと何を壊すか」を問う。答えられないなら消す。
- 読み手がコードだけでは分からないことだけ書く。コードの言い換えや作業の経緯は書かない。
  - コメントで補いたくなったら、先に名前や構造で伝えられないか考える。
  - 読み手が普通は別の書き方を期待する箇所は、普通の書き方を示してからそうしない理由を書く。
  - 一文で済むことに例を足さない。
  - 判断の経緯を残したければ PR 説明に書く。
- コメントは誰も更新しない前提で書く。変わるものを写すと、変わった頃には嘘になっている。
  - ログメッセージ、UI 文言、他ファイルの行番号など。どうしても要るなら参照先の名前だけ書く。
- 読み手が持っていない語彙を使わない。
  - 設計文書の符牒（M1、D-4 など）、作業中の議論でしか通じない呼び名や比喩。ただし docs/design.md の節番号（`§9.1` のような参照）は読み手に共有されているので符牒に当たらない。
  - 独特な言い回しを使わない: 正本 / 配線 / スクリム / 〜に倒す / 〜に閉じる / 〜の器 / 噛み合わない / 素直 / 素通り / 巻き添え / 構造的に / 〜であって〜ではない /「取り返しがつかない」等の大げさな断定。
  - 言い換え: 正本 →「定義はここ」、配線 →「モジュールに登録する」、〜に倒す →「〜として扱う」。
- 強調に頼らない。★・太字・全角ダッシュ（——）は 1 ファイルに 1 つまで。
- 1 つのコメントは 3 文以内を目安にする。
- コメント密度は周囲のファイルに合わせる。
- doc コメント（JSDoc 等）は利用者向けに、何をするかと契約を書く。目的（何のためにあるか）を先に書き、方法（どう実現しているか）を後に書く。

---

## 4. Cloudflare Workers / wrangler

### 4.1 wrangler.jsonc

- 設定は `wrangler.jsonc` の 1 ファイル。判断の理由はコメントで残す（`rules` の `fallthrough: false`、`crons` の JST 換算など）。
- `main` は `src/server/index.ts`。Worker 本体は wrangler がバンドルする。esbuild は `src/web` のみ。
- `workers_dev: true` は独自ドメイン取得までの暫定。ドメインが有効になると provision.yml が `routes` 追加と `workers_dev: false` の PR を作る（docs/runbooks/custom-domain.md）。手で変えない。workers.dev は個人・趣味用途の位置づけで、本番トラフィックを受ける先ではない[^workers-dev]。
- `observability.enabled: true`。`head_sampling_rate` は既定（100%）のまま。ログ課金が気になる規模になったら、エラー系を落とさないフィルタ設計と併せて検討する[^workers-logs]。
- `vars` は非秘密の設定（`PUBLIC_ORIGIN` `SERVICE_NAME`）だけ。秘密は §4.7。
- `wrangler types` が生成する `worker-configuration.d.ts` はコミットせず、`npm run typecheck` の先頭で毎回生成する。`@cloudflare/workers-types` は入れない（docs/design.md §11.7）。認証不要でローカルの設定から生成できるため、CI で再生成しても hermetic さは保てる。

### 4.2 Static Assets

- `assets.directory: ./dist`、`html_handling: auto-trailing-slash`、`not_found_handling: none`、`run_worker_first` は未指定（既定 false）。SPA ではなくサーバ側描画中心なので、静的ファイル優先で Worker にフォールバックする既定で足りる[^assets-routing]。
- 静的ページのレスポンスヘッダは `src/web/_headers`（手書き）。Worker 側の `src/server/lib/headers.ts` と同じ値を持ち、`test/unit/server/lib/headers.test.ts` で一致を検査する。片方だけ変えると CI が落ちる（docs/design.md §9.1）。
- 可変パス（`/:id/edit`）で静的 HTML を返すときは `env.ASSETS.fetch(new URL('/edit', request.url))` で取り、`new Response(res.body, res)` で包み直してからヘッダを足す（`src/server/lib/assets.ts`）。

### 4.3 D1

- SQL は `db.prepare(sql)` で用意し、`.bind()` した文を `db.batch()` に載せる。同じ SQL をループで使うときは `prepare` をループの外で 1 回だけ呼び、`.bind()` だけを繰り返す。理由は同じ SQL 文字列を 1 箇所に書くため（DRY）。`prepare()` はクライアント側でオブジェクトを作るだけでネットワーク往復は無く、性能差は無い[^d1-batch]。
- 複数行をまとめて変更するときは `db.batch()` を使う。batch 内の文は逐次実行され、1 文でも失敗すると batch 全体がロールバックされる（トランザクションとして扱われる）。`pages` + `events` の INSERT、レート制限カウンタの更新はこの原子性に依存しており、部分コミットを前提にした補償処理は書かない[^d1-batch]。
- 1 クエリのバインドパラメータは 100 個まで。`IN (...)` は `D1_MAX_BIND_PARAMS` で分割する（`src/adapters/d1/d1PageRepository.ts` の `deleteByIds`）[^d1-limits]。
- マイグレーションは `migrations/NNNN_name.sql` のフラット構成。`migrations_pattern` は使わない。`wrangler dev` は自動適用しないので、ローカル・CI は `wrangler d1 migrations apply calshare --local` を先に流す（docs/design.md §10.4）。
- 結合テストのマイグレーションは `readD1Migrations` + `applyD1Migrations`（§7.2）。
- Sessions API（読み取りレプリカ）は使わない。GC とレート制限がプライマリ 1 台の整合を前提にしており、導入には設計の見直しが要る（§11）[^d1-read-replication]。

### 4.4 R2

- ics・OGP 画像・フォントを置く。キーの規約は docs/design.md §2.3・§2.5（`ics/{id}.ics`、`ogp/{id}/{version}.png`、`fonts/...`）。
- 期限管理はアプリ側の GC で行い、R2 のライフサイクルルールは使わない。D1 の `pages` 行の削除と R2 の削除を同じ処理で順序づけて行う設計（R2 を先に消し、失敗したら D1 の行を残して再試行）を保つため（docs/design.md §2.6）。
- `env.ASSETS.fetch()` や R2 から得た Response のヘッダは読み取り専用。加工するときは `new Response(body, res)` で包み直す。

### 4.5 Cache API

- `caches.default` は `src/server/lib/edgeCache.ts` の `withEdgeCache` 経由でだけ使う。キーはデコード済みの正規パスから組み、クエリは OGP の `?v=` 以外落とす（docs/design.md §2.4）。
- `cache.delete()` には頼らない（実行した colo にしか効かない）。短い TTL で吸収する。
- Hono の `cache` ミドルウェアは使わない（§5.7）。

### 4.6 Cron Triggers

- `"0 19 * * *"`（UTC）= JST 04:00。Cron は UTC で動く[^cron]。
- `scheduled` ハンドラは冪等に書き、ロックは持たない。処理件数はバッチ上限（`GC_BATCH_SIZE` × `GC_MAX_BATCHES_PER_RUN`）で打ち切り、壁時計上限（15 分）に近づけない[^workers-limits]。
- 例外で止まったら件数付きで `gc_failed` をログし、再スローする（次回に再試行される）。

### 4.7 ログと secrets

- ログは `Logger` ポート経由の構造化ログ（イベント名 + フィールド）。`console.log` を直接呼ばない。生 IP・編集トークン・入力本文はログに出さない（docs/design.md §9.6）。
- `error` フィールドは `consoleLogger` が `{ name, message }` に正規化し、message は `MAX_LOG_ERROR_MESSAGE_LENGTH` で切る。
- secrets（`RATE_LIMIT_PEPPER` `REPORT_WEBHOOK_URL`）は Worker 単位の secret として `scripts/cf/ensure-secret.mjs`（内部で `wrangler secret put` 相当）で登録する。`vars` や `wrangler.jsonc` に書かない。ローカルは `.dev.vars`（gitignore）[^workers-secrets]。
- Secrets Store（アカウント横断）は使わない。Worker が 1 つしか無い。
- Workers Static Assets のパス、D1・R2 のバインディング名は `wrangler.jsonc` と `src/server/env.ts` の `Env` で一致させる。`Env` を手書きにしているのは secret の optional 性（`?`）を表すため。

---

## 5. Hono

### 5.1 アプリの構成

- `createApp(deps): Hono<{ Bindings: Env }>`（`src/server/app.ts`）が唯一の組み立て場所。`routes/*.ts` は `xxxRoutes(deps): Hono<{ Bindings: Env }>` を export し、`app.ts` は `app.route('/', xxxRoutes(deps))` を docs/design.md §2.2 の評価順で 1 行ずつ足す。ルートの中身は `routes/*.ts` に置き、`app.ts` には書かない（docs/design.md §11.6）。
- Hono 公式は「Rails 風のコントローラに分けず、ルート定義の場でハンドラを書く」ことと、大きなアプリは `app.route()` でサブアプリに分けることを推奨している[^hono-best-practices]。本リポジトリのルートごとのサブアプリはこの推奨に沿う。
- ハンドラをルート定義から切り出すと `c.req.param()` の型推論が効かなくなる。切り出す必要があるときだけ `createFactory().createHandlers()` を使う[^hono-best-practices]。
- パスパラメータは `:id{pattern}` で形式を絞る（`PAGE_ID_PATTERN`）。形式に合わないパスはどのルートにも一致せず、`app.notFound`（§5.4）が処理する（`:name{regexp}` は公式のルーティング構文）[^hono-routing]。
- `xxxRoutes(deps)` は自分のルートを登録し終えてから返り値として `app.route('/', ...)` に渡す。Hono 公式も「先にルートを登録してから `route()` に渡す」順序を守らないとマウントされず 404 になる、という落とし穴を明記している[^hono-routing]。
- `src/server/index.ts` は `export default { fetch, scheduled }` のみ。リクエストごとに `buildDeps(env)` で Deps を組み立てる。

### 5.2 Context と依存

- 依存（D1・R2・時計・ID 生成・ロガー）は `Deps` から取る。`c.env` から直接バインディングを触らない。テストで `createApp(fakeDeps)` に差し替えられる設計を保つため。`ASSETS`（`Fetcher`）だけは例外で `c.env.ASSETS` を直接使う（`editPage.ts` `ogp.ts`）。結合テストは本物の Static Assets を経由して検証する設計（§7.2）で Fake が要らないため。
- Hono 公式が示す依存の受け渡し方は `c.set()` / `c.get()`（`Variables` ジェネリクス、`c.var`）だが、本リポジトリは採らず `Deps` をクロージャで渡す。理由は 2 つ: (1) `c.set` はミドルウェアの登録有無に関わらず型だけが付き、登録されていないハンドラで `c.get()` が実行時 `undefined` を返しても型エラーにならない（`ContextVariableMap` の既知の注意点として公式ドキュメントが明記している）。`Deps` の引数は登録漏れがあれば型エラーになる。(2) `createApp(fakeDeps)` で丸ごと差し替えられ、Fake を渡す経路が 1 箇所で済む[^hono-context]。
- `Request` レベルの API（ヘッダ・本文ストリーム）は `c.req.raw` を使う。`c.req.header()` など Hono のラッパでも構わないが、ミドルウェア関数（`assertSameOriginJsonRequest` `readJsonBody`）は `Request` を受け取る形にして Hono に依存させない。
- `ctx.waitUntil` は `c.executionCtx` から取る。Workers がリクエストごとに渡す ctx（`app.fetch(req, env, ctx)` の第 3 引数）を Hono が保持しているだけの getter で、ctx を渡さずに呼ぶと例外を投げる（`node_modules/hono@4.13.9` の `context.js`）[^hono-context]。
- ルート名をログに出すときは `routePath(c)`（`hono/route`）を使う。生の URL を出すと ID や入力がログに混ざる[^hono-route]。`HonoRequest` には同名の `c.req.routePath` ゲッタ・`c.req.matchedRoutes` ゲッタも残っているが、いずれも `@deprecated` で「`hono/route` の同名ヘルパを使え」と型定義に明記されている（`node_modules/hono@4.13.9` で確認）。本リポジトリはすでに非推奨側を使っていない[^hono-request-source]。

### 5.3 ミドルウェア

- `createMiddleware`（`hono/factory`）で書き、`app.use('*', ...)` で登録する。登録順が適用順なので、`securityHeaders()` は全ルートより先に置く。Hono 公式も「先に登録したミドルウェアの `next` 前の処理が最初に、`next` 後の処理が最後に実行される」と、外側のミドルウェアが内側を包む実行順を明記している[^hono-middleware]。
- レスポンスのヘッダを触るミドルウェアは、`await next()` の後に `c.res = new Response(c.res.body, c.res)` で包み直してから `headers.set` する。Cache API から返る Response はヘッダが不変（docs/design.md §9.1）。
- 状態変更 API の入口検査（Content-Type・同一オリジン・本文 byte 上限・JSON の形）は、ルート内で `assertSameOriginJsonRequest` → `readJsonBody(request, parse)` の順に呼ぶ。順序は docs/design.md §5.7。

### 5.4 エラーハンドリング

- ルートが意図的に返すエラーは `ApiRequestError`（`src/server/lib/errors.ts`）を throw する。HTTP ステータスと `ApiErrorCode` を持つ。
- 例外から JSON レスポンスへの変換は `app.onError` の 1 箇所で行う。各ルートに `try / catch` と `c.json(body, status)` を繰り返し書かない。Hono 公式も `onError` を例外の集約点として示している[^hono-exception]。
  - `HTTPException` は Hono 自身が投げることがあるので `err.getResponse()` をそのまま返す。
  - `c.req.path` が `/api/` で始まるルートでは、`ApiRequestError` もそれ以外の例外も `toApiErrorResponse` で `ApiError` 形式の JSON にする（後者は `{ code: 'INTERNAL' }` の 500）。HTML ルート（詳細・編集・通報ページ）では従来どおり `c.text('Internal Server Error', 500)`。web は `src/web/lib/api.ts` がこの `code` を読み、呼び出し側が `apiErrorMessage`（`src/web/lib/messages.ts`）で文言を出し分ける。`test/integration/server/apiPages.create.test.ts` も `errorCode(res) === 'INTERNAL'` を検査しているため、この分岐が無いと落ちる。
  - 5xx になるものと `ApiRequestError` 以外の例外は `deps.logger.error` に `routePath(c)` と `pageId` を付けて記録する。
  - `HTTPException.getResponse()` は Context を知らない。`securityHeaders()` が外側で包み直すので、ヘッダの付け直しは不要。Hono の合成処理（`compose.ts`）は各階層の `dispatch` に `onError` を渡しており、例外は投げた階層でその場で `onError` に変換され、`context.res` に入った状態で呼び出し元へ、例外を投げずに戻る。つまり `securityHeaders()` の `await next()` は例外を受け取らず正常に完了し、後続の `c.res = new Response(...)` によるヘッダ付け直しが必ず実行される（`node_modules/hono@4.13.9` の `dist/compose.js` で確認）[^hono-compose]。
  - `hono/csrf` `hono/body-limit` のような標準ミドルウェアを将来 `/api/*` に足す場合、それらが投げる `HTTPException` の `getResponse()` は JSON ではない（例: `hono/csrf` の既定応答は `text/plain` の `Forbidden`）。§5.7 の判断が続く限り起きないが、追加するときは `onError` 側で `/api/*` 判定に合わせて JSON へ詰め直すことを検討する。
- HTML ページ（詳細・通報）の 404 は `NotFound` ビューを表示する。`detail.tsx` のように自分で `c.html(<NotFound />, 404)` を返してもよいし、`reportPage.tsx` のように `c.notFound()` を呼んで下の `app.notFound` に任せてもよい。API の 404 は `ApiRequestError(404, 'NOT_FOUND')`。
- どのルートにも一致しないリクエストと `c.notFound()` の応答は、`createApp` の最上位 `app`（`app.ts`）に 1 箇所だけ登録した `app.notFound` が返す。実体は `src/server/lib/notFound.tsx` の `handleNotFound`。Hono は `notFound` が「top-level app からしか呼ばれない」と明記しており、`routes/*.ts` の各サブアプリに `notFound` を登録しても効かない[^hono-app][^hono-base-source]。サブアプリ内の `c.notFound()` も、リクエストを最初にディスパッチした app（＝ `createApp` の app）の `notFound` ハンドラを実行する（`hono-base.js` の `Context` 生成箇所で確認）。`handleNotFound` は `onError` と同様に `c.req.path` で 3 通りに振り分ける: `/api/*` は JSON、`.ics` で終わるパス（`ics.ts` の `c.notFound()` もここに来る）はプレーンテキスト、それ以外は `NotFound` ビュー。
- HTTP ステータスは `ApiRequestError` を作る時点から `ContentfulStatusCode` 型で持ち、`as` キャストは書かない。`c.json(body, status)` の第 2 引数は `number` を受けないため、`number` で持つとどこかでキャストが必要になる。

### 5.5 JSX（hono/jsx）

- SSR は `hono/jsx` の自動エスケープに依存する。ユーザー入力は子要素か属性値としてだけ渡す。`dangerouslySetInnerHTML`・`raw`・文字列連結の HTML は禁止（ESLint で検出。docs/design.md §9.1）[^hono-jsx]。この前提が壊れた実例として、`hono/jsx` は 4.13.7 で「`Suspense`・`ErrorBoundary`・`Context.Provider` の子（または `fallback`）、または `renderToString()` / `renderToReadableStream()` にトップレベルの値として生の文字列をそのまま渡すとエスケープされない」XSS（GHSA-hxh3-vqpv-xpqv、影響範囲 `< 4.13.7`、修正版 `4.13.7`）を修正している。本リポジトリはこの 5 つのいずれも使っていない（`grep -rnE "Suspense|ErrorBoundary|Context\.Provider|createContext|renderToString|renderToReadableStream" src/` で 0 件、2026-09-27 実行）ため影響は無い。`^4.13.0` という範囲指定自体は 4.13.7 より前の版も許容するが、lockfile が固定する 4.13.9 は修正版に当たる。このアドバイザリは 2026-09-04 公開と新しく、`npm audit` が読む横断的な advisory データベースにはまだ乗っておらず（`gh api /advisories/GHSA-hxh3-vqpv-xpqv` は 404）、`npm audit` の 0 件はこの件の裏取りにならない。判断はリポジトリ個別の advisory（`gh api repos/honojs/hono/security-advisories`）が示す影響範囲 `< 4.13.7` に基づく[^hono-jsx-security]。
- `html` タグ付きテンプレート（`hono/html`）は `Layout.tsx` の `<!DOCTYPE html>` にだけ使う。hono/jsx は `<html>` を描いても DOCTYPE を付けない。JSX Renderer ミドルウェア（`hono/jsx-renderer`）の `jsxRenderer()` は `docType` を渡さなければ同じことをするが、ミドルウェアとして登録した上で各ルートが `c.render(...)` を呼ぶ設計になり、`Layout` を「値を渡すだけの関数コンポーネント」として各 View から直接呼べる今の形より Context に依存する。値渡しのテストしやすさを優先し、`hono/jsx-renderer` は採らない[^hono-jsx-renderer]。
- メモの改行は文字列を `\n` で分割し、要素の間に `<br>` を挟む JSX で表す。
- 条件付き描画は `{cond && <X />}`。`Content` 型（`Layout.tsx`）に `boolean | undefined` を含めてあるのはこのため。
- インライン `style` 属性・インライン `<script>` は書かない。CSP が `'self'` のみ（docs/design.md §9.1）。
- 絶対 URL は `config.publicOrigin` から組む。`c.req.url` や `Host` は使わない（docs/design.md §9.9）。
- 非同期コンポーネントは使わない。データ取得はルートで済ませ、ビューには値を渡す。

### 5.6 ルートの型と API の契約

- リクエスト・レスポンスの型は `src/core/api/types.ts` に置き、web と server で共用する。ルートは `const response: GetPageResponse = {...}` と型注釈を付けてから `c.json(response)` する。
- Hono の RPC（`hc<AppType>`）は使わない。クライアント JS を最小に保つ（docs/concept.md）ため、fetch の薄いラッパ（`src/web/lib/api.ts`）で足りる。RPC の型推論は `app.get(...).post(...)` のようにメソッドチェーンで組み、`export type AppType = typeof app` した場合にだけ効く[^hono-best-practices][^hono-rpc]。本リポジトリの各 `routes/*.ts` は `xxxRoutes(deps): Hono<{ Bindings: Env }>` を返す独立した関数（docs/design.md §11.5・§11.6）で、チェーンさせず `app.route('/', xxxRoutes(deps))` で合成するため、採用するには route 定義そのものを組み替える必要があり、クライアント JS 削減という目的に対してコストが見合わない。

### 5.7 標準ミドルウェアを使う・使わない

| ミドルウェア / ヘルパ | 判断 | 理由 |
|---|---|---|
| `hono/factory`（`createMiddleware`） | 使う | 型付きのミドルウェア定義の標準的な方法[^hono-best-practices] |
| `hono/route`（`routePath`） | 使う | ログにルートパターンを出す[^hono-route] |
| `hono/http-exception` | `onError` で受けるだけ | 自分では throw しない。`ApiRequestError` を使う[^hono-exception] |
| `hono/cookie` | 使う（device cookie） | `generateCookie()` は Context 無しで属性付きの Set-Cookie 文字列だけを作れる公式 API。手書きしない[^hono-cookie] |
| `hono/html` | DOCTYPE のみ | 上記 §5.5 |
| `hono/utils/http-status`（`ContentfulStatusCode`） | 型 import のみ。`src/server/lib/errors.ts` の 1 ファイル | `c.json(body, status)` の第 2 引数が `number` を受けないため、`ApiRequestError` のステータスをこの型で持つ。routes/*.ts では import しない |
| `hono/utils/cookie`（`parse`）・`hono/utils/html`（`HtmlEscapedString`） | `parse` は値 import（`deviceCookie.ts`）、`HtmlEscapedString` は型 import（`Layout.tsx`）に限る | `getCookie(c, name)` は Context が要るが、`readDeviceId` は §5.2 の方針で `Request` しか受け取らないため、`hono/cookie` より低レベルな `parse` を使う。`utils/` 配下は公開 API としての文書化が薄いので、この 2 つ以外の `hono/utils/*` は足さない |
| `secureHeaders()` | 使わない | (1) 既定で `Cross-Origin-Resource-Policy` `Cross-Origin-Opener-Policy` `Origin-Agent-Cluster` `Strict-Transport-Security` `X-DNS-Prefetch-Control` `X-Download-Options` `X-Permitted-Cross-Domain-Policies` `X-XSS-Protection` など `_headers`（§4.2）に無いヘッダを足す。全部 `false` にすれば消せるが、それなら自前で列挙するのと変わらない。(2) CSP はディレクティブ名ごとの配列を持つオブジェクト（`ContentSecurityPolicyOptions`）でしか渡せず、本リポジトリの 1 文字列定数（`CONTENT_SECURITY_POLICY`）をそのまま渡す口が無い。(3) 実装の `setHeaders()` は `ctx.res.headers.set(...)` を直接呼び、Cache API から返る不変ヘッダの Response（§4.5）を再ラップしない。`withEdgeCache` 経由のレスポンスに適用すると例外になりうる（`c.res` の getter は前段が書き込んだ Response をそのまま返すだけで、代入時のような再ラップは起きない。`node_modules/hono@4.13.9` の `context.js`・`secure-headers.ts` で確認）。自前の `securityHeaders()` は `next()` の後に `new Response(c.res.body, c.res)` で包み直してから `set` するため安全[^hono-secure-headers][^hono-secure-headers-source] |
| `hono/csrf` | 使わない | フォームで送れる Content-Type（`application/x-www-form-urlencoded` `multipart/form-data` `text/plain`）のリクエストにしか Origin / `Sec-Fetch-Site` を検査しない。本リポジトリの状態変更 API は `application/json` 以外を 415 で弾く設計（docs/design.md §9.8）で、防ぎたい対象はまさに JSON リクエストだが `hono/csrf` はそれを検査対象外にする。さらに同じフォーム系 Content-Type のときに限っても、両ヘッダとも無いリクエストを既定で拒否し、本リポジトリの「両方無ければ通す」（Content-Type 検査に任せる）方針と逆になる。拒否時のレスポンスも `HTTPException(403, { res: new Response('Forbidden', ...) })`（`text/plain`）で、`assertSameOriginJsonRequest` が投げる `FORBIDDEN_ORIGIN` の JSON（`test/integration/server/sameOrigin.test.ts` が検査）と形が違う[^hono-csrf][^hono-csrf-source] |
| `hono/body-limit` | 使わない | `Content-Length` 事前チェック→無ければストリームを数えながら打ち切る、という中身は `readJsonBody`（`jsonBody.ts`）と同等。`bodyLimit()` の `onError` は独立したコールバックで `ApiRequestError` / `toApiErrorResponse` の JSON 形式に合わせて書き直す必要があり、エラー整形の場所が増えるだけで削減にならない[^hono-body-limit] |
| `hono/timing` | 使わない | クライアントに見える `Server-Timing` ヘッダを作るためのミドルウェアで、`Logger` ポートに一本化したサーバ側の構造化ログ（docs/design.md §9.6・`requestLog`）とは目的が違う。採用するとしてもログ基盤の置き換えにはならない[^hono-timing] |
| `hono/request-id` | 今は採らない | リクエスト単位の相関 ID を `c.get('requestId')` で持てるが、docs/design.md §9.6 のログ設計は「ルート完了時に 1 行」を前提にしており相関 ID を使う設計になっていない。`rate_limited` 等の途中ログ（`rateLimit.ts`・`apiReports.ts`）と `requestLog.ts` の完了ログを ID で結びたくなったら、docs/design.md §9.6 の設計変更として検討する[^hono-request-id] |
| `hono/validator`・`@hono/zod-validator`・`@hono/standard-validator` | 使わない | Hono 公式は組み込み validator を thin と位置づけ第三者バリデータ（Standard Schema 経由の Zod / Valibot / ArkType を含む）を推奨するが、本リポジトリは意図的に外れる。入力検証の中身は core の `validateEventFields`（順序付きの業務ルール）で、スキーマ検証ではない。JSON の形の検査は数行で済んでおり、依存を増やす利益が無い。API の形が増えたら server 層に限って再検討する（§9）[^hono-validation] |
| `hono/logger` | 使わない | 色付き・人間可読の開発向けログで、構造化ログ（`Logger` ポート）の代わりにならない。一本化する[^hono-logger] |
| `hono/cors` | 使わない | 同一オリジンのみ。CORS を開けない（docs/design.md §9.8）[^hono-cors] |
| `hono/cache` | 使わない | キーの正規化（クエリ落とし・`%XX` の統一）を `withEdgeCache` で行う必要がある。加えて Cloudflare 公式は「カスタムドメインの Worker だけが機能する Cache 操作を持つ」としており、`hono/cache` も同じ制約を明記している。現状 `workers_dev: true`（§4.1）の間はどのみち恩恵が薄い（§12）[^hono-cache][^cf-cache-api] |
| `hono/etag`・`compress` | 使わない | エッジと Static Assets が担う[^hono-etag] |

---

## 6. フロントエンド

### 6.1 ビルド（esbuild、`scripts/build-web.mjs`）

- エントリは `src/web/*/main.ts`。出力は `dist/assets/js/<dir>.js`。HTML・CSS・画像・`_headers` はコピーするだけ。
- `format: 'esm'`、`bundle: true`、`minify: true`、`target: 'es2022'`。tsconfig の `target` と揃える。対象ブラウザ（モバイル Safari / Chrome、LINE 内蔵ブラウザ = システム WebView）は ES2022 を実行できる。browserslist 連携のプラグインは入れない[^esbuild-target]。
- `create` と `edit` が `preview.ts` `tapEdit.ts` を共有している。`splitting: true` + `chunkNames: 'chunks/[name]-[hash]'`（`outdir` からの相対パス。`dist/assets/js/chunks/` に出る）で共有チャンクに出せる（`format: 'esm'` が前提）[^esbuild-splitting]が、使わない。合計バイト数は減るが、共有チャンクが別リクエストになり、どの画面もページ単体の初回ロード（バイト数・リクエスト数）が増えるため。判断はページ単体の初回ロードで行い、全画面の合計では行わない（§9.2）。`metafile` は常設しない[^esbuild-metafile]。
- ファイル名にハッシュを付けず、`_headers` の `/assets/*` を `max-age=300` にしている。ハッシュ化には静的 HTML の `<script src>` をビルド時に書き換える仕組みが要り、「静的 HTML はそのままコピーする」足場の単純さを壊す（§9）。
- `scripts/build-web.mjs` を変えるときは、e2e（`npm run test:e2e`）と `dist/` の目視で確認する。

### 6.2 HTML / CSS

- 静的 HTML は `src/web/pages/*.html`。アセット参照は `/assets/...` の絶対パス（`edit.html` が `/:id/edit` で配信されるため。docs/design.md §11.6）。
- インラインスタイル・インラインスクリプトを書かない。CSS は `src/web/styles/*.css`、JS は `type="module"` の外部ファイル。
- 色は `base.css` の `:root` にカスタムプロパティ（`--fg` `--bg` `--border` など）で定義し、各 CSS はそれを参照する。`@media (prefers-color-scheme: dark)` で `:root` の値だけを上書きする。OS がダークモードのとき、背景だけ暗転して文字が薄いグレーのまま残るコントラスト不足を防ぐ[^prefers-color-scheme]。
- アニメーション・トランジションを足すときは `@media (prefers-reduced-motion: reduce)` で無効化する記述を同じ PR で書く[^prefers-reduced-motion]。
- CSS nesting・`:has()`・論理プロパティは使ってよいが、既存の書き方を書き換えるためだけの変更はしない。
- `field-sizing: content` はまだ Baseline Newly Available（Widely Available は 2028 年見込み）。JS の `autoResizeTextarea` を置き換えない[^field-sizing]。
- プレビュー編集欄を持つ画面（作成・編集: `index.html` `new.html` `edit.html`）では `<form>` は使わない。プレビュー編集欄の `<input>` で Enter を押したときの暗黙送信を避けるため。送信は `<button type="button">` の click で行う。SSR の通報画面（`views/ReportPage.tsx`）は、入力が radio と textarea だけで暗黙送信が起きても困らず Enter で送信できたほうが望ましいため、`<form>` と `type="submit"` を使ってよい。

### 6.3 DOM 操作

- `document.createElement` + `textContent` + `setAttribute` だけで組む。`src/web/lib/dom.ts` の `createElement` `requireElement` を使う。`innerHTML` 系は ESLint で禁止。
- 静的 HTML に存在するはずの要素は `requireElement(id, Ctor)` で取り、無ければ例外にする。HTML と JS のずれを起動時に検出するため。
- 状態は `ItemState<T>` のような判別可能なユニオンで持ち、変更後に `render()` を明示的に呼ぶ。フレームワーク・Signals・テンプレートエンジンは入れない（docs/concept.md「クライアント JS は最小」、§9）。
- テストが要素を拾うための印は `data-testid`。CSS や JS のセレクタに `data-testid` を使わない。

### 6.4 Web API

- ブラウザから API を呼ぶ `fetch`（作成・取得・更新・通報）には `signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)` を渡す。`src/web/lib/api.ts` の `fetchWithTimeout` を使い、`fetch` を直接呼ばない。回線が不安定な環境（LINE 内蔵ブラウザ）で応答が返らないと、送信ボタンが無効のまま固まって見える。タイムアウト値は `core/config/limits.ts` に置き、`AbortError` / `TimeoutError` は `ApiRequestFailedError` 相当に変換してユーザーに文言を出す[^abortsignal-timeout]。
- クリップボードは `navigator.clipboard.writeText` を試し、失敗時に `document.execCommand('copy')` にフォールバックする（`src/web/lib/clipboard.ts`）[^clipboard]。
- Web Share API は `typeof navigator.share === 'function'` で機能検出してからボタンを出す。Firefox が未対応で Baseline に達していない[^web-share]。
- localStorage の値は信頼しない。`JSON.parse` の結果を構造チェック（`isStoredHistoryEntry`）してから使う。読み書きは try / catch で包み、使えない環境でも画面が動くようにする。
- `structuredClone` は必要になったら使う。現状はフラットな構造の浅いコピーで足りている。

### 6.5 アクセシビリティ

- 動的に現れるメッセージには最初からマークアップで役割を付ける。エラー（`#error-message` `#load-error-message` `#copy-error`）は `role="alert"`、成功・結果（`#copy-message`）は `aria-live="polite"`。SSR 側（`views/ReportPage.tsx` の `#report-result`）は既に付いている。JS は `textContent` と `hidden` の操作だけにし、属性を後から足さない[^aria-live]。
- 入力欄とボタンにはラベルを結ぶ。タップ編集欄（`tapEdit.ts` の `buildTextItem` `buildDatetimeItem`）は「タイトル」「場所」「メモ」「日時」の `<span>` に `id="label-<key>"` を振り、排他表示される `viewButton`（自動）と `input`（手動）の両方から `aria-labelledby` で参照する。`viewButton` は現在の値も読み上げさせるため、値の `<span>`（`id="value-<key>"`）も並べて参照する。`<label for>` は 1 要素しか指せないため、排他表示される `viewButton` と `input` の 2 要素を 1 つのラベルから指すタップ編集欄では使わない。`startInput` / `endInput` は既に `<label>` で包まれているので対象外[^label]。作成・編集画面（`index.html` `new.html` `edit.html`）の `#input` は参照先が 1 つなので、見た目を変えない `.visually-hidden` の `<label for>` で結ぶ。
- フォーカスを持つ要素を隠すときは、隠す側が次のフォーカス先を決めて `focus()` を呼ぶ。「自動に戻す」で入力欄を `hidden` にしたら `viewButton.focus()` する。
- 色だけで状態を伝えない。`is-manual` の状態は、入力欄への切り替えと「自動に戻す」ボタンの表示で伝わり、枠線の色は補助として使う。
- 文字に使う色は、ライト・ダークとも背景色に対するコントラスト比を 4.5:1 以上にする（WCAG 2.2 達成基準 1.4.3）[^wcag-contrast]。色の定義場所は §6.2。

### 6.6 CSP との整合

- CSP 文字列は `src/server/lib/headers.ts` の `CONTENT_SECURITY_POLICY` と `src/web/_headers` の 2 箇所に同じ値を書き、unit テストで一致を検査する。変えるときは同じ PR で両方を変える。
- `require-trusted-types-for 'script'` を CSP に加える。`innerHTML` 等の禁止を ESLint（ビルド時）に加えてブラウザ（実行時）でも強制する。Chrome / Edge 83+、Safari 26、Firefox 148（2026-02）で対応し Baseline に達した。未対応ブラウザは無視するだけで壊れない[^trusted-types]。導入時に e2e の全 spec でコンソールに CSP 違反が出ないことと、Trusted Types が実際に強制されることを確認した（PR #64）。
- 新しい外部リソース（フォント・画像・API）を足すことは原則しない。足すなら `_headers` と `headers.ts` の両方と、docs/design.md §9.1 を更新する。

---

## 7. テスト

### 7.1 unit（Vitest、Node）

- 対象は `src/core/**`・`src/adapters/**` の Fake と純粋部分・`src/server/lib/**`・`src/web/**` のロジック。`environment: node`。
- `src/core` は外部依存ゼロなので、そのまま import して呼ぶ。表駆動テスト（`it.each`）で docs/design.md §5.6 のケースを写す。
- web のテストは jsdom を入れず、`vi.stubGlobal` で最小の `document` / `HTMLElement` の Fake を与え、`afterEach` で `vi.unstubAllGlobals()` する（`test/unit/web/lib/dom.test.ts`）[^vitest-stubglobal]。
- `fetch` などのグローバルのモックも `vi.stubGlobal` + `vi.unstubAllGlobals()`。`globalThis.fetch = ...` の直書きはしない。
- `vi.mock` によるモジュールモックは使わない。Fake を `Deps` で渡す設計で置き換える。使う場合は `vi.mock(import('./x'), async (importOriginal) => ...)` の現行の書き方に従い、ホイスティングを意識する[^vitest-mocking]。
- テストファイルの配置は `test/unit/<src と同じ階層>/<name>.test.ts`。
- 静的ファイル（`_headers`）を読むテストは Vite の `?raw` import を使う。`fs` は使わない（`tsconfig.web.json` に Node の型が無い）。

### 7.2 integration（`@cloudflare/vitest-pool-workers`）

- 対象は `src/adapters/**`（D1・R2・レート制限・OGP レンダラ）と `src/server/**`（ルート・GC・ミドルウェア）。workerd 上で本物の D1・R2・Cache API を使い、モックしない。
- バインディングと Worker 本体は `cloudflare:workers` から取る。`import { env, exports } from 'cloudflare:workers'` とし、`exports.default.fetch(url)` でルートを叩く。`cloudflare:test` の `env` と `SELF` は型定義で非推奨（`@deprecated`）になった[^pool-workers-deprecated][^pool-workers-migration]。
  - `exports.default.fetch()` は `SELF.fetch()` と同じく Static Assets のルーティング層を通らない。静的アセットは `env.ASSETS.fetch()` で直接検証する（`test/integration/server/staticAssets.test.ts`）。
  - `applyD1Migrations` `createExecutionContext` `waitOnExecutionContext` `reset` は `cloudflare:test` のまま使う（非推奨タグは無い）。
- ストレージ分離はテストファイル単位。同一ファイルの `it()` 間でデータが残る。`test/integration/setup.ts` の `beforeEach` で `reset()`（全バインディングのデータを削除）を呼び、その直後に `applyD1Migrations` を再適用する。各ファイルに `DELETE FROM ...` を書かない[^pool-workers-isolation][^pool-workers-test-apis]。
  - `reset()` は D1 のテーブル定義も削除する（実測。`reset()` 直後の `sqlite_master` が空配列になることを確認した）。`applyD1Migrations` を必ず後ろに置く。
  - `npm run test:integration` の所要時間は `reset()` 導入前の約 1.05 倍（手元で 12.8 秒 → 13.0〜13.6 秒、2026-09-27）。
- `ctx.waitUntil` の完了を待つ経路（OGP の R2 put、Webhook）は `createExecutionContext()` で ctx を作って `app.fetch(req, env, ctx)` を直接呼び、`waitOnExecutionContext(ctx)` の後に検証する。
- 状態変更 API のリクエストは `test/integration/helpers/jsonRequest.ts` で組む（Content-Type・Origin を付ける）。
- 時刻・ID は `createApp(fakeDeps)` で Fake に差し替える。`.dev.vars` に依存しない（`vitest.config.ts` の `miniflare.bindings` が優先する）。
- `test/integration/env.d.ts` で `Cloudflare.Env` にテスト専用バインディング（`TEST_MIGRATIONS` 等）を追記する。

### 7.3 e2e（Playwright）

- 全 spec は `test/e2e/fixtures.ts` の `test` / `expect` を import する。フィクスチャが時刻固定（`page.clock.setFixedTime`）とテストごとの送信元 IP（`CF-Connecting-IP`）を与える[^playwright-clock][^playwright-fixtures]。
- ロケータは `getByRole` `getByTestId` `getByLabel` を優先し、CSS セレクタは `#input` のような安定した id に限る。実装が構造や JS のフックとして使っている `data-section` `data-calendar` 属性は、CSS セレクタで引いてよい。アサーションは `toHaveText` `toBeVisible` など自動リトライ付きのものだけ。`isVisible()` の戻り値を `expect` に渡さない。`waitForTimeout` は使わない[^playwright-best-practices]。
- `retries` は CI で 1。再試行は trace とスクリーンショットを残すためで、`failOnFlakyTests: true` により再試行で通っても job は落ちる。flaky を隠さない[^playwright-testconfig]。
- reporter は CI では `github` + `html`、ローカルでは `list` + `html`。GitHub の PR 上に失敗行の注釈を出す[^playwright-reporters]。
- `webServer` は `seed-local-r2.mjs → build → wrangler dev` を起動し、`/api/health` で待つ。`E2E_PORT` で作業ツリーごとにポートを分ける。`.wrangler/state` を作り直すときは `wrangler d1 migrations apply calshare --local` を再実行する（docs/design.md §10.4）。
- シナリオは docs/design.md §10.3 の番号と spec の対応を保つ。新しいシナリオを足すときは §10.3 も更新する。

### 7.4 scripts（`node --test`）

- `scripts/**/*.test.mjs` と `.claude/skills/**/*.test.mjs` を `node --test "glob"` で流す。Node 22 はグロブを直接受け取る[^node-test]。
- アサーションは `node:assert/strict`。`t.assert.snapshot` は使わない（Node 22 でも安定 API だが、スナップショットファイルが `scripts/` 配下に増え、dry-run の出力を明示的な `assert` で検証する方が読み手に意図が伝わる）[^node-test]。
- 外部プロセス（`wrangler` `gh`）を呼ぶスクリプトは、`--dry-run` か環境変数で実行を止められるようにし、テストは dry-run の出力を検証する。

### 7.5 共通の禁止事項

- `it.only` / `test.only` をコミットしない。
- テストの並び順・ファイルをまたぐ状態に依存しない。
- 実ネットワークに出ない（Webhook は Fake、フォントはフィクスチャ、R2 はローカル）。
- テスト出力にログを残さない（`WRANGLER_LOG=warn` を `vitest.config.ts` が設定する）。
- 生成物（`dist/` `playwright-report/` `test-results/`）をコミットしない。
- カバレッジの数値目標は持たない（§11）。

---

## 8. CI と依存管理

### 8.1 GitHub Actions

- 使うアクションは GitHub 公式（`actions/checkout` `actions/setup-node` `actions/upload-artifact`）のみ。`uses:` はフルコミット SHA + `# vX.Y.Z` コメントで固定する[^gha-hardening]。
- Node は全ワークフローで `setup-node` の `node-version-file: .nvmrc` を使う。シェルで `.nvmrc` を読むステップは置かない（`|| echo 22` のようなフォールバックは `.nvmrc` の変更に気づけない）[^setup-node]。
- `permissions` はワークフロー既定を `contents: read` にし、ジョブ単位で必要な権限だけ足す。
- secrets（`CLOUDFLARE_API_TOKEN` `CLOUDFLARE_ACCOUNT_ID`）はそれを使うステップの `env` にだけ置く。ワークフロー・ジョブの `env` は配下の全ステップに見える[^gha-env]ため、`npm ci`（依存の postinstall）や checkout にも渡ってしまう。「使うステップだけに置く」は本リポジトリの判断で、provision.yml の書き方に揃える。
- `git push` をしないジョブの `actions/checkout` には `persist-credentials: false` を付ける。既定（true）はトークンをローカルの git 設定に残す[^checkout-readme]。push するジョブ（provision.yml の resources・zone_and_waf）は既定のまま。これも本リポジトリの判断。
- `wrangler` を直接または `scripts/cf/*.mjs` 経由で呼ぶ全ジョブ（deploy.yml の deploy、provision.yml の secrets・font、moderation.yml の moderate）に `npm ci` を置き、`npx wrangler`（バージョン指定なし）で呼ぶ。`npx wrangler@4` は specifier 付きなので lockfile の版と完全一致しない限りレジストリから最新 4.x を取りに行く[^npx]。`npm ci` の無いジョブで `npx wrangler` にすると、逆にローカルに無い wrangler を毎回取りに行くので、両方を揃える。
- ci.yml には `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` と job の `timeout-minutes`（e2e の 15 分を含めて 30 分程度）を置く。deploy / moderation / provision は状態を壊さないため `cancel-in-progress: false` を維持する。
- `wrangler deploy --dry-run --outdir dist-worker` を毎 PR で流し、バンドルが組めることを確かめ、出力サイズの推移を記録する（上限の検出が目的ではない。上限は §9.1）。起動時間制限（トップレベルの評価 1 秒[^workers-limits]）は dry-run では検出できないので、重い初期化は遅延させる設計（docs/design.md §2.5）を守る。
- ワークフローの `run:` に `inputs` や `vars` を直接展開しない。`env` 経由で受け取り、検証してから使う（moderation.yml・provision.yml の注記）。

### 8.2 Dependabot

- `npm` と `github-actions` の 2 エコシステム、weekly。npm は minor / patch を `npm-dependencies` グループにまとめる。github-actions にも `groups`（`patterns: ['*']`）を置き、SHA 更新の PR をまとめる。
- `ignore` に次を置く。理由は §1.1。
  - `satori`: `versions: ['>=0.33.0']`
  - `vitest`: `update-types: ['version-update:semver-major']`
  - `typescript`: `update-types: ['version-update:semver-major']`
  - `@types/node`: `update-types: ['version-update:semver-major']`（Node のメジャーを上げる PR でまとめて変える）
- cooldown は 2026-07-14 以降の既定（3 日）に任せる。明示するなら `cooldown.default-days` を書く[^dependabot-cooldown]。
- ignore を外す条件は §1.2 の四半期確認で判断する。

### 8.3 npm

- `package-lock.json`（lockfileVersion 3）をコミットし、CI は `npm ci`。
- `overrides` は脆弱性対応で上げられない間接依存にだけ使う（現状 `sharp`）。`npm view` で最新と一致したら外す。
- `private: true` なので provenance / trusted publishing / `packageManager` フィールドは対象外。
- `.npmrc` に `engine-strict=true`（§1.1）。

### 8.4 公開リポジトリ化の運用

- 公開時は `scripts/gh/harden-public-repo.sh` で secret scanning・push protection・private vulnerability reporting・ブランチ保護を有効にする（docs/runbooks/public-repo.md）。
- CodeQL の default setup は public リポジトリで無償。公開後に harden-public-repo.sh へ追加する（§11）。
- Cloudflare API が GitHub Actions の OIDC フェデレーションを受け付けないため、API トークン方式を続け、スコープ最小化（§8.1）で補う。本リポジトリは wrangler-action を使わず `npx wrangler` を直接呼ぶので、制約は wrangler-action ではなく Cloudflare 側にある[^cf-gha][^workers-sdk-oidc]。

---

## 9. ライブラリ選定の方針

### 9.1 原則

- `src/core` は外部依存ゼロ。ブラウザに同梱してライブプレビューに使うため、バンドルサイズと「サーバとプレビューが同じ実装」を守る（docs/design.md §2.1）。ESLint と `tsconfig.core.json` の `types: []` で機械的に保証する。
- `src/server` `src/adapters` への依存追加は、`wrangler deploy --dry-run` の出力サイズを PR に前後で書く。上限は uncompressed 64 MiB（Free / Paid 同じ。圧縮後サイズの上限は無い）[^workers-limits]で、resvg + satori を含めても余裕はあるが、推移を記録して増分の理由を説明できるようにする。
- `src/web` への依存追加は原則しない。必要なら esbuild の出力サイズを前後で比べる。
- 依存を足すときは license-review スキルで判定し、`docs/licenses/` に記録する。
- 「自前実装を保つ」判断は、calshare 固有の要件（URL を `[リンク]` に置換、JST 固定、Crockford Base32、順序付きの検証）がライブラリの汎用機能と合わないことによる。要件が変わったら見直す。

### 9.2 採らない提案と見直しの条件

| 提案 | 判断 | 理由 | 見直す条件 |
|---|---|---|---|
| TypeScript 6.0 / 7.0 | 今は採らない | 6.0.x は peer 範囲内だが 7 系への橋渡し版で新機能の利益が無い。7.0 には API が無く typescript-eslint がクラッシュする[^ts7][^tseslint-ts7] | typescript-eslint が 7.1 系 API に対応した版を出したら 5.9 → 7.x へ一度に更新 |
| Vitest 5 | 採らない | pool-workers の peer が `^4.1.0`[^pool-workers-peer] | pool-workers が 5 系対応を出したら |
| satori 0.33 系 | 採らない | harfbuzzjs が Workers で初期化できない[^satori-harfbuzz] | harfbuzzjs の wasm を差し替える公開 API が付いたら |
| takumi（satori 後継の Rust/wasm レンダラ） | 今は採らない | フォント読み込み方式・ライセンス・実性能が未検証 | OGP を作り直す機会に spike PR で gzip サイズと CPU-ms を実測 |
| workers-og | 採らない | satori 0.15 系に依存し、1 年以上リリースが無い | 無し |
| zod / valibot / arktype | core には採らない。server も今は不要 | `validateEventFields` は順序付きの業務ルールで、スキーマ検証で短くならない。JSON の形の検査は数行 | API の入力形が増えたら server 層に限り valibot を検討し、gzip サイズを測る |
| nanoid | 採らない | Crockford エンコードは 10 行強で、modulo bias が無い理由もコメント済み。core に依存が増えるだけ | 無し |
| date-fns / dayjs / Temporal | 採らない | JST 固定・DST 無しで汎用ライブラリは過剰。Temporal は Node 22 にも workerd にも安定して無い[^workerd-temporal] | Node LTS と workerd が Temporal を安定サポートしたら `core/time/jst.ts` の置き換えを検討 |
| `crypto.subtle.timingSafeEqual` | 採らない | Workers の Web Crypto に対する非標準拡張で Node に無い。core は Node でも動く必要がある[^cf-webcrypto] | 無し（adapters 層に移す設計変更が要る） |
| linkify-it | 採らない | 厳密判定と広い判定の 2 本立て・TLD 許可リスト・ReDoS 対策は汎用ライブラリに無い | 無し |
| ical-generator / ics | 採らない | URL 置換・制御文字除去の calshare 固有処理は結局自前になる。`ics` は依存を持つ | Phase 2 で RFC 7986 の拡張プロパティが多数必要になったら |
| Cloudflare Rate Limiting binding | 採らない | period が 10 秒 / 60 秒固定で hour / day 窓を表せない[^cf-ratelimit] | 無し（時間窓の一次防御としての併用は docs/design.md §9.3 に判断を残す） |
| KV / Durable Objects | 採らない | `db.batch()` の原子性に依存しており、KV の結果整合では壊れる。DO に移す具体的な利益が無い | D1 の書き込みレイテンシやカウンタ競合を実測して問題が出たら |
| D1 Sessions API | 今は採らない | GC・レート制限がプライマリ 1 台の整合を前提[^d1-read-replication] | §11 のオーナー判断 |
| R2 ライフサイクルルール | 採らない | D1 行と R2 オブジェクトの削除順序を自前で保証する設計 | 無し |
| Hono `secureHeaders` / `csrf` / `body-limit` / `timing` / `validator` / `logger` / `cors` / `cache` / `etag` / `compress` / `jsx-renderer` | 採らない | §5.5・§5.7 | 無し |
| Hono `request-id` | 今は採らない | §5.7 | docs/design.md §9.6 にログの相関 ID 設計が入ったら |
| Hono RPC（`hc`） | 採らない | クライアント JS を最小に保つ | 無し |
| eslint-plugin-perfectionist / import-x（import 順序） | 今は採らない | 差分が全ファイルに広がる。目視で乱れは無い | 導入するなら `perfectionist/sort-imports` 1 ルールだけを単独 PR で |
| eslint-plugin-unicorn | 採らない | 300 超のルールを持つ opinionated なプラグイン。既存コードへの一括修正が要る | 個別ルールを「なぜ要るか」と共に足すときだけ |
| `noPropertyAccessFromIndexSignature` | 採らない | §2.1 | 無し |
| TypeScript Project References | 採らない | §2.1 | 型チェックが遅くなったら `composite` + `references` を検討 |
| esbuild のハッシュ付きファイル名 + `immutable` キャッシュ | 採らない | 静的 HTML の書き換えが要り足場が複雑になる。5 分 TTL で実害は出ていない | デプロイ直後の新旧混在が問題になったら、HTML テンプレート化と dist の一致テストを含めて実施 |
| browserslist 連携（esbuild-plugin-browserslist） | 採らない | 対象ブラウザが狭く、`target: 'es2022'` で足りる | 無し |
| esbuild の splitting（共有チャンク） | 採らない | §6.1。どの画面もページ単体の初回ロードが増える | 画面遷移で共有チャンクのキャッシュが効く使い方が主になったら、metafile でページ単体の初回ロードを測り直す |
| `field-sizing: content` / `<form>` 化 | 採らない | §6.2 | field-sizing が Widely Available になったら `@supports` 併用を検討 |
| `<dialog>` / popover / View Transitions | 該当なし | 使う画面が無い | モーダルが要るときは `<dialog>` + `showModal()` を第一候補に |
| TC39 Signals | 採らない | Stage 1〜2 でブラウザ未実装。ポリフィルは外部依存 | Stage 4 かつ Baseline 化 |
| Renovate | 採らない | 単一リポジトリ・GitHub・npm のみで Dependabot のゼロコンフィグで足りる | マルチリポジトリや別エコシステムが増えたら |
| Node バージョンの matrix | 採らない | デプロイ先は Workers ランタイムで、Node の複数バージョン検証に意味が無い | 無し |
| Secrets Store | 採らない | Worker が 1 つ | Worker が複数になったら |

---

## 10. この版で決めた変更（要約）

いずれも実施済み（主に PR #63〜#72。docs 行は PR #76 で完了）。ここでは「変更前 → 変更後」を記録として残す。

| 領域 | 変更前 | 変更後 |
|---|---|---|
| npm | `.npmrc` なし | `engine-strict=true` |
| tsconfig | `strict` のみ | `verbatimModuleSyntax` `noUncheckedIndexedAccess` `exactOptionalPropertyTypes` `noImplicitOverride` を追加。層ごとに直し、0 件になった層の tsconfig（core → server / web）に先に入れ、最後に base へ移す |
| ESLint | `recommended`（型情報なし） | `recommendedTypeChecked` + `parserOptions.project`（3 tsconfig の配列） |
| Hono | 各ルートで try / catch と `c.json(body, status)` | `ApiRequestError` を throw し `app.onError` で 1 箇所変換 |
| CSP | Trusted Types なし | `require-trusted-types-for 'script'` を `headers.ts` と `_headers` の両方へ |
| D1 | `d1RateLimiter` がループ内で `prepare` | ループ外で 1 回 `prepare`、`bind` を繰り返す |
| esbuild | `target: 'es2020'` | `'es2022'`。splitting は採らない（§9.2）。docs/design.md §11.7 と `scripts/build-web.mjs` の先頭コメントも同時に更新 |
| web | fetch にタイムアウトなし | `AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)` |
| web | aria-live / label / フォーカス戻しなし | `role="alert"` `aria-live="polite"`、`aria-labelledby`、`viewButton.focus()` |
| CSS | ハードコード色、ダークモードなし | `:root` のカスタムプロパティ + `prefers-color-scheme: dark` |
| integration | `cloudflare:test` の `env` / `SELF`、6 ファイルに `DELETE FROM` | `cloudflare:workers` の `env` / `exports.default`、setup.ts の `reset()` |
| Playwright | reporter が固定 | CI で `github` を追加 |
| Actions | v7 タグ、Node 解決をシェルで重複、secrets がジョブ / ワークフロー全体、`npx wrangler@4`（ワークフロー・`scripts/cf/ensure-secret.mjs`・runbook） | SHA 固定、`node-version-file`、ステップ単位の secrets、`persist-credentials: false`、wrangler を呼ぶ全ジョブに `npm ci` + `npx wrangler`、ci.yml に concurrency / timeout |
| docs | design.md §2.5 のサイズ上限（Free 3MB / Paid 10MB）・起動 400ms | Limits ページの現行値（64 MiB uncompressed、1 秒）に更新 |
| Dependabot | ignore なし、actions のグループなし | satori / vitest / typescript / @types/node の ignore、actions の groups |

---

## 11. オーナー判断に残すもの

- Node 24 への移行時期。22 は 2027-04-30 まで、24 は 2028-04-30 までサポート。24 も 2026-10-20 に maintenance に入る[^node-schedule]。移行時は `.nvmrc`・`engines`・`@types/node`・4 ワークフローをまとめて変え、wrangler / pool-workers / esbuild を実機確認する。
- D1 Sessions API（読み取りレプリカ）の導入。詳細ページ等の読み取りレイテンシ改善が見込めるが、GC とレート制限の整合設計（docs/design.md §2.6・§9.3）を見直す必要がある。要調査 Issue として起票する。
- カバレッジ計測（`@vitest/coverage-v8`）の導入。docs/concept.md に数値目標は無く、表駆動テストで網羅性を担保している。数値が欲しいときだけ。
- Dependabot の cooldown 日数（既定 3 日を延ばすか）。
- CodeQL の有効化タイミング（public 化後、harden-public-repo.sh への追加）。
- takumi の spike を行うか（OGP まわりを次に触るとき）。

---

## 12. 要検証（規則にしていないもの）

一次資料で確認できていない、または実測が要る提案。試すときは小さな PR で typecheck 3 種と unit / integration を通す。

- `package.json` の `imports`（`#core/*`）で test 配下の深い相対 import（`../../../../src/core/...` が 61 ファイル）を短くする。`moduleResolution: bundler` ではサブパス import の拡張子省略はサポート外（Working as Intended）で、対象パターンに `.ts` を付ける（`"#core/*": "./src/core/*.ts"`）必要がある[^ts-imports-issue]。tsc・esbuild・Vitest（Vite）・wrangler の 4 系統で同じ解決になるかが未検証。
- CI に `npm audit signatures` を足す。署名を提供しないパッケージで誤検知しうるため、非ブロッキングから始める。
- Cache API（`caches.default`、`withEdgeCache`）は Cloudflare 公式ドキュメントで「カスタムドメインの Worker だけが機能する Cache 操作を持つ」と明記されている[^cf-cache-api]。現状 `wrangler.jsonc` は `workers_dev: true`（§4.1。独自ドメインを割り当てるまでの暫定）なので、`*.workers.dev` 上で `withEdgeCache` が実際にヒットするかは未確認。ヒットしなくても `produce()` が都度実行されるだけで壊れないが、キャッシュ導入の効果（D1・R2 の負荷軽減）が出ていない可能性がある。デプロイ環境（workers.dev、後にカスタムドメイン）で同じリクエストを 2 回送り、2 回目に `cache.match` がヒットするかを確認し、結果を Issue に記録する。

---

## 脚注（根拠）

[^node-schedule]: Node.js リリーススケジュール https://raw.githubusercontent.com/nodejs/Release/main/schedule.json （v22: maintenance 2025-10-21、EOL 2027-04-30。v24: LTS 2025-10-28、maintenance 2026-10-20、EOL 2028-04-30）。wrangler の `engines.node >=22.0.0` は `npm view wrangler engines`。
[^npm-engine-strict]: https://docs.npmjs.com/cli/v10/using-npm/config#engine-strict （Node 22 同梱の npm は 10.x）
[^cf-compat-flags]: https://developers.cloudflare.com/workers/configuration/compatibility-flags/ （2026-08-04 以降の日付で `nodejs_compat` `nodejs_compat_v2` が既定で有効）
[^ts7]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ （7.0 は API を持たず、7.1 で提供予定）
[^tseslint-ts7]: https://github.com/typescript-eslint/typescript-eslint/issues/12518 。`npm view typescript-eslint peerDependencies` → `typescript: '>=4.8.4 <6.1.0'`（6.0.x は範囲内）。https://typescript-eslint.io/users/dependency-versions
[^pool-workers-peer]: `npm view @cloudflare/vitest-pool-workers@0.22.0 peerDependencies` → `vitest: '^4.1.0'`。https://vitest.dev/blog/vitest-5.html
[^pool-workers-migration]: https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/
[^satori-harfbuzz]: `npm view satori@0.33.5 dependencies` に `harfbuzzjs` が残る（0.32.0 には無い）。バンドル方法によって失敗箇所は違うが、いずれも harfbuzzjs の Emscripten 初期化で落ちる: https://github.com/fineshopdesign/cf-wasm/issues/100 は `self.location.href` 経由（`Cannot read properties of undefined (reading 'href')`）、docs/design.md §2.5 の本リポジトリでの実機確認は fs 経由（`no such file or directory`）
[^eslint10]: https://eslint.org/docs/latest/use/migrate-to-10.0.0
[^gha-hardening]: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions （SHA 固定が「currently the only way to use an action as an immutable release」）
[^gha-env]: https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions （`env` はワークフロー全体で「available to the steps of all jobs」、ジョブの `env` はそのジョブの全ステップに見える）
[^checkout-readme]: https://github.com/actions/checkout （`persist-credentials` の既定は true）
[^tseslint-parser]: https://typescript-eslint.io/packages/parser/#projectservice （各ファイルに最も近い `tsconfig.json` を使う）
[^workers-limits]: https://developers.cloudflare.com/workers/platform/limits/ （Worker size uncompressed 64 MiB、圧縮後の上限なし、グローバルスコープの評価 1 秒、Cron Trigger の壁時計 15 分。Last updated 2026-09-05）
[^tsconfig-ref]: https://www.typescriptlang.org/tsconfig/
[^hono-jsx]: https://hono.dev/docs/guides/jsx
[^hono-best-practices]: https://hono.dev/docs/guides/best-practices
[^hono-routing]: https://hono.dev/docs/api/routing （`:name{regexp}` の構文。「先にルートを登録してから `route()` に渡さないと 404 になる」落とし穴）
[^hono-middleware]: https://hono.dev/docs/guides/middleware （「The process before the `next` of the first registered Middleware is executed first, and the process after the `next` is executed last」。先に登録したミドルウェアが後続を包む、いわゆる onion モデル）
[^hono-exception]: https://hono.dev/docs/api/exception
[^hono-route]: https://hono.dev/docs/helpers/route
[^hono-cookie]: https://hono.dev/docs/helpers/cookie （`generateCookie()`。Context 無しで Set-Cookie 文字列だけを作れる）
[^hono-secure-headers]: https://hono.dev/docs/middleware/builtin/secure-headers
[^hono-validation]: https://hono.dev/docs/guides/validation （Standard Schema Validator Middleware。Zod・Valibot・ArkType を同じ書き方で使える）
[^hono-context]: https://hono.dev/docs/api/context （`c.set()` / `c.get()` / `c.var`。`ContextVariableMap` の注記: 「adds types globally to all contexts, regardless of whether the middleware that sets the variable has actually run」）
[^hono-request-source]: `node_modules/hono/dist/types/request.d.ts`（4.13.9）。`HonoRequest` の `routePath` ゲッタ・`matchedRoutes` ゲッタはいずれも `@deprecated` で「Use routePath helper defined in "hono/route" instead」と明記されている
[^hono-compose]: https://github.com/honojs/hono/blob/v4.13.9/src/compose.ts （`dispatch` は呼び出しごとに `onError` を持ち、例外はその階層で捕まえて `context.res` に変換してから正常に復帰する。呼び出し元の `await next()` は例外を受け取らない）
[^hono-app]: https://hono.dev/docs/api/hono#not-found （「The `notFound` method is only called from the top-level app」）
[^hono-base-source]: https://github.com/honojs/hono/blob/v4.13.9/src/hono-base.ts （`route()` はサブアプリのルートを親の router にマージするだけで `notFoundHandler` は引き継がない。`#dispatch()` が `Context` 生成時に自分の `#notFoundHandler` を渡し、`Context#notFound()` はそれを呼ぶだけなので、実際に呼ばれるのは常にトップレベル app の handler になる）
[^hono-jsx-security]: https://github.com/honojs/hono/releases/tag/v4.13.7 （GHSA-hxh3-vqpv-xpqv。`Suspense`・`ErrorBoundary`・`Context.Provider`・`renderToString()`・`renderToReadableStream()` に渡した生文字列がエスケープされない XSS の修正。`gh api repos/honojs/hono/security-advisories` で `vulnerable_version_range: "< 4.13.7"`、`patched_versions: "4.13.7"` を確認）
[^hono-jsx-renderer]: https://hono.dev/docs/middleware/builtin/jsx-renderer
[^hono-rpc]: https://hono.dev/docs/guides/rpc （`export type AppType = typeof app` はメソッドチェーンで定義したときに型推論が効く）
[^hono-secure-headers-source]: https://github.com/honojs/hono/blob/v4.13.9/src/middleware/secure-headers/secure-headers.ts （`contentSecurityPolicy` はディレクティブごとの配列を持つオブジェクトのみ受け付ける。`setHeaders` は `ctx.res.headers.set(...)` を直接呼び、Response を包み直さない）
[^hono-csrf]: https://hono.dev/docs/middleware/builtin/csrf
[^hono-csrf-source]: https://github.com/honojs/hono/blob/v4.13.9/src/middleware/csrf/index.ts （`isRequestedByFormElementRe` に一致する Content-Type のときだけ検査する。`application/json` は一致せずスキップされる。検査対象のときに `Origin` と `Sec-Fetch-Site` が両方無いと、`isAllowedSecFetchSite`／`isAllowedOrigin` がどちらも `false` を返し拒否される）
[^hono-body-limit]: https://hono.dev/docs/middleware/builtin/body-limit
[^hono-timing]: https://hono.dev/docs/middleware/builtin/timing
[^hono-request-id]: https://hono.dev/docs/middleware/builtin/request-id
[^hono-logger]: https://hono.dev/docs/middleware/builtin/logger （「It's a simple logger」。色付きのステータスコードと人間可読の経過時間を出す開発向けミドルウェア）
[^hono-cors]: https://hono.dev/docs/middleware/builtin/cors
[^hono-cache]: https://hono.dev/docs/middleware/builtin/cache （「The Cache middleware currently supports Cloudflare Workers projects using custom domains」）
[^cf-cache-api]: https://developers.cloudflare.com/workers/runtime-apis/cache/ （「Workers deployed to custom domains have access to functional cache operations」）
[^hono-etag]: https://hono.dev/docs/middleware/builtin/etag
[^tseslint-typed]: https://typescript-eslint.io/getting-started/typed-linting
[^prettier-35]: https://prettier.io/blog/2025/02/09/3.5.0
[^workers-dev]: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
[^workers-logs]: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
[^assets-routing]: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/
[^d1-batch]: https://developers.cloudflare.com/d1/worker-api/d1-database/ （`batch()` 節。同じ prepared statement を複数回 `bind()` して載せる例と「aborts or rolls back the entire sequence」）
[^d1-limits]: https://developers.cloudflare.com/d1/platform/limits/
[^d1-read-replication]: https://developers.cloudflare.com/d1/best-practices/read-replication/
[^cron]: https://developers.cloudflare.com/workers/configuration/cron-triggers/
[^workers-secrets]: https://developers.cloudflare.com/workers/configuration/secrets/
[^esbuild-target]: https://esbuild.github.io/api/#target
[^esbuild-splitting]: https://esbuild.github.io/api/#code-splitting
[^esbuild-metafile]: https://esbuild.github.io/api/#metafile
[^prefers-color-scheme]: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme
[^prefers-reduced-motion]: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
[^field-sizing]: https://web-platform-dx.github.io/web-features-explorer/features/field-sizing/
[^abortsignal-timeout]: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static （2024-04 から Baseline Newly Available。対象ブラウザの現行版で使える。例外名は `TimeoutError` と `AbortError`）
[^clipboard]: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
[^web-share]: https://web-platform-dx.github.io/web-features-explorer/features/share/
[^aria-live]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
[^label]: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label
[^wcag-contrast]: https://www.w3.org/TR/WCAG22/#contrast-minimum
[^trusted-types]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for
[^vitest-stubglobal]: https://vitest.dev/api/vi.html#vi-stubglobal
[^vitest-mocking]: https://vitest.dev/guide/mocking.html
[^pool-workers-deprecated]: `node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts`（0.22.0）の `env` / `SELF` の `@deprecated` 注記
[^pool-workers-isolation]: https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/
[^pool-workers-test-apis]: https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/ （`reset()`）
[^playwright-clock]: https://playwright.dev/docs/api/class-clock
[^playwright-fixtures]: https://playwright.dev/docs/test-fixtures
[^playwright-best-practices]: https://playwright.dev/docs/best-practices
[^playwright-testconfig]: https://playwright.dev/docs/api/class-testconfig （`failOnFlakyTests`、v1.52 以降）
[^playwright-reporters]: https://playwright.dev/docs/test-reporters
[^node-test]: https://nodejs.org/api/test.html
[^setup-node]: https://github.com/actions/setup-node （`node-version-file`）
[^npx]: https://docs.npmjs.com/cli/v11/commands/npx
[^dependabot-cooldown]: https://github.blog/changelog/2026-07-14-dependabot-version-updates-introduce-default-package-cooldown/
[^cf-gha]: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ （API トークン方式のみ）
[^workers-sdk-oidc]: https://github.com/cloudflare/workers-sdk/discussions/11434 （GitHub OIDC のフェデレーション要望。2025-11 起票、メンテナ回答なし）
[^workerd-temporal]: https://github.com/cloudflare/workerd/discussions/6716 。Node 22.23.2 で `typeof Temporal === 'undefined'`（実機確認）
[^cf-webcrypto]: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ （`timingSafeEqual` は「non-standard extension to the Web Crypto API」）。Node 22.23.2 で `webcrypto.subtle.timingSafeEqual` は未定義（実機確認。`node:crypto` の `timingSafeEqual` は別物）
[^cf-ratelimit]: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
[^ts-imports-issue]: https://github.com/microsoft/TypeScript/issues/60003 （Working as Intended で Closed。拡張子省略は仕様上サポート外）
