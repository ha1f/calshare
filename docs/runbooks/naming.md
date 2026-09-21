# サービス名とドメインの決定（H1）

## 目的

concept.md §10「サービス名とドメイン」の基準（URL が大量に貼られるので短く覚えやすいこと
が直接グロースに効く）に沿って、候補を横並びで比較できる状態にする。最終判断はオーナーに
残す。決定後の作業は `docs/runbooks/rename.md` を参照。

## 自動化されていること

- ドメインの登録状況の確認は `scripts/check-domain.mjs`（RDAP 照会）で行う。以下の表の
  「ドメイン確認」列は、この結果を使っている。

## 候補一覧

読みは正式なブランド表記ではなく検討用のカタカナ表記。ドメイン確認は
`node scripts/check-domain.mjs <domain> [<domain> ...] --json` の実測（`.claude/tmp/domain-check-*.json`）。
`.jp` は RDAP 非対応のため常に「未確認」とし、JPRS WHOIS（https://whois.jprs.jp/）でオーナーが
個別に確認する。

| # | 候補 | 読み | 由来 | 候補ドメイン | ドメイン確認（確認日） | 懸念 |
|---|---|---|---|---|---|---|
| 1 | yoteiurl | よていユーアールエル | 「予定」＋「URL」。合格基準の一文（LINE に直接打つより速いこと）そのままに、予定を URL にするという機能を名前で説明する直球案 | yoteiurl.com / yoteiurl.app / yoteiurl.jp | .com 未登録・.app 未登録（2026-09-21）／.jp 未確認（JPRS WHOIS 要確認） | 説明的すぎて記号として弱い可能性。「予定URL」で検索した際の競合は要確認 |
| 2 | urlyotei | ユーアールエルよてい | yoteiurl と語順違い。読み上げたときの語感（「ゆーあーるえるよてい」）が長く、実運用では省略されそうな点は懸念 | urlyotei.com / urlyotei.app / urlyotei.jp | .com 未登録・.app 未登録（2026-09-21）／.jp 未確認 | yoteiurl と同様。語順以外の差別化がない |
| 3 | yoteishare | よていシェア | 「予定」＋「share」。現行の仮称 calshare の「日本語版」に近い位置づけで、意味の推測がしやすい | yoteishare.com / yoteishare.app / yoteishare.jp | .com 未登録・.app 未登録（2026-09-21）／.jp 未確認 | 「シェア」は他の共有系サービスでも多用される語で識別性が弱い。類似名の既存サービスがないか要確認 |
| 4 | yoteikun | よていくん | 「予定」＋親しみやすい「くん」付け。マスコット的な呼びやすさを狙う | yoteikun.com（登録済み） / yoteikun.app（登録済み） / yoteikun.link | .com 登録済み・.app 登録済み（2026-09-17）／.link 未登録（2026-09-17） | 主要 TLD（.com/.app）が両方取得済みで実質 .link 一択になる。「〜くん」系の名称は同種の他サービスと紛れやすい |
| 5 | sokuyotei | そくよてい | 「即」＋「予定」。入力の速さ（合格基準）を強調する | sokuyotei.com / sokuyotei.app / sokuyotei.jp | .com 未登録・.app 未登録（2026-09-21）／.jp 未確認 | 「即〜」を冠したサービス名は他業種にも多く、検索埋没のリスクがある |
| 6 | tobasu | とばす | 「予定を（相手に）飛ばす」の動詞をそのまま使う。送る・共有するの口語表現 | tobasu.com（登録済み） / tobasu.link / tobasu.jp | .com 登録済み（2026-09-17）／.link 未登録（2026-09-17）／.jp 未確認 | 「飛ばす」は「すっぽかす」の意味でも使われる口語のため、誤解を招く可能性がある |
| 7 | haritsuke | はりつけ | 「貼り付け」（テキストを貼るだけの入力体験）をひらがな化 | haritsuke.com / haritsuke.app / haritsuke.jp | .com 未登録・.app 未登録（2026-09-21）／.jp 未確認 | 同音の「磔（はりつけ）」を連想しうる。ひらがな表記でも懸念が残るため要確認 |
| 8 | yoteicopy | よていコピー | 「予定」＋「copy」。コピー＆ペーストで完結する操作を名前にした | yoteicopy.com / yoteicopy.app / yoteicopy.jp | .com 未登録・.app 未登録（2026-09-17）／.jp 未確認 | 「コピー」は複製・模倣を連想させ、プロダクト名としてはやや弱い印象になりうる |
| 9 | planpaste | プランペースト | 「plan」＋「paste」。yoteicopy の英語版にあたる | planpaste.com / planpaste.app / planpaste.jp | .com 未登録・.app 未登録（2026-09-17）／.jp 未確認 | 英語表記は日本語ユーザー中心のサービスでは読み間違え（プランパスト等）のリスクがある |
| 10 | addplan | アドプラン | 「add to calendar」の add＋plan。カレンダー追加という結果側を名前にした | addplan.link / addplan.app / addplan.com | .link 未登録・.app 未登録（2026-09-17）／.com 登録済み（2026-09-21） | 主要 TLD の .com が既に取得済み。「add」「plan」とも一般語で識別性が弱い |
| 11 | urlkaru | ユーアールエルかる | 「URL」＋「軽い」の「かる」。操作の軽さを強調 | urlkaru.com / urlkaru.app / urlkaru.jp | .com 未登録・.app 未登録（2026-09-17）／.jp 未確認 | 由来が推測しにくく、初見での読み方・意味の伝わりやすさに欠ける |
| 12 | plantoss | プラントス | 「plan」＋「toss」（気軽に放る）。plansnap・caldrop と同系統の英語オノマトペ案 | plantoss.com（登録済み） / plantoss.app / plantoss.link | .com 登録済み（2026-09-17）／.app 未登録・.link 未登録（2026-09-17） | 主要 TLD の .com が取得済み。「トス」はバレーボール等の別文脈を連想させる可能性 |
| 13 | irekun | いれくん | 「（カレンダーに）入れる」＋「くん」 | irekun.com / irekun.app / irekun.jp | .com 未登録・.app 未登録（2026-09-21）／.jp 未確認 | yoteikun と同様「〜くん」系の弱い識別性。「入れ替え」「入れ込む」等との聞き間違いに注意 |
| 14 | calpost | キャルポスト | 「calendar」＋「post（投稿する）」。SNS 文化に寄せた語感 | calpost.com（登録済み） / calpost.app / calpost.link | .com 登録済み（2026-09-17）／.app 未登録・.link 未登録（2026-09-17） | 主要 TLD の .com が取得済み。郵便・配送サービス（〜Post）との混同に注意 |
| 15 | caldrop | キャルドロップ | 「calendar」＋「drop（投げ込む・置いていく）」。URL を相手に「置いていく」感覚 | caldrop.com（登録済み） / caldrop.app（登録済み） / caldrop.link | .com 登録済み・.app 登録済み（2026-09-17）／.link 未登録（2026-09-17） | 主要 TLD（.com/.app）が両方取得済みで実質 .link 一択 |
| 16 | plansnap | プランスナップ | 「plan」＋「snap（パッと撮る・作る）」。作成の速さを写真の比喩で表す | plansnap.com（登録済み） / plansnap.app（登録済み） / plansnap.link | .com 登録済み・.app 登録済み（2026-09-17）／.link 未登録（2026-09-17） | 主要 TLD が両方取得済み。「スナップ写真アプリ」との混同に注意 |
| 17 | calpin | キャルピン | 「calendar」＋「pin（ピン留めする）」。予定を留めておくイメージ | calpin.com（登録済み） / calpin.app（登録済み） / calpin.jp | .com 登録済み・.app 登録済み（2026-09-17）／.jp 未確認 | 主要 TLD が両方取得済みで実質 .jp のみ検討可能 |
| 参考 | yotei | よてい | 「予定」をそのまま使う最短案。意味は最も直接的 | yotei.com / yotei.app / yotei.link | いずれも登録済み（2026-09-17）／.jp 未確認 | 主要 TLD が全て取得済みのため実質使用不可。一般名詞そのものなので取得できても商標登録の識別性は弱い |
| 参考 | calshare（現行の仮称） | キャルシェア | 設計書で使っている仮の名前 | calshare.com / calshare.app / calshare.link | .com 登録済み・.app 登録済み（2026-09-17）／.link 未登録（2026-09-17）／.jp 未確認 | 主要 TLD が取得済みのため、このまま正式名にはできない（H1 が必要な理由そのもの） |

