---
name: dependency-audit
description: npm 依存の脆弱性・更新・ライセンスをまとめて監査し、npm audit（脆弱性）・npm outdated（更新）・直接依存のライセンス（license-review スキルの scripts/npm-licenses.mjs を利用）を調べる。脆弱性は重大度と修正バージョン、更新はsemverの種別と破壊的変更の要点、ライセンスは許容リスト外のものを報告する。安全な更新（patchと、テストが通るminor）はブランチを切ってPRまで進め、majorはオーナー判断に回す。「依存関係の監査して」「npm audit の結果まとめて」「パッケージ更新できる？」「ライセンス的に問題ないか確認して」「依存を棚卸しして」のような依頼、および定期的な依存関係の健全性チェックに使う。package.json がまだ無い時点でこのスキルを呼ばれたら、T1（足場PR）マージ後に実行する旨を報告して終了する。
---

Cloudflare Workers + Hono + D1 + R2 という技術スタック上で、依存関係の脆弱性・陳腐化・ライセンス逸脱を洗い出し、機械的に安全と判断できる範囲は実際にPRまで進める。「Issueを起票して終わり」にしない。

## 前提: package.json の有無を最初に確認する

```sh
test -f package.json && echo exists || echo missing
```

無ければ次のように報告して終了する（T1 = 足場PRのブランチ名 `feat/scaffold`、docs/design.md §12）。

> package.json が存在しません（T1 未マージ）。T1 マージ後に本スキルを再実行してください。

## 手順

1. **脆弱性**: `npm audit --json` を実行する。各脆弱性について `severity`（critical/high/moderate/low）・影響パッケージ・`fixAvailable`（修正後バージョン）を抽出する。`fixAvailable` が無いもの（上流未対応）は「修正版なし」として明記する。
2. **更新**: `npm outdated --json` を実行する。各パッケージの `current` → `wanted`/`latest` から semver 差分（patch/minor/major）を判定する。**minor 以上**は、パッケージ名で変更履歴を検索し（`WebFetch` で GitHub の CHANGELOG や Releases ページを確認）、破壊的変更の要点を1〜2行で添える。major は必ず確認する。patch は変更点の要約のみで詳細検索は省いてよい。
3. **ライセンス**: `.claude/skills/license-review/scripts/npm-licenses.mjs` を呼ぶ。

   ```sh
   node .claude/skills/license-review/scripts/npm-licenses.mjs
   ```

   このスクリプトが存在しない場合（license-review スキルが未整備、または移動中）は、`npm ls --all --json` の `license` フィールドを自前で集計するか、その旨を報告に明記して手動確認を促す。
   `license-review/references/licenses.md` 末尾の「npm 依存の許容リスト」と照合する。リスト外・不明（`license` フィールドが無く LICENSE ファイルも無い）のものは license-review の手順（同ファイルの各ライセンス節）で個別に審査する。

4. **安全な更新を実際に進める**: 次の条件をすべて満たすものだけ、ブランチを切って進める。
   - `npm outdated` で **patch**、または **minor かつ CHANGELOG に破壊的変更の記載が無い**もの。
   - 進め方: `main` から `chore/deps-update-YYYYMMDD` のようなブランチを切る → 対象パッケージだけ `npm update <pkg>`（一括の `npm update` はしない。差分を追いやすくするため）→ `npm run lint && npm run typecheck && npm run test:unit`（統合・e2eはCIに任せてよい）が通ることを確認 → 通れば `gh pr create --draft` でPRを作成しリンクを開く（ユーザーの GitHub CLI 認証を使う。実際に PR を作る操作なので、実行前に一度「この更新をPRにします」と一言添えて進める）。
   - **major はここに含めない**。理由（破壊的変更の影響範囲の判断はオーナーが行う）を添えて未決事項として報告する。
5. **package-lock.json の変更**: 上記の更新で生成される diff に `package-lock.json` 以外のロックファイル痕跡（`yarn.lock` 等）が混ざらないことを確認する（本リポジトリは npm 前提、docs/design.md §12 T1）。

## 出力テンプレート

```
## dependency-audit: <実行日>

### 脆弱性（npm audit）
| 重大度 | パッケージ | 現在 | 修正版 | 備考 |
|---|---|---|---|---|
| high | foo | 1.2.0 | 1.2.3 | 修正版あり。手順4の対象 |
| critical | bar | 2.0.0 | - | 上流未対応。代替パッケージの検討が必要（オーナー判断） |

### 更新（npm outdated）
| パッケージ | 現在 → 最新 | 種別 | 破壊的変更の要点 |
|---|---|---|---|
| hono | 4.1.0 → 4.2.0 | minor | ルーティングAPIに変更なし（CHANGELOG確認済み） |
| wrangler | 3.x → 4.x | major | v4でNode 18サポート終了 → オーナー判断へ |

### ライセンス
許容リスト外: なし / または一覧
LICENSEファイル欠落: なし / または一覧

### 実行したPR
- chore/deps-update-20260917 → PR #123（draft）: hono, wrangler(minor分のみ) を更新。lint/typecheck/unit green

### オーナー判断が必要な項目
- wrangler の major 更新（Node 18 サポート終了の影響範囲）
- bar の脆弱性（修正版なし。代替パッケージ候補: ...）

### 次のアクション
- PR #123（draft）をレビューしてマージするかを判断する
- wrangler の major 更新は影響範囲を読んでから判断する（今回のPRには含めない）
```

## 参照ファイル

- `.claude/skills/license-review/scripts/npm-licenses.mjs` — 直接依存のライセンス種別とLICENSE同梱有無を一覧化する（license-review スキルが所有。dependency-audit はパスで呼ぶだけで、コピーしない）。手順3で実行する。存在しない場合のフォールバックは手順3に記載。
