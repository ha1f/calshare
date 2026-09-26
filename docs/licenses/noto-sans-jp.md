# ライセンス審査記録: Noto Sans JP（OGP 画像描画用フォント）

- 対象の種類: フォント
- 取得元 URL: https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/16_NotoSansJP.zip（`scripts/fonts/download-noto-sans-jp.mjs` が実際に取得するバイナリ。zip 内の `NotoSansJP-Regular.otf` と `LICENSE` を使う。同じ「Noto Sans JP」でも Google Fonts 配布版とはビルドが異なるため、実際に配置するこのバイナリを審査対象にする）
- バージョン: `notofonts/noto-cjk` の GitHub Release `Sans2.004`（`scripts/fonts/download-noto-sans-jp.mjs` にバージョン固定。更新時はスクリプトのコメントと本記録を両方直す）
- SHA-256: `NotoSansJP-Regular.otf` = `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073`、`LICENSE.txt` = `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`（T10 で `download-noto-sans-jp.mjs --json` を実行して確認）。サブセット後（`test/fixtures/fonts/NotoSansJP-Regular.subset.otf`）= `adeeba99625f4c5a10390a7dcdbc971bf65dbd64709e0d4c18ba56c4283a5662`
- ライセンス種別（SPDX 識別子）: `OFL-1.1`（zip 内 `LICENSE` 冒頭 "SIL OPEN FONT LICENSE Version 1.1" で確認済み）
- 審査日: 2026-09-21（T10 で確認事項を追記: 2026-09-27）
- 審査者: license-review スキル（Claude）

**確認した事実（重要）**:

1. zip 内の `LICENSE` はライセンス本文（PREAMBLE〜DISCLAIMER）のみで、著作権表示や Reserved Font Name（RFN）宣言を含む冒頭のコピーライトヘッダを含まない見込み（`notofonts/noto-cjk` の同種配布物は同じ構成が一般的）。OFL-1.1 条項2は「ライセンス本文」と「著作権表示」の両方を配布物に含めることを求めており、この `LICENSE` ファイル単体を同梱するだけでは著作権表示の義務を満たさない。著作権表示は通常フォントバイナリの `name` テーブル（ID 0: Copyright、ID 13: License Description 等）に埋め込まれているため、**フォント本体を取得した時点でその `name` テーブルから著作権表示を取り出し、同梱する `OFL.txt` に含める**必要がある（下記「判定」の残る条件）。
2. **RFN 宣言なしを確認済み**（T10）: `fonttools` で `NotoSansJP-Regular.otf` の `name` テーブルを読んだ結果、nameID 0（Copyright）は `© 2014-2021 Adobe (http://www.adobe.com/).`、nameID 7（Trademark）は `Noto is a trademark of Google Inc.` で、Reserved Font Name の明示的な宣言（copyright 表示の後に続く RFN 名の列挙）は無い。nameID 7 は商標表示であって OFL の RFN 宣言ではない。よってサブセット後のフォント名を変更する必要はない（「残る条件」3 は不要と判定）。
3. **配布物は確定済み**: 取得元は `scripts/fonts/download-noto-sans-jp.mjs` により `notofonts/noto-cjk` の GitHub Release（`Sans2.004`、`16_NotoSansJP.zip` 内の `NotoSansJP-Regular.otf`）に確定している。design.md §2.5 が言及する Google Fonts 配布版とはビルドが異なるが、実際に配置されるのはこちらのバイナリなので、以後の審査・同梱作業はすべてこの配布物を対象に行う（旧版の本記録にあった「どちらを使うか T10 で確定する」という条件は解消済み）。

## calshare での利用形態

| 観点 | 内容 |
|---|---|
| サーバ側でのみ使うか | 該当する。satori による OGP 画像描画にのみ使用（design.md §2.5「フォント」節）。フォントファイル自体は Cloudflare Workers の isolate 内と R2（`fonts/NotoSansJP-Regular.subset.otf`）にのみ存在する |
| ブラウザに配信するか | 該当しない。ブラウザ・SNS クローラには生成後の PNG（`/:id/ogp.png`）のみを返す。フォントファイル自体をレスポンスボディとして返す経路はない |
| 改変・サブセット化するか | 該当する。`scripts/fonts/subset.sh`（pyftsubset を呼ぶ）で JIS 第 1 水準・かな・英数記号に絞ったサブセットを生成する（design.md §2.5。第 2 水準は含めない、T10 で確定） |
| リポジトリに同梱するか | 該当する。テスト用フィクスチャとして `test/fixtures/fonts/` にサブセット済み OTF と OFL ライセンスファイルを同梱する（design.md §11 T10 相当箇所）。本番配信用の実体は R2 に置き、リポジトリには含めない（スクリプトサイズ上限のため） |
| ソースが private か | 公開・非公開のどちらでも同じ（OFL の同梱義務は配布物に対するもので、リポジトリの公開有無に左右されない） |

## 義務と対応