## 推薦順（オーナー判断のための参考。最終決定は覆してよい）

1. **yoteiurl** / **urlyotei** — 主要 TLD（.com・.app）がどちらも空いており、機能をそのまま説明する
   ため誤解が少ない。プロダクト名としての個性は弱いので、ロゴやコピーで補う前提。
2. **yoteishare** — 意味の推測しやすさと語感のバランスが良い。「シェア」の一般名詞性は懸念点。
3. **sokuyotei** / **yoteicopy** / **planpaste** — 主要 TLD が空いている中では、由来が説明しやすい部類。
4. それ以外（yoteikun・tobasu・haritsuke・addplan・urlkaru・irekun・calpost・caldrop・
   plansnap・calpin）は、主要 TLD が既に取得済みか、由来・語感にそれぞれ固有の弱点がある。

「予定を書くとURLになる」という合格基準（concept §01）に最も近いのは yoteiurl / urlyotei だが、
語感の良さを取るなら yoteishare も有力。**この先の絞り込みと最終決定はオーナーが行う。**

## J-PlatPat での商標検索の手順

決定前に、候補ごとに以下を確認する（ドメインが空いていても商標が先に登録されていることがある）。

1. https://www.j-platpat.inpit.go.jp/ を開き、「商標」→「称呼検索」を選ぶ。
2. 候補名の読み（上表の「読み」列）をカタカナで入力して検索する。完全一致だけでなく、
   類似の称呼（読みが近いもの）も一覧に出るので目視で確認する。
