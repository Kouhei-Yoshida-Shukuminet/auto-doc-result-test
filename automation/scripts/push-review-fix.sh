#!/usr/bin/env bash
# Workflow B：apply-review.js の結果を同じDocs PRのブランチへcommit/pushし、結果をPRにコメントする
# usage: push-review-fix.sh <docs-dir> <out-dir> <pr-number>
#   GH_TOKEN   docs repo のトークン（GITHUB_TOKEN。これによるpushは新たなworkflowを起動しない）
set -euo pipefail

docs_dir=$1
out_dir=$2
pr=$3
status=$(cat "$out_dir/status.txt")

if [ "$status" = "changed" ]; then
  cd "$docs_dir"
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  xargs -r git add -- < "$out_dir/changed-files.txt"
  git commit -q -F "$out_dir/commit-message.txt"
  git push origin "HEAD:$(git rev-parse --abbrev-ref HEAD)"
  cd - > /dev/null
fi

if [ -s "$out_dir/reply.md" ]; then
  gh pr comment "$pr" --repo "$GITHUB_REPOSITORY" --body-file "$out_dir/reply.md"
fi
