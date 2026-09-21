# ライセンス審査記録: Noto Sans JP（OGP 画像描画用フォント）

- 対象の種類: フォント
- 取得元 URL: https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/16_NotoSansJP.zip（`scripts/fonts/download-noto-sans-jp.mjs` が実際に取得するバイナリ。zip 内の `NotoSansJP-Regular.otf` と `LICENSE` を使う。同じ「Noto Sans JP」でも Google Fonts 配布版とはビルドが異なるため、実際に配置するこのバイナリを審査対象にする）
- バージョン: `notofonts/noto-cjk` の GitHub Release `Sans2.004`（`scripts/fonts/download-noto-sans-jp.mjs` にバージョン固定。更新時はスクリプトのコメントと本記録を両方直す）
- SHA-256（分かる範囲で）: `node scripts/fonts/download-noto-sans-jp.mjs --json` の実行結果に含まれる `NotoSansJP-Regular.otf` と `LICENSE.txt` それぞれの `sha256` を、実際に取得した時点で本記録に追記すること（本記録作成時点では未実行）
- ライセンス種別（SPDX 識別子）: `OFL-1.1`（zip 内 `LICENSE` 冒頭 "SIL OPEN FONT LICENSE Version 1.1" で確認予定）
- 審査日: 2026-09-21
- 審査者: license-review スキル（Claude）

**確認した事実（重要）**:

1. zip 内の `LICENSE` はライセンス本文（PREAMBLE〜DISCLAIMER）のみで、著作権表示や Reserved Font Name（RFN）宣言を含む冒頭のコピーライトヘッダを含まない見込み（`notofonts/noto-cjk` の同種配布物は同じ構成が一般的）。OFL-1.1 条項2は「ライセンス本文」と「著作権表示」の両方を配布物に含めることを求めており、この `LICENSE` ファイル単体を同梱するだけでは著作権表示の義務を満たさない。著作権表示は通常フォントバイナリの `name` テーブル（ID 0: Copyright、ID 13: License Description 等）に埋め込まれているため、**フォント本体を取得した時点でその `name` テーブルから著作権表示を取り出し、同梱する `OFL.txt` に含める**必要がある（下記「判定」の残る条件）。
2. RFN 宣言についても同じ理由で `LICENSE` からは判定できない。Noto Sans CJK（`notofonts/noto-cjk` が配布する版）は Adobe の Source Han Sans を由来としており、Source Han Sans は "Source" を Reserved Font Name として公開された経緯がある一方、"Noto" 自体は RFN でない可能性が高い。ただしこれは推定であり、**未確認の事実**として下記に残す。
3. **配布物は確定済み**: 取得元は `scripts/fonts/download-noto-sans-jp.mjs` により `notofonts/noto-cjk` の GitHub Release（`Sans2.004`、`16_NotoSansJP.zip` 内の `NotoSansJP-Regular.otf`）に確定している。design.md §2.5 が言及する Google Fonts 配布版とはビルドが異なるが、実際に配置されるのはこちらのバイナリなので、以後の審査・同梱作業はすべてこの配布物を対象に行う（旧版の本記録にあった「どちらを使うか T10 で確定する」という条件は解消済み）。

## calshare での利用形態

| 観点 | 内容 |
|---|---|
| サーバ側でのみ使うか | 該当する。satori による OGP 画像描画にのみ使用（design.md §2.5「フォント」節）。フォントファイル自体は Cloudflare Workers の isolate 内と R2（`fonts/NotoSansJP-Regular.subset.otf`）にのみ存在する |
| ブラウザに配信するか | 該当しない。ブラウザ・SNS クローラには生成後の PNG（`/:id/ogp.png`）のみを返す。フォントファイル自体をレスポンスボディとして返す経路はない |
| 改変・サブセット化するか | 該当する。`scripts/fonts/subset.sh`（存在すれば読む。pyftsubset を呼ぶ想定）で JIS 第1水準・第2水準・かな・英数記号に絞ったサブセットを生成する（design.md §2.5） |
| リポジトリに同梱するか | 該当する。テスト用フィクスチャとして `test/fixtures/fonts/` にサブセット済み OTF と OFL ライセンスファイルを同梱する（design.md §11 T10 相当箇所）。本番配信用の実体は R2 に置き、リポジトリには含めない（スクリプトサイズ上限のため） |
| ソースが private か | 公開・非公開のどちらでも同じ（OFL の同梱義務は配布物に対するもので、リポジトリの公開有無に左右されない） |

## 義務と対応

