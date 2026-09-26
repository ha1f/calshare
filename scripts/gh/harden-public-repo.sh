#!/usr/bin/env bash
# public 化した直後に 1 回実行する GitHub リポジトリの保護設定（docs/runbooks/public-repo.md）。
# すべて PUT/PATCH で毎回同じ内容を送るだけなので冪等。何度再実行しても安全。
#
# 呼んでいる GitHub REST API（2026-09 時点の公開ドキュメントで確認）:
#   - PUT  /repos/{owner}/{repo}/vulnerability-alerts            Dependabot alerts
#   - PUT  /repos/{owner}/{repo}/automated-security-fixes        Dependabot security updates
#   - PATCH /repos/{owner}/{repo}                                 secret scanning・push protection
#   - PUT  /repos/{owner}/{repo}/private-vulnerability-reporting
#   - PUT  /repos/{owner}/{repo}/branches/{branch}/protection
#   - GET/PUT /repos/{owner}/{repo}/actions/permissions/workflow  Default workflow permissions
#   - GET  /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval
#
# 要検証:
#   - fork-pr-contributor-approval は public リポジトリでの実地確認がまだない（ドキュメント上の
#     記載のみで確認した）。404 になる場合は Settings > Actions > General の
#     「Fork pull request workflows from outside collaborators」を直接確認する。
#   - dependabot_security_updates は automated-security-fixes と機能が重複するため、
#     security_and_analysis の PATCH には含めていない（automated-security-fixes 側だけを呼ぶ）。
set -euo pipefail

usage() {
  cat <<'EOF'
使い方: scripts/gh/harden-public-repo.sh --repo <owner/repo> [--dry-run] [--help]

public 化した直後に実行する設定（すべて冪等）:
  1. Dependabot alerts の有効化
  2. Dependabot security updates の有効化
  3. secret scanning と push protection の有効化
  4. Private vulnerability reporting の有効化
  5. main ブランチの保護（必須ステータスチェック ci・force push 禁止・削除禁止。
     個人開発のため required_pull_request_reviews は付けない）
  6. Actions の Default workflow permissions が read か確認し、read でなければ変更する
  7. fork PR のワークフロー承認設定を確認する（表示のみ。変更はオーナー判断なので行わない）

  --repo <owner/repo>  対象リポジトリ（必須）
  --dry-run            gh api を呼ばず、実行予定の API 呼び出しを表示するだけにする
  --help               このヘルプを表示する

事前に `gh auth login` 済みで、対象リポジトリに対して admin 権限が要る。
EOF
}

repo=""
dry_run=0
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      echo "不明な引数です: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$repo" ]; then
  echo "--repo は必須です（例: --repo ha1f/calshare）" >&2
  usage >&2
  exit 1
fi

