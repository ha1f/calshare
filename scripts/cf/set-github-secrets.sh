#!/usr/bin/env bash
# GitHub Secrets（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / REPORT_WEBHOOK_URL）を
# このリポジトリに 1 コマンドで登録する。値は環境変数から読むか、無ければ対話的に読む
# （どちらも引数には載せない。シェル履歴やプロセス一覧にトークンを残さないため）。
# 事前に `gh auth login` 済みで、このリポジトリに対して gh が使える必要がある。
set -euo pipefail

usage() {
  cat <<'EOF'
使い方: scripts/cf/set-github-secrets.sh [--dry-run] [--help]

環境変数（未設定なら対話的に入力を求める。REPORT_WEBHOOK_URL のみ空で進める選択もできる）:
  CLOUDFLARE_API_TOKEN   必須。docs/runbooks/cloudflare-api-token.md の手順で発行したトークン
  CLOUDFLARE_ACCOUNT_ID  必須。Cloudflare ダッシュボードで確認できる Account ID
  REPORT_WEBHOOK_URL     任意。通報通知用の Discord/Slack Incoming Webhook URL（H7）

  --dry-run   gh を呼ばず、登録される Secret 名の一覧だけを表示する
  --help      このヘルプを表示する
EOF
}

dry_run=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "不明な引数です: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

if [ "$dry_run" -eq 1 ]; then
  echo "[dry-run] 以下の Secret を登録する計画です（実際には何も変更しません）"
  echo "  - CLOUDFLARE_API_TOKEN"
  echo "  - CLOUDFLARE_ACCOUNT_ID"
  if [ -n "${REPORT_WEBHOOK_URL:-}" ]; then
    echo "  - REPORT_WEBHOOK_URL"
  else
    echo "  - REPORT_WEBHOOK_URL（環境変数未設定。実行時に入力を求め、空のままなら登録をスキップします）"
  fi
  exit 0
fi

command -v gh >/dev/null 2>&1 || {
  echo "gh コマンドが見つかりません。https://cli.github.com/ からインストールしてください" >&2
  exit 1
}

read_secret() {
  local var_name="$1" prompt_text="$2" value
  value="${!var_name:-}"
  if [ -z "$value" ]; then
    read -r -s -p "$prompt_text: " value
    echo >&2
  fi
  printf '%s' "$value"
}

token="$(read_secret CLOUDFLARE_API_TOKEN 'Cloudflare API トークン')"
[ -n "$token" ] || { echo "CLOUDFLARE_API_TOKEN が空です" >&2; exit 1; }
printf '%s' "$token" | gh secret set CLOUDFLARE_API_TOKEN
echo "CLOUDFLARE_API_TOKEN を登録しました"

account_id="$(read_secret CLOUDFLARE_ACCOUNT_ID 'Cloudflare Account ID')"
[ -n "$account_id" ] || { echo "CLOUDFLARE_ACCOUNT_ID が空です" >&2; exit 1; }
printf '%s' "$account_id" | gh secret set CLOUDFLARE_ACCOUNT_ID
echo "CLOUDFLARE_ACCOUNT_ID を登録しました"

webhook="${REPORT_WEBHOOK_URL:-}"
if [ -z "$webhook" ]; then
  read -r -p "通報 Webhook URL（任意。無ければ Enter で空のまま進みます）: " webhook
fi
if [ -n "$webhook" ]; then
  printf '%s' "$webhook" | gh secret set REPORT_WEBHOOK_URL
  echo "REPORT_WEBHOOK_URL を登録しました"
else
  echo "REPORT_WEBHOOK_URL は未設定のままにしました（後で同じコマンドを再実行すれば登録できます）"
fi

echo "完了しました。'gh secret list' で確認できます。"
