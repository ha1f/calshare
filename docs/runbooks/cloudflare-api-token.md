# Cloudflare API トークンの発行

## 目的

provisioning（`.github/workflows/provision.yml` と `scripts/cf/*`）が Cloudflare を操作するための
API トークンを、必要最小限の権限で発行する。

## 自動化されていること

- 発行したトークンが必要な権限を持っているかの確認（`scripts/cf/check-token.mjs`）。
- トークンを GitHub Secrets に登録する操作そのもの（`scripts/cf/set-github-secrets.sh`）。

## オーナーが行う最小の作業

1. Cloudflare ダッシュボード → 右上のプロフィールアイコン → **API トークン** → **トークンを作成する**。
2. **カスタムトークン** を選び、以下の権限テンプレートどおりに設定する。

   | 種別 | リソース | 権限 |
   |---|---|---|
   | Account | Workers Scripts | Edit |
   | Account | D1 | Edit |
   | Account | Workers R2 Storage | Edit |
   | Account | Account Settings | Read |
   | Account | Account Analytics | Read（`scripts/cf/usage-report.mjs` が使う GraphQL Analytics API に必要。H12） |
   | Zone | Zone | Edit（ゾーンの新規作成に必要。Read の上位権限なので閲覧にも使える） |
   | Zone | DNS | Edit |
   | Zone | Zone WAF | Edit |
   | Zone | Workers Routes | Edit |

   Account のリソースは対象アカウントを、Zone のリソースは「すべてのゾーン（今後追加するものを含む）」を選ぶ
   （ドメイン取得前はゾーンがまだ無いため、個別ゾーン指定はできない）。
   **補足（要検証）**: 画面に `Account | Zone | Edit` という項目がある場合、上記に追加しておくと
   より確実かもしれない。無くても上記の `Zone | Zone | Edit` だけでゾーン作成ができるはずだが、
   実アカウントでは未確認。
3. **続行して概要に進む** → 内容を確認して **トークンを作成する**。表示されたトークンをコピーする
   （この画面を閉じると二度と表示されない）。
4. Account ID を控える: Cloudflare ダッシュボードの **Workers & Pages** 概要ページ右サイドバー、
   または `wrangler login` 済みならターミナルで `npx wrangler whoami` でも確認できる
   （リポジトリで `npm ci` 済みで `node_modules` に lockfile の wrangler が入っている前提。
   入っていなければ `npx` がレジストリから最新版を取りに行く）。
5. `scripts/cf/set-github-secrets.sh` を実行し、トークンと Account ID を登録する（後述の
   provisioning.md 参照）。全チェックが OK かどうかは `.github/workflows/provision.yml` の
   `preflight` ジョブが実行のたびに自動確認するので、ローカルで `check-token.mjs` を
   別途実行する必要はない。

## 最小権限にする理由

このトークンは GitHub Secrets に保管され、CI から呼ばれる。漏洩時の被害範囲を「calshare の
Workers / D1 / R2 / DNS / WAF を操作できる」までに限定し、他のアカウント操作（請求情報の変更、
他の Worker やゾーンの削除など）はできないようにする。Global API Key は絶対に使わない
（アカウント全体の全権限を持つため）。

## 失敗したときの見方

- `check-token.mjs` が NG を出したら、出力の「不足している可能性のある権限」列を見て、
  上記テンプレートの対応する行をトークンに追加する。ただし `check-token.mjs` は各エンドポイントへの
  読み取りだけを確認するため、作成・DNS・WAF・Workers Routes の編集権限が実際に足りているかは
  ここでは検出できない（provision workflow の該当ジョブが実際に失敗して初めてわかる）。
- `/user/tokens/verify` 自体が失敗する場合はトークンが無効・失効している。作り直す。
- ゾーン作成（`ensure-zone.mjs`）だけ失敗する場合は、`Zone | Zone | Edit` が設定されているか
  確認する（要検証: `Zone` 側の権限だけで新規ゾーンを作れるかは実アカウントで未確認。
  作れない場合は上記の「補足」の `Account | Zone | Edit` を追加して試す）。それでも作成できない
  場合は Cloudflare ダッシュボードで手動でドメインをゾーンとして追加してから、
  `docs/runbooks/custom-domain.md` の手順で provision を再実行する（ゾーンが既に存在すれば
  `ensure-zone.mjs` は作成せず流用する）。
- `usage-report`（H12）が認可エラーで失敗する場合は `Account Analytics:Read` を確認する。

## 要検証

- Free プランの WAF レート制限ルール（`scripts/cf/ensure-waf-rate-limit.mjs`）に必要な
  パラメータの下限・上限は実アカウントで未確認。詳細は同スクリプトのコメントと
  `docs/runbooks/provisioning.md` を参照。
