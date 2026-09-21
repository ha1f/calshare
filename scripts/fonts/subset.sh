#!/usr/bin/env bash
# Noto Sans JP Regular を「JIS 第1水準漢字 + ひらがな + カタカナ + 英数記号 + 一般的な約物」に
# サブセット化する（fonttools の pyftsubset を使う）。R2 への配置はしない
# （.github/workflows/provision.yml の font ジョブが後続で行う）。
# 対象文字の範囲を選んだ理由は docs/runbooks/fonts.md を参照。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_FONT_IN=".claude/tmp/fonts/NotoSansJP-Regular.otf"
DEFAULT_OUT="dist/fonts/NotoSansJP-Regular.subset.otf"

usage() {
  cat <<EOF
使い方: scripts/fonts/subset.sh [--font <path>] [--out <path>] [--dry-run] [--json] [--help]

  --font <path>  サブセット元の OTF（既定: ${DEFAULT_FONT_IN}。
                 download-noto-sans-jp.mjs の既定の保存先と一致させている）
  --out <path>   出力先（既定: ${DEFAULT_OUT}。provision.yml の font ジョブが
                 'wrangler r2 object put' の --file に使うパスと一致させている）
  --dry-run      pyftsubset を呼ばず、対象文字数と入出力パスだけを表示する
  --json         結果を機械可読な JSON で出力する
  --help         このヘルプを表示する
EOF
}

font_in="$DEFAULT_FONT_IN"
out="$DEFAULT_OUT"
dry_run=0
json=0
while [ $# -gt 0 ]; do
  case "$1" in
    --font) font_in="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --json) json=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "不明な引数です: $1" >&2; usage >&2; exit 1 ;;
  esac
done

chars_file="$(mktemp)"
trap 'rm -f "$chars_file"' EXIT

# ひらがな・カタカナ・半角英数記号・一般的な約物は範囲が小さく固定なので、
# 生成スクリプトを持たずここに直接書く（第1水準漢字だけ generate-jis-level1.mjs で生成する）。
cat > "$chars_file" <<'CHARS_EOF'
 !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~
　、。・「」『』【】（）〜？！：；
ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔ
ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴー・ヵヶ
CHARS_EOF
node "$SCRIPT_DIR/generate-jis-level1.mjs" >> "$chars_file"

char_count=$(node -e "
const fs = require('node:fs')
const text = fs.readFileSync(process.argv[1], 'utf8')
const uniq = new Set([...text].filter((c) => c !== '\n'))
process.stdout.write(String(uniq.size))
" "$chars_file")

if [ "$dry_run" -eq 1 ]; then
  if [ "$json" -eq 1 ]; then
    printf '{"dryRun":true,"font":"%s","out":"%s","charCount":%s}\n' "$font_in" "$out" "$char_count"
  else
    echo "[dry-run] 入力: $font_in"
    echo "[dry-run] 出力: $out"
    echo "[dry-run] 対象文字数: $char_count"
  fi
  exit 0
fi

if ! command -v pyftsubset >/dev/null 2>&1; then
  cat >&2 <<'EOF'
pyftsubset（fonttools）が見つかりません。次のいずれかでインストールしてください。

  pip install fonttools
  # または venv を切って使う場合:
  python3 -m venv .venv && .venv/bin/pip install fonttools
  # このときは .venv/bin にパスを通すか、.venv/bin/pyftsubset を直接呼ぶ
EOF
  exit 1
fi

if [ ! -f "$font_in" ]; then
  echo "入力フォントが見つかりません: $font_in" >&2
  echo "先に 'node scripts/fonts/download-noto-sans-jp.mjs' を実行してください。" >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"
pyftsubset "$font_in" \
  --text-file="$chars_file" \
  --output-file="$out" \
  --layout-features='' \
  --name-IDs=''

bytes=$(wc -c < "$out" | tr -d ' ')
if [ "$json" -eq 1 ]; then
  printf '{"font":"%s","out":"%s","charCount":%s,"bytes":%s}\n' "$font_in" "$out" "$char_count" "$bytes"
else
  echo "サブセット化しました: $out ($bytes bytes, 対象文字数 $char_count)"
fi
