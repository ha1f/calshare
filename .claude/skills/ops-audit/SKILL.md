---
name: ops-audit
description: calshare リポジトリの .github/workflows/*.yml、scripts/**、docs/runbooks/** を横断監査し、権限・シークレット・注入・冪等性・runbook との乖離を「対象一覧 / 指摘 / runbook との乖離 / 合格観点」の形式で報告する。「ワークフローを確認して」「CI の権限は絞れてる？」「新しいワークフローをレビューして」「runbook と実装がずれてないか見て」「デプロイの自動化、壊れても大丈夫か確認して」「scripts に dry-run ある？」のような依頼、および新しい .github/workflows/*.yml や scripts/ 配下のスクリプトを追加・変更した後のセルフレビューに使う。
---

このスキルは Cloudflare Workers 上で動く calshare の CI/CD・運用スクリプトを、オーナーが承認できる粒度まで機械的に洗い出すためのもの。「Issue を起票して終わり」にせず、指摘には具体的な修正案を添える。

## 対象の確定

次の3系統を対象とする。存在しないディレクトリ・ファイルは「未着手（該当なし）」として一覧に載せる（他 PR が並行で作業中の可能性があるため、無いこと自体を指摘にしない）。

- `.github/workflows/*.yml`
- `scripts/**`（`scripts/cf/`・`scripts/legal/` などサブディレクトリを含む。テストファイル `*.test.mjs` 自体は対象外だが「対応するテストがあるか」の確認には使う）
- `docs/runbooks/**`

## 手順

1. **対象一覧を作る**: 上記3系統を `find`/`ls` で列挙する。0件のディレクトリはその旨を記録するだけで次に進む。
2. **YAML構文を確認する**: 各ワークフローに `references/checklist.md` §1 の `ruby -ryaml` コマンドを回す。構文エラーがあれば最優先の指摘にする。
3. **機械チェックを走らせる**: `node .claude/skills/ops-audit/scripts/audit-workflows.mjs --json` で `.github/workflows/` 配下を一括スキャンする。出力される `permissions` 欠落・`injection` 疑い・`secret-logging` 疑い・`unpinned-action` を指摘の下書きにする。**このスクリプトはテキストベースの簡易走査であり、YAML の意味解析はしない**（複数ドキュメントの YAML、非標準インデントは誤検出しうる）。出た指摘は元ファイルを実際に開いて確認してから報告する。
4. **人間の目でしか出せない観点を見る**: `references/checklist.md` の §2（permissions の意味的な最小化）・§6（冪等性）・§7（失敗時の挙動）・§8（schedule の時刻とタイムゾーン）は、機械チェックが拾わないのでファイルを読んで判断する。
5. **runbook との突き合わせ**: `docs/runbooks/*.md` があれば、そこに書かれたコマンド・引数・ワークフロー名を `scripts/**` と `.github/workflows/*.yml` の実物と `grep` で突き合わせる（§9）。無ければ「runbook 未整備」と記録するだけで指摘にはしない。
6. **スクリプトの `--dry-run`/`--help`/テストを確認する**: 各スクリプトを実際に `--help` 付きで実行してみる。書き込み系のスクリプトに `--dry-run` が無ければ指摘する（読み取り専用スクリプトには不要、§10）。対応する `*.test.mjs` の有無を確認し、あれば `node --test <そのファイル>` で通ることを確認する。
7. **出力テンプレートで報告する**（下記）。重大度は `high`（権限昇格・シークレット漏洩・injection に直結）/ `medium`（対策はあるが強化余地）/ `low`（テスト・runbook整備などの負債）の3段階。

## 出力テンプレート

```
## ops-audit: <対象範囲、例: .github/workflows/ 全体>

### 総合判定
マージ可 / 修正後に可 / 不可

### 対象一覧
- .github/workflows/ci.yml
- .github/workflows/deploy.yml
- scripts/cf/lib/cfApi.mjs ...
- docs/runbooks/ ... （無ければ「未整備」）

### 指摘
| 重大度 | ファイル:行 | 観点 | 内容 | 修正案 |
|---|---|---|---|---|
| high | .github/workflows/deploy.yml:12 | injection | run: 内で ${{ github.event.head_commit.message }} を直接展開 | env: COMMIT_MSG: ${{ ... }} に渡し run: では "$COMMIT_MSG" を使う |

### runbook との乖離
- docs/runbooks/deploy.md はコマンドを `node scripts/deploy-check.mjs` と書いているが実物は `scripts/cf/deploy-check.mjs`（パス不一致）

### 合格した観点
- 全ワークフローに permissions が明示されている
- scripts/cf/lib/cfApi.mjs は dryRun オプションを持ち、対応するテストがある

### オーナーの判断事項
無し

### 次のアクション
- 誰が: 実装担当。何を: high 指摘の injection を修正してから再度このスキルで確認する
```

指摘が0件の観点も「合格した観点」に列挙する。ここが薄いとオーナーは「見ていないのか、問題が無いのか」を判断できない。

## 参照ファイル

- `references/checklist.md` — 観点ごとの確認方法（YAML構文・permissions・injection・secrets・action pinning・冪等性・失敗時挙動・schedule・runbook突合・dry-run/help・テスト）。手順2〜6で開く。
- `scripts/audit-workflows.mjs` — `.github/workflows/*.yml` のテキストベース簡易監査。`--json` でファイル・行番号付きの指摘を出す、`--help` で使い方を出す。手順3で実行する。対応するテストは `scripts/audit-workflows.test.mjs`。