case "$repo" in
  */*) ;;
  *)
    echo "--repo は owner/repo 形式で指定してください: $repo" >&2
    exit 1
    ;;
esac

if [ "$dry_run" -eq 0 ]; then
  command -v gh >/dev/null 2>&1 || {
    echo "gh コマンドが見つかりません。https://cli.github.com/ からインストールしてください" >&2
    exit 1
  }
fi

failed=0

note() {
  echo "== $1 =="
}

# HTTP ステータスから、何が足りていないかの手がかりを表示する
hint_for_error() {
  case "$1" in
    *"HTTP 403"*)
      echo "  ヒント: admin 権限、または gh のトークンスコープ（repo）が不足している可能性があります。" >&2
      ;;
    *"HTTP 404"*)
      echo "  ヒント: リポジトリ名が違うか、この機能がプランで使えない可能性があります（private リポジトリの Advanced Security 等）。public リポジトリなら通常は無償で使えます。" >&2
      ;;
    *"HTTP 422"*)
      echo "  ヒント: リクエスト内容が API 仕様と食い違っている可能性があります（仕様変更。要確認）。" >&2
      ;;
    *) : ;;
  esac
}

# body を持たない PUT（レスポンスは 204 No Content）
do_put() {
  local desc="$1" path="$2"
  if [ "$dry_run" -eq 1 ]; then
    echo "[dry-run] PUT $path — $desc"
    return 0
  fi
  local err
  if err=$(gh api -X PUT "$path" 2>&1 >/dev/null); then
    echo "OK: $desc"
  else
    echo "失敗: $desc（PUT $path）" >&2
    echo "  $err" >&2
    hint_for_error "$err"
    failed=1
  fi
}

# JSON body を持つ PUT/PATCH。gh api の -f/-F はネストした null や配列を組み立てられないため
# --input - に heredoc で渡す
do_body() {
  local method="$1" desc="$2" path="$3" body="$4"
  if [ "$dry_run" -eq 1 ]; then
    echo "[dry-run] $method $path — $desc"
    return 0
  fi
  local err
  if err=$(gh api -X "$method" "$path" --input - <<<"$body" 2>&1 >/dev/null); then
    echo "OK: $desc"
  else
    echo "失敗: $desc（$method $path）" >&2
    echo "  $err" >&2
    hint_for_error "$err"
    failed=1
  fi
}

check_default_workflow_permissions() {
  local path="repos/$repo/actions/permissions/workflow"
  if [ "$dry_run" -eq 1 ]; then
    echo "[dry-run] GET $path — 現在の default_workflow_permissions を確認"
    echo "[dry-run] PUT $path — read でなければ read に変更する（can_approve_pull_request_reviews は現状維持）"
    return 0
  fi
  local current
  if ! current=$(gh api "$path" --jq '.default_workflow_permissions' 2>&1); then
    echo "失敗: Default workflow permissions の確認（GET $path）" >&2
    echo "  $current" >&2
    hint_for_error "$current"
    failed=1
    return 0
  fi
  if [ "$current" = "read" ]; then
    echo "OK: Default workflow permissions は既に read です"
    return 0
  fi
  echo "Default workflow permissions が $current のため read に変更します"
  local approve body err
  approve=$(gh api "$path" --jq '.can_approve_pull_request_reviews' 2>/dev/null || echo false)
  body=$(printf '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":%s}' "$approve")
  if err=$(gh api -X PUT "$path" --input - <<<"$body" 2>&1 >/dev/null); then
    echo "OK: Default workflow permissions を read に変更しました"
  else
    echo "失敗: Default workflow permissions の変更（PUT $path）" >&2
    echo "  $err" >&2
    hint_for_error "$err"
    failed=1
  fi
}

# fork PR の承認設定は「public 化で fork から誰でも workflow を実行できるようになるが、
# どこまで承認を必須にするか」というオーナー判断なので、確認して表示するだけに留める
check_fork_pr_approval() {
  local path="repos/$repo/actions/permissions/fork-pr-contributor-approval"
  if [ "$dry_run" -eq 1 ]; then
    echo "[dry-run] GET $path — fork PR のワークフロー承認設定を確認する（表示のみ。変更はしない）"
    return 0
  fi
  local current
  if ! current=$(gh api "$path" --jq '.approval_policy' 2>&1); then
    echo "確認できませんでした: fork PR のワークフロー承認設定（GET $path）" >&2
    echo "  $current" >&2
    echo "  要検証: このエンドポイントは public リポジトリでの実地確認がまだありません。404 の場合は" >&2
    echo "  GitHub の Settings > Actions > General を直接確認してください。" >&2
    return 0
  fi
  echo "現在の fork PR ワークフロー承認設定: $current"
  case "$current" in
    all_external_contributors | first_time_contributors)
      echo "OK: 初回コントリビューター以上に承認を要求する設定です"
      ;;
    *)
      echo "注意: 「$current」です。fork からの初回 PR でも承認なしに workflow が動く可能性があります。"
      echo "  Settings > Actions > General > 'Fork pull request workflows from outside collaborators' で見直しを検討してください（オーナー判断のため自動変更しません）。"
      ;;
  esac
}

note "1. Dependabot alerts の有効化"
do_put "Dependabot alerts の有効化" "repos/$repo/vulnerability-alerts"

note "2. Dependabot security updates の有効化"
do_put "Dependabot security updates の有効化" "repos/$repo/automated-security-fixes"

note "3. secret scanning と push protection の有効化"
do_body PATCH "secret scanning と push protection の有効化" "repos/$repo" '{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}'

note "4. Private vulnerability reporting の有効化"
do_put "Private vulnerability reporting の有効化" "repos/$repo/private-vulnerability-reporting"

note "5. main ブランチ保護"
do_body PUT "main ブランチ保護（必須チェック ci・force push 禁止・削除禁止）" "repos/$repo/branches/main/protection" '{
  "required_status_checks": {
    "strict": false,
    "checks": [{ "context": "ci" }]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}'

note "6. Actions の Default workflow permissions"
check_default_workflow_permissions

note "7. fork PR のワークフロー承認設定（確認のみ）"
check_fork_pr_approval

echo ""
if [ "$failed" -eq 1 ]; then
  echo "一部の設定に失敗しました。上記のヒントを参考に権限・プランを確認し、再実行してください（冪等です）。" >&2
  exit 1
fi
echo "完了しました。'gh api repos/$repo' や Settings > Code security の画面で反映を確認してください。"
