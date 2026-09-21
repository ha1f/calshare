# 審査例: Noto Sans JP（OGP 画像描画用フォント）

design.md H8「OGP 用フォント（Noto Sans JP、SIL OFL）のライセンス確認」に対応する審査例。手順(1)〜(6)の型を示すサンプルとして、新しい対象を審査する前に読む。

## (1) 対象とライセンス本文の特定

**実際に配置するバイナリの取得元で審査する。** 同じ「Noto Sans JP」という名前でも、Google Fonts 配布の「Noto Sans JP」と `notofonts/noto-cjk` が配布する「Noto Sans CJK JP」はビルドが異なる。calshare は `scripts/fonts/download-noto-sans-jp.mjs` を持ち、このスクリプトが実際に取得するバイナリが審査対象になる。

- 対象: Noto Sans JP Regular（`scripts/fonts/download-noto-sans-jp.mjs` が取得する `notofonts/noto-cjk` の GitHub Release 版）
- 入手元: `https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/16_NotoSansJP.zip`（zip 内の `NotoSansJP-Regular.otf` と `LICENSE` を取得する。バージョンを固定しているため、更新時はスクリプトのコメントと合わせて審査もやり直す）
- 同梱ライセンス: zip 内の `LICENSE`（SIL Open Font License 1.1 の本文のみ。著作権表示・Reserved Font Name 宣言はこの `LICENSE` には含まれず、フォント本体の `name` テーブルにある）
- バージョン・SHA-256: `node scripts/fonts/download-noto-sans-jp.mjs --json` の実行結果（各ファイルの `sha256`）を判定書に記録する

## (2) SPDX 識別子への対応付け

`OFL-1.1`（`OFL.txt` 冒頭の "SIL OPEN FONT LICENSE Version 1.1" 表記で確認）。

## (3) 義務（references/licenses.md の OFL-1.1 節を参照）

- ライセンス全文（`OFL.txt`）の同梱が必須
- 著作権表示も必須。今回取得する `LICENSE` には含まれないため、フォント本体の `name` テーブル（ID 0/13）から書き写す
- Reserved Font Name（RFN）が宣言されている場合、改変版（サブセット化後のフォント）に同じ名前を名乗れない。Noto 系フォントは由来（Adobe の Source Han Sans 等）によって "Source" が RFN で "Noto" は RFN でない場合がある。要確認
- サブセット化は「改変」に当たり、改変版も OFL の下でのみ再配布できる
- フォント単体の販売は禁止（ソフトウェアの一部としての配布は可）

## (4) calshare での利用形態と義務の適用

| 利用形態                                 | 該当するか                                                                                                     | 義務への影響                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| サーバ側（Cloudflare Workers）でのみ使う | 該当する。satori による OGP 画像描画にのみ使用（design.md §2.5, §11）                                          | フォントバイナリ自体は Workers 内部と R2 にのみ存在し、ブラウザには配信しない                                           |
| ブラウザに配信する                       | **該当しない**。ブラウザには生成後の PNG（OGP 画像）のみを返す（design.md §4.1 `/:id/ogp.png`）                | フォントファイル自体の「配布」に当たる相手はいない。R2 への配置とリポジトリ同梱が実質的な配布行為                       |
| 改変・サブセット化する                   | 該当する。`scripts/fonts/subset.sh`（存在すれば読む。design.md T10）で日本語の使用文字に絞ったサブセットを作る | 改変に当たるため、サブセット後のフォントも OFL の下に置く必要がある。RFN 宣言があれば内部フォント名を変更するか確認する |
| リポジトリに同梱する                     | 該当する想定（サブセット元のフォントまたはビルドスクリプトの入力として）                                       | `OFL.txt` をフォントファイルと同じディレクトリに同梱する                                                                |
| ソースが private か                      | 公開・非公開のどちらでも同じ（OFL の同梱義務は配布物に対するもので、リポジトリの公開有無に左右されない）       | 影響なし。OFL は「配布」に同梱を求めるものであり、リポジトリの公開・非公開自体は義務の有無を左右しない                  |

## (5) 判定

**条件付き可**。事実確認が済んでいない RFN 宣言の有無は条件に混ぜず、`node scripts/fonts/download-noto-sans-jp.mjs` を実際に実行して `name` テーブルを読み、このセッションで確認してから判定する。実行できない環境では判定を「条件付き可」で確定させず、「未確認の事実」に回して保留にする。

残る条件（実装側の作業）:

1. 取得した `LICENSE` と、`name` テーブルから書き写した著作権表示をセットにして、`test/fixtures/fonts/` と R2 の `fonts/` プレフィックス配下の両方に同梱する（OFL 条項2は「各コピー」に著作権表示とライセンス本文を求めるため、配置先ごとに必要）
2. RFN 宣言があった場合、サブセット後のフォント内部名（`name` テーブル）を "Noto Sans JP" のままにしない（例: "Noto Sans JP Subset for calshare" のように変更する）
3. フォント単体を販売・再配布しない（calshare は OGP 画像生成の内部利用のみなので該当しない）
4. `docs/licenses/noto-sans-jp.md` に本審査の記録を残し、H8（design.md §13）でオーナーが承認する

未確認の事実（あれば。誰がどう確認するか）:

- RFN 宣言の有無: `name` テーブル（ID 0/13）を実際に読んで確認していない場合はここに残す。確認方法は `node scripts/fonts/download-noto-sans-jp.mjs` でフォント本体を取得し、`fonttools ttx` 等で `name` テーブルを出力すること。実装担当（T10 実施者）が確認する

次のアクション: T10 でフォント本体を取得し、上記の未確認の事実を確定させたうえで残る条件を満たす。

## (6) 記録

`docs/licenses/noto-sans-jp.md` に assets/record-template.md の形式で記録する。オーナーに残る判断は「この記録を承認する」の1点。弁護士相談は不要（OFL は義務が明確で、コピーレフトの射程も狭く、calshare の利用形態と矛盾しない）。
