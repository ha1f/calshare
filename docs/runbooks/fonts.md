# OGP 用フォントの取得・サブセット化・配置（H8）

## 目的

OGP 画像生成（design.md §2.5）で使う Noto Sans JP のサブセットフォントを、
取得 → サブセット化 → R2 配置まで自動化し、オーナーに残る作業をライセンス確認だけにする。

## SIL OFL 1.1 の要点（オーナーが確認する範囲）

Noto Sans JP は SIL Open Font License 1.1（`.claude/tmp/fonts/LICENSE.txt` に実物がある）。
このプロジェクトでの使い方に関係する要点は次の 4 点。

1. **フォント単体を販売してはいけない**。ソフトウェアに同梱・組み込んで配布・販売するのは可。
   このプロジェクトはフォントをアプリ内部の OGP 画像生成にのみ使い、フォント自体を配布・
   販売しないので抵触しない。
2. **Reserved Font Name（RFN）が指定されている場合、改変版にその名前を使えない**。
   RFN は著作権表示の後に明記される（OFL 本文の定義）。取得した
   `.claude/tmp/fonts/LICENSE.txt` の著作権表示にはこのプロジェクトの確認時点で明示的な
   RFN の指定が見当たらなかったが、サブセット化はフォントの改変にあたるため、
   フォント取得のたびに著作権表示を再確認すること。
3. **ライセンスファイルの同梱が必須**。フォント（オリジナル・改変版のどちらでも）を配布する
   ときは OFL のライセンス全文を一緒に配布する。
4. **改変版（サブセットも含む）も OFL のままでなければならない**。別のライセンスに変更しては
   いけない。

サブセット化（文字を間引く）は OFL の定義上「改変」にあたるため、上記 3・4 が直接関係する。
ライセンス遵守の最終的な責任はオーナーが持つ（design.md H8）。**このライセンス審査そのものは
`.claude/skills/license-review` があればそれを使うこと**。オーナーが確認するのは
「ライセンスファイルが同梱されているか」の 1 点で足りる（下記の流れが確認しているため）。

## 自動化されていること

1. `node scripts/fonts/download-noto-sans-jp.mjs` — Noto Sans JP Regular（SIL OFL 1.1）を
   公式リリース（notofonts/noto-cjk）から取得し、`.claude/tmp/fonts/NotoSansJP-Regular.otf`
   と `.claude/tmp/fonts/LICENSE.txt` を保存する。
2. `bash scripts/fonts/subset.sh` — 上記フォントを「JIS 第 1 水準漢字（2965 文字。
   `scripts/fonts/generate-jis-level1.mjs` で生成）+ ひらがな + カタカナ + 半角英数記号 +
   一般的な約物」にサブセット化し、`dist/fonts/NotoSansJP-Regular.subset.otf` に出力する
   （fonttools の `pyftsubset` を使う）。
3. `.github/workflows/provision.yml` の `font` ジョブが、venv に `fonttools` を入れて
   `pyftsubset` を PATH に通したうえで上記 2 スクリプトを引数なしで順に呼び、生成した OTF を
   `wrangler r2 object put calshare/fonts/NotoSansJP-Regular.subset.otf` で本番 R2 に配置する
   （`with_font` 入力が既定 true。`scripts/fonts/` 一式が無い間は自動でスキップ）。

**第 1 水準漢字の一覧をファイルにコミットしない理由**: `generate-jis-level1.mjs` は区点から
EUC-JP 変換で一覧を導出する純粋関数で、ネットワークも乱数も使わないため実行するたびに
同じ 2965 文字が出る。`scripts/fonts/jis-level1.txt` のような生成物をコミットすると、
生成ロジックを直しても実際のファイルを更新し忘れる形で古くなりうる（DRY 原則にも反する）。
再現性は関数自体の決定性で担保されており、差分の読みやすさより「生成物と生成ロジックが
ずれない」ことを優先し、実行時生成のみにした。

## オーナーが行う最小の作業

1. GitHub Actions で `Provision Cloudflare resources` を実行する（`with_font` は既定 true の
   ままでよい）。手順は `docs/runbooks/provisioning.md` を参照。
