#!/usr/bin/env bash
# コミット前フック（Claude Code の PreToolUse: Bash）
# git commit を含むコマンドのとき、コミットされうるファイル（ステージ済み・未ステージ・未追跡）から
# API キー・特典コード・個人情報の文字列を探し、見つかればコミットを止める（exit 2）。
#
# 秘密そのもの（API の組織 ID、特典コードなど）は、このファイルには書かない。
# 手元だけのファイル .claude/secret-patterns.local（.gitignore 済み）に、1行に1つの正規表現で書く。
set -u

cmd=$(jq -r '.tool_input.command // ""')
# git commit を含まないコマンドは素通し
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0

# 誰のリポジトリでも秘密とみなす形
patterns=(
  'sk-ant-[A-Za-z0-9_-]{10,}'                       # Anthropic の API キー
  'ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]"'"'"']{10,}'  # API キーの代入
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'           # 秘密鍵
  'gh[pousr]_[A-Za-z0-9]{30,}'                      # GitHub のトークン
  'AKIA[0-9A-Z]{16}'                                # AWS のアクセスキー
)
local_file=".claude/secret-patterns.local"
if [ -f "$local_file" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    patterns+=("$line")
  done < "$local_file"
fi

# コミットされうるファイル
files=$(
  {
    git diff --cached --name-only --diff-filter=ACMR
    git diff --name-only --diff-filter=ACMR
    git ls-files --others --exclude-standard
  } 2>/dev/null | sort -u
)
[ -z "$files" ] && exit 0

found=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  for p in "${patterns[@]}"; do
    # -I：バイナリは見ない。一致した文字列そのものは出さず、場所だけ出す
    hits=$(grep -nIE -e "$p" -- "$f" 2>/dev/null | cut -d: -f1 | head -5 | paste -sd, -)
    if [ -n "$hits" ]; then
      found+="  - ${f}（${hits} 行目）：パターン ${p:0:24}…"$'\n'
    fi
  done
done <<< "$files"

if [ -n "$found" ]; then
  {
    echo "コミットを止めました：API キー・特典コード・個人情報らしき文字列があります。"
    printf '%s' "$found"
    echo "該当箇所を消すか、.gitignore に入れてから、もう一度コミットしてください。"
  } >&2
  exit 2
fi
exit 0