| 義務 | 該当するか | 対応（ファイル名・同梱先・表示文言） |
|---|---|---|
| 著作権表示 | 該当する（フォント本体の `name` テーブルに含まれる著作権表示をライセンス全文と一緒に保持すれば足りる。OFL は「著作権表示とライセンス本文をセットで同梱」する形式なので、別途表示文言を作文する必要はない） | `OFL.txt`（本記録の取得元 URL から保存したライセンス全文。将来的にフォント本体を取得した際の同梱 `OFL.txt`/`LICENSE` があればそちらを優先して使う）を `test/fixtures/fonts/` と R2 の `fonts/` プレフィックス配下（例: `fonts/OFL.txt`）に同梱する |
| ライセンス同梱 | 該当する（必須） | 上記と同じファイルを同じ場所に置く。サブセット後のフォントも同じ `OFL.txt` と対にして配置する |
| 改変の明示 | 該当する（サブセット化は改変に当たる。ただし「改変した旨を明記する義務」自体は OFL 条文上は明示されていない。改変版も同じ OFL の下でのみ配布する義務が主眼） | `scripts/fonts/subset.sh` のコメントまたは `test/fixtures/fonts/` 配下の README 的な記述で「Noto Sans JP をサブセット化したもの」と明示する（社内向けの説明であり OFL 上の必須義務ではないが、トレーサビリティのため推奨） |
| 名称の制約（Reserved Font Name） | 未確定だが「無い見込み」と推定（上記「確認した事実」2）。T10 でフォント本体の `name` テーブルを確認して確定する | RFN が宣言されていた場合、サブセット後のフォント内部名（`name` テーブル）を "Noto Sans JP" のままにせず変更する（例: "Noto Sans JP Subset for calshare"）。加えて "Noto" は Google の商標であるため、RFN の有無によらず、社内配布物や表示文言で第三者に「これが公式 Noto Sans JP そのものである」と誤認させない（トレードマークの一般則） |
| 特許条項 | 該当なし（OFL に明示規定なし） | 対応不要 |
| コピーレフトの範囲 | 該当する（フォント自体と改変版=サブセットに限定。OGP として生成した PNG 画像には及ばない） | サブセット後のフォントも OFL の下でのみ扱う。PNG 出力自体への表示義務はない |
| ネットワーク配信での扱い | 該当なし（OFL にネットワーク条項はない。フォントバイナリ自体をブラウザに配信しない構成なので、配布行為に当たるのは R2 への配置とリポジトリ同梱のみ） | 対応不要（上記「著作権表示」「ライセンス同梱」の対応で足りる） |

## 判定

**条件付き可**

残る条件（実装側の作業）:

1. `node scripts/fonts/download-noto-sans-jp.mjs` でフォント本体を取得し、`fonttools ttx` 等で `name` テーブルを確認して、(a) 著作権表示の文言、(b) Reserved Font Name 宣言の有無、を本記録に追記する
2. (a) の著作権表示を、zip 内の `LICENSE`（無ければ本記録の取得元 URL から保存したライセンス本文に著作権表示を追記したもの）とセットにして `test/fixtures/fonts/` と R2 の `fonts/` プレフィックス配下の両方に同梱する。ライセンス本文だけの同梱は OFL-1.1 条項2を満たさないため不可
3. RFN 宣言があった場合、`scripts/fonts/subset.sh`（存在すれば読む）でサブセットを生成する際にフォント内部名（`name` テーブルの Family Name 等）を元の名称のままにせず変更する（例: "Noto Sans JP Subset for calshare"）
4. フォント単体を販売・再配布しない（calshare は OGP 画像生成の内部利用のみであり、現行の設計上該当しない。今後フォント配布物自体を第三者に渡す用途が増えないことを設計変更時に確認する）
5. design.md T10 の完了条件に、上記 1〜3 を含める

未確認の事実（あれば。誰がどう確認するか）:

- Reserved Font Name 宣言の有無: "Noto" が RFN でない可能性が高いという本記録の推定は未確認。`name` テーブル（ID 0/7/13）を実際に読んで確定する必要がある。確認方法・担当は上記「残る条件」1 と同じ（T10 の実装担当が実行時に確認する）

次のアクション: T10 の実装担当が `download-noto-sans-jp.mjs` を実行し、上記の未確認の事実を確定させたうえで残る条件を満たす。完了したら本記録を更新し、あらためて承認を求める。

**運用基盤 PR での実行記録（本記録は未更新のまま残す。上記の判定・残る条件は取り消していない）**: `docs/runbooks/fonts.md` が記録するとおり、provisioning 自動化の検証で実際に `download-noto-sans-jp.mjs` を実行し OTF と `LICENSE.txt` を取得済み（2026-09-21）。ただし `name` テーブルの著作権表示・RFN 宣言の確認や `OFL.txt` の同梱までは行っておらず、上記「残る条件」1〜3 は未解消のまま。また実際に生成しているサブセットは JIS **第 1 水準のみ**（`scripts/fonts/subset.sh`）で、本記録の「改変・サブセット化するか」欄が挙げる第 2 水準は含まない。この記録の更新・再承認は `.claude/skills/license-review` の担当範囲として残す。

## 弁護士に相談すべき論点

無し。OFL-1.1 は義務が明確で、コピーレフトの範囲もフォント自体（と改変版）に限定され、フォント生成物である PNG には及ばない。calshare の利用形態（Workers 内部でのみ使用、ブラウザには PNG のみ配信）と矛盾しない。RFN の有無が未確定な点は「フォント本体取得時に確認して追記する」という具体的な作業で解消できる技術的な確認事項であり、法的判断が割れる論点ではないため、弁護士確認は不要と判断する。

## オーナーに残る判断

この記録を承認する。
