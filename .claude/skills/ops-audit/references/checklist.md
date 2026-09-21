# ops-audit チェックリスト

`.github/workflows/*.yml`・`scripts/**`・`docs/runbooks/**` を対象に、観点ごとに「何を見るか / どう確認するか」を並べる。SKILL.md の手順から、該当する観点に来たらここを開く。

## 1. YAML の構文確認

Node 標準ライブラリに YAML パーサが無いので、構文チェックだけは Ruby（macOS 標準搭載）の `psych` に任せる。

```sh
ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/ci.yml
```

エラーが出なければ構文は妥当。`--- `区切りで複数ドキュメントを持つファイルは無い前提（本リポジトリのワークフローは1ファイル1ドキュメント）。全ワークフローに対してループで回す:

```sh
for f in .github/workflows/*.yml; do echo "== $f =="; ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$f" || echo "NG: $f"; done
```

## 2. permissions の最小化

- `scripts/audit-workflows.mjs` は「ファイル中に `permissions:` が一度も無い」ことしか機械検出しない（既定＝広い書き込み権限のままの可能性、という粗い警告）。
- **意味的な最小化はここから先は人間 + Claude の判読**: 各 job の `permissions:` を読み、そのジョブが実際に必要とする権限（例: PR コメントだけなら `pull-requests: write` と `contents: read`、デプロイなら `contents: read` 程度で足り `id-token: write` は OIDC を使う場合のみ）と一致しているか確認する。
- トップレベルに `permissions: {}` や `contents: read` を置いた上で、書き込みが要る job だけに追加の `permissions:` を書く構成が理想。全 job が同じ広い権限を継承していないか確認する。
- `GITHUB_TOKEN` を明示的に別のパーソナルトークンに差し替えていないか（差し替えていれば、そのトークンのスコープも見る）。

## 3. inputs・イベント本文のシェル展開（injection）

- `scripts/audit-workflows.mjs` は `run:` ブロック内の `${{ github.event.* }}` `${{ inputs.* }}` `${{ github.head_ref }}` の直接展開を検出する。検出されたら「`env:` に一度渡してから `"$VAR"` で参照する」形に直せるか確認する。
- ブランチ名（`github.head_ref` や `github.ref_name`）も任意の文字列なので、`git checkout` や `case` 文の比較以外でシェルに展開しない。
- issue/PR の title・body・ラベル名もユーザー入力である点は同じ。`github-script` action で JS 側から扱う場合は injection の経路にならないので対象外（`actions/github-script` の `script:` 内で `context.payload.issue.title` を読むのは安全）。

## 4. secrets のログ出力

- `scripts/audit-workflows.mjs` は `set -x` / `set -o xtrace` と `echo` + `secrets.*` の組み合わせを検出する。
- 見つからなくても、`secrets.*` を渡した環境変数を後続のステップで `env | sort` のように一括出力していないか、デバッグ用の `cat` やエラーメッセージへの埋め込みが無いかは目視で追う。
- `::add-mask::` を自前で付けていない限り、`secrets.*` から作った派生文字列（base64 化・結合）はマスクされない点に注意する。

## 5. サードパーティ action

- `scripts/audit-workflows.mjs` は `uses:` の参照が 40 桁の SHA でなければ指摘する（`actions/*` `github/*` `cloudflare/*` は medium、それ以外は high）。
- SHA 固定でない場合、少なくとも `dependabot.yml` でそのアクションの更新を追跡しているか（`docs/runbooks/` か `.github/dependabot.yml` の有無）を確認する。
- 初めて使う action は、リポジトリの star 数・最終更新・issue の状態など素性を一言添えて報告する（判断はオーナーに委ねる）。

## 6. 冪等性

- 同じワークフローを 2 回連続で走らせても壊れないか。典型的に壊れるパターン: `git tag` の再作成でエラーになる、同名ブランチの `push` で conflict する、`gh pr create` を条件なしに毎回呼んで重複 PR を作る。
- `if: ` 条件で「既に存在するなら skip」のガードがあるか確認する。

## 7. 失敗時の挙動（中途半端な状態にならないか）

- 複数の外部変更（D1 マイグレーション適用 → デプロイ、のような順序）を持つワークフローは、途中の step が失敗したときに手前の変更がロールバックされない前提を確認する。少なくとも「失敗したら次に何をすべきか」が runbook に書かれているか。
- `continue-on-error: true` が付いている step は、その後続処理が「失敗しても問題ない」ことを保証できているか確認する（安易な握りつぶしでないか）。

## 8. schedule の時刻とタイムゾーン

- `on.schedule.cron` は UTC。日本時間の意図と何時間ずれるかをコメントで明示しているか（例: JST 4:00 に GC を走らせたいなら `0 19 * * *`、コメントに `# JST 04:00`）。
- 実行間隔が短すぎて GitHub Actions の scheduled workflow の遅延（最大 15 分程度、混雑時はさらに）で意図がずれないか。

## 9. runbook とスクリプト・ワークフローの乖離

- `docs/runbooks/*.md` が存在すれば、そこに書かれたコマンド例・引数・ワークフロー名を、実際の `scripts/**` や `.github/workflows/*.yml` と突き合わせる（`grep` で名前を探すだけでよい）。
- ズレの例: runbook が `node scripts/foo.mjs --dry-run` と書いているのに、実装は `--dryRun`（キャメルケース）しか受け付けない。ワークフロー名が runbook と実物で違う。
- `docs/runbooks/` が無ければ「未着手（別 PR）」として扱う。

## 10. スクリプトの `--dry-run` と `--help`

- **書き込みを伴うスクリプト**（外部 API を呼ぶ・ファイルを生成する・`gh` で PR や workflow を起動する等）には `--dry-run` と `--help` の両方があるか確認する。読み取り専用のスクリプト（このスキルの `audit-workflows.mjs` を含む）に `--dry-run` は不要。
- `--help` は「使い方 / 引数 / 例」の3点が出れば十分（`scripts/check-domain.mjs` の `usage()` が参考実装）。

## 11. テストの有無

- `scripts/*.mjs` に対応する `scripts/*.test.mjs`（または同名ディレクトリ内）があるか。無ければ「テスト未整備」として指摘する（重大度は low、動いている実装を壊す指摘ではないため）。
