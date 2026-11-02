#!/usr/bin/env bash
# 編集後フック（Claude Code の PostToolUse: Edit|Write）
# ゲームエンジン・テスト・ゲームのデータを編集したら、単体テストを走らせる。
# 失敗したら結果を Claude に返す（exit 2）。それ以外のファイルでは何もしない。
set -u

f=$(jq -r '.tool_input.file_path // .tool_response.filePath // ""')
case "$f" in
  */src/engine/*|*/tests/*|*/data/catalog/*|*/data/rules.json|*/data/generated/*|*/data/stages/*) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0

if ! out=$(npx --no-install vitest run --reporter=dot 2>&1); then
  {
    echo "単体テストが失敗しました（${f##*/} の編集後）："
    printf '%s\n' "$out" | tail -40
  } >&2
  exit 2
fi
exit 0
