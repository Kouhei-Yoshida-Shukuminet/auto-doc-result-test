#!/usr/bin/env bash
# Workflow A：generate-docs.js の出力をもとに docs repo へブランチをpushし、PRを作成（既存なら本文を更新）する
# usage: open-docs-pr.sh <docs-dir> <out-dir>
#   GH_TOKEN   docs repo に書き込めるトークン
#   DOCS_REPO  owner/repo
set -euo pipefail

docs_dir=$1
out_dir=$2
branch=$(cat "$out_dir/branch.txt")
title=$(cat "$out_dir/pr-title.txt")

cd "$docs_dir"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git checkout -B "$branch"
xargs -r git add -- < "$out_dir/changed-files.txt"
if git diff --cached --quiet; then
  echo "No documentation changes. Skipping PR creation."
  exit 0
fi
git commit -q -F "$out_dir/commit-message.txt"
# 同じ実装PRで再実行した場合はブランチを作り直す（再生成の結果で置き換える）
git push --force origin "$branch"

existing=$(gh pr list --repo "$DOCS_REPO" --head "$branch" --state open --json number --jq '.[0].number // empty')
if [ -n "$existing" ]; then
  gh pr edit "$existing" --repo "$DOCS_REPO" --title "$title" --body-file "$out_dir/pr-body.md"
  echo "Updated docs PR #$existing"
else
  gh pr create --repo "$DOCS_REPO" --base main --head "$branch" --title "$title" --body-file "$out_dir/pr-body.md"
fi