2. `font` ジョブの Step Summary で配置が完了したことを確認する。
3. **ライセンス同梱の確認**: `docs/licenses/noto-sans-jp.md`（T10 のライセンス審査記録）の
   「残る条件」に従い、著作権表示付きの `OFL.txt`（`test/fixtures/fonts/OFL.txt` と同じ内容）を
   本番 R2 の `fonts/OFL.txt` にも配置する。配置後、同記録を確定として再承認する。

## ローカルでの実行方法（動作確認済み）

依存を用意する（プロジェクトの npm 依存には含めない。fonttools は Python パッケージ）。

```sh
python3 -m venv .venv
.venv/bin/pip install fonttools
```

実行:

```sh
node scripts/fonts/download-noto-sans-jp.mjs
PATH=".venv/bin:$PATH" bash scripts/fonts/subset.sh
```

`pyftsubset` が見つからない場合、`subset.sh` は上記のインストール方法を表示して終了コード 1 で
終わる。

**実測記録（2026-09-21、`.claude/tmp/venv-fonttools` で実行）**:

- 対象文字数: 3,248（第 1 水準漢字 2,965 + ひらがな・カタカナ・半角英数記号・約物 283）
- 元フォント: 4,533,028 bytes
- サブセット後: 783,296 bytes（約 765 KiB）

## 設計との差分（T10 で解消済み）

design.md §2.5 は当初 OGP 用フォントの対象文字を「JIS 第 1 水準 + 第 2 水準 + かな + 英数記号」
としていたが、本ランブックのパイプライン（`generate-jis-level1.mjs` と `subset.sh`）は
**第 1 水準のみ**を対象にしていた。T10（OGP 画像生成の実装）でこの差分を解消し、
design.md 側を「第 1 水準のみ」に修正した（`docs/licenses/noto-sans-jp.md` の判定に理由を記録）。
第 2 水準の字（「髙」「﨑」など）は OGP 画像上で豆腐になる既知の制限として残る
（詳細ページ自体の表示には影響しない。design.md §14.1 の「OGP のフォント未収録文字」と同じ扱い）。

サブセット生成は本ランブックの `scripts/fonts/subset.sh` に一本化した。T10 は
`scripts/subset-font.mjs` を新設せず、OGP 画像生成のテスト用フィクスチャ
（`test/fixtures/fonts/`）もこのスクリプトの出力をそのまま使う。

**オーナー判断が必要な事項（未解消）**: 第 2 水準まで含めるかどうかは T10 でも判断していない
（第 1 水準のみに統一したのは既存パイプラインとの二重管理を避けるための実装判断で、
「第 2 水準の字が人名・地名で豆腐になる」という UX 上のトレードオフ自体は残っている）。
含める場合は `generate-jis-level1.mjs` に相当する第 2 水準の生成関数を追加し、`subset.sh` の
対象に加える（出力サイズは design.md の目安で 3〜4MB 程度に増える見込み）。

一般記号・全角英数字（例: ○ 〇 ★ ※ ～(U+FF5E) －(U+FF0D)）も `subset.sh` の固定リストに無く、
豆腐になる既知の制限として残る（例: Windows IME の「～」を含むタイトル）。第 2 水準と合わせて
対象範囲をオーナー判断待ちとする。

## 失敗したときの見方

- `pyftsubset（fonttools）が見つかりません` → 上記「ローカルでの実行方法」のとおり
  インストールする。CI（`provision.yml`）の `font` ジョブは venv に `fonttools` を入れて
  `pyftsubset` を `GITHUB_PATH` に通すステップを持つので、通常はここで発生しない
  （ubuntu-latest の system Python に直接 `pip install` しないのは PEP 668 の
  externally-managed-environment 制限を避けるため）。発生した場合は
  `python3 -m venv .venv-fonttools && .venv-fonttools/bin/pip install fonttools` が
  ジョブの中で成功しているかをログで確認する。
- `入力フォントが見つかりません` → 先に `download-noto-sans-jp.mjs` を実行する。
- R2 への配置（`wrangler r2 object put ... --remote`）が失敗する場合は
  `docs/runbooks/cloudflare-api-token.md` の権限（R2 の編集権限）を確認する。