3. 区分は主に次を確認する: 第9類（ソフトウェア）、第35類（広告・オンライン小売等の役務）、
   第38類（電気通信）、第42類（ソフトウェアの提供等）。
4. 同一・類似の登録商標が見つかった場合は、区分が重ならないかを確認する
   （区分が異なれば併存できることが多いが、判断が難しい場合は弁理士に相談する）。
5. 見つかった懸念は、この文書の「懸念」列に追記して記録を残す。

このドキュメントの「懸念」列は上記の検索を実施した結果ではなく、名称そのものの性質（一般名詞の
強さ・同音異義語・既存カテゴリとの混同しやすさ）についての予備的な所見に留まる。
J-PlatPat での検索そのものはオーナーが決定前に行う。

## オーナーが行う最小の作業

1. 上表と推薦順を見て候補を絞り込む（複数候補で J-PlatPat 検索まで進めてよい）。
2. `.jp` を検討候補に含める場合は JPRS WHOIS（https://whois.jprs.jp/）で登録状況を確認する。
3. 絞り込んだ候補で J-PlatPat の商標検索を行う。
4. ドメインを実際に取得する（レジストラでの購入は本人認証・支払いを伴うため自動化できない）。
5. `docs/runbooks/rename.md` の手順でリポジトリ内の仮値を置き換える。

## 判断が必要な事項

- サービス名そのものの決定（本ドキュメントは判断材料の提示に留める）。
- `.jp` を取得するかどうか（`.com` / `.app` と揃えて複数 TLD を保有するかは費用と運用の判断）。

## 失敗したときの見方

- `check-domain.mjs` が同じドメインで「不明」を返す場合は RDAP のレート制限（429）か
  ネットワーク到達性の問題。時間を空けて再実行する（内部で 429 は自動リトライするが、
  上限を超えると「不明」のまま返る）。
- 新しい候補を追加で調べる場合は `node scripts/check-domain.mjs <domain> ... --json` を実行し、
  出力をこの表に手動で反映する（`.claude/tmp/` 配下に保存する運用は一時ファイルのため
  コミット対象にしない）。