| 義務 | 該当するか | 対応（ファイル名・同梱先・表示文言） |
|---|---|---|
| 著作権表示 | 該当する（フォント本体の `name` テーブルに含まれる著作権表示をライセンス全文と一緒に保持すれば足りる。OFL は「著作権表示とライセンス本文をセットで同梱」する形式なので、別途表示文言を作文する必要はない） | `OFL.txt`（本記録の取得元 URL から保存したライセンス全文。将来的にフォント本体を取得した際の同梱 `OFL.txt`/`LICENSE` があればそちらを優先して使う）を `test/fixtures/fonts/` と R2 の `fonts/` プレフィックス配下（例: `fonts/OFL.txt`）に同梱する |
| ライセンス同梱 | 該当する（必須） | 上記と同じファイルを同じ場所に置く。サブセット後のフォントも同じ `OFL.txt` と対にして配置する |
| 改変の明示 | 該当する（サブセット化は改変に当たる。ただし「改変した旨を明記する義務」自体は OFL 条文上は明示されていない。改変版も同じ OFL の下でのみ配布する義務が主眼） | `scripts/fonts/subset.sh` のコメントまたは `test/fixtures/fonts/` 配下の README 的な記述で「Noto Sans JP をサブセット化したもの」と明示する（社内向けの説明であり OFL 上の必須義務ではないが、トレーサビリティのため推奨） |
| 名称の制約（Reserved Font Name） | 該当しない。T10 で `name` テーブルを確認し、RFN 宣言が無いことを確定した（上記「確認した事実」2） | 対応不要。"Noto" は Google の商標であるため、社内配布物や表示文言で第三者に「これが公式 Noto Sans JP そのものである」と誤認させない（トレードマークの一般則） |
| 特許条項 | 該当なし（OFL に明示規定なし） | 対応不要 |
| コピーレフトの範囲 | 該当する（フォント自体と改変版=サブセットに限定。OGP として生成した PNG 画像には及ばない） | サブセット後のフォントも OFL の下でのみ扱う。PNG 出力自体への表示義務はない |
| ネットワーク配信での扱い | 該当なし（OFL にネットワーク条項はない。フォントバイナリ自体をブラウザに配信しない構成なので、配布行為に当たるのは R2 への配置とリポジトリ同梱のみ） | 対応不要（上記「著作権表示」「ライセンス同梱」の対応で足りる） |

## 判定

**条件付き可**（T10 で以下を実施。残る条件が 1 つあるためオーナーの再承認が必要）

実施済み（T10）:

1. `node scripts/fonts/download-noto-sans-jp.mjs` でフォント本体を取得し、`fonttools` で `name` テーブルを確認。著作権表示は `© 2014-2021 Adobe (http://www.adobe.com/).`、RFN 宣言は無し（上記「確認した事実」2）
2. 著作権表示とライセンス本文をセットにした `OFL.txt` を作成し、`test/fixtures/fonts/OFL.txt` に同梱した
3. RFN 宣言が無いため、サブセット後のフォント内部名の変更は不要（`scripts/fonts/subset.sh` は `--name-IDs=''` で name テーブル自体を除去しており、変更が必要になる状況が元々ない）
4. フォント単体は販売・再配布しない（変更なし）
5. design.md の §2.5・§11.1・§12 T10 行を「JIS 第 1 水準のみ」（第 2 水準は含めない）に修正した。理由: `scripts/fonts/subset.sh`（provisioning 自動化が既に使っている運用スクリプト）が第 1 水準のみを対象にしており、T10 で新たに第 2 水準の文字表を作ると `docs/runbooks/fonts.md` の運用実績（`generate-jis-level1.mjs`）と二重管理になるため、既存パイプラインへの統合を選んだ。第 2 水準の字（例:「髙」「﨑」）は OGP 画像上で豆腐になる既知の制限として残る（design.md §14.1 と同じ扱い）

**残る条件（T10 の範囲外）**: 条件2は「著作権表示付きの `OFL.txt` を配布物と同じ場所に同梱する」ことを求めており、テスト用フィクスチャ（`test/fixtures/fonts/`）には満たしたが、本番配信の実体である R2 の `fonts/` プレフィックス配下にはまだ置いていない（`.github/workflows/provision.yml` の `font` ジョブが担当領域で、T10 のファイル範囲外）。R2 に `fonts/OFL.txt` を同じ内容で配置してから、この記録を確定として再承認すること。

次のアクション: オーナーが `provision.yml` の `font` ジョブ（または手動）で R2 に `fonts/OFL.txt` を配置したことを確認し、本記録を承認する。第 2 水準を含める設計変更が必要になった場合は、`generate-jis-level1.mjs` と対になる第 2 水準版の生成スクリプトを新設し、本記録と `docs/runbooks/fonts.md` を合わせて更新すること。

**運用基盤 PR での実行記録**: `docs/runbooks/fonts.md` が記録するとおり、provisioning 自動化の検証で `download-noto-sans-jp.mjs` を実行し OTF と `LICENSE.txt` を取得済み（2026-09-21）。T10 でその続き（name テーブル確認・`OFL.txt` 同梱）を完了した。

## 弁護士に相談すべき論点

無し。OFL-1.1 は義務が明確で、コピーレフトの範囲もフォント自体（と改変版）に限定され、フォント生成物である PNG には及ばない。calshare の利用形態（Workers 内部でのみ使用、ブラウザには PNG のみ配信）と矛盾しない。RFN の有無が未確定な点は「フォント本体取得時に確認して追記する」という具体的な作業で解消できる技術的な確認事項であり、法的判断が割れる論点ではないため、弁護士確認は不要と判断する。

## オーナーに残る判断

この記録を承認する。
