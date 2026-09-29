import { embedMeta } from './docs.js';

const yesNo = (value) => (value ? 'Yes' : 'No');

export function docsBranchName(context) {
  const pr = context.pullRequest.number;
  return context.issues.length > 0 ? `docs/issue-${context.issues[0].number}-pr-${pr}` : `docs/pr-${pr}`;
}

export function docsPrTitle(context) {
  const issue = context.issues[0];
  return issue
    ? `docs: ${issue.title} (${context.sourceRepo}#${issue.number})`
    : `docs: ${context.pullRequest.title} (${context.sourceRepo}#${context.pullRequest.number})`;
}

export function buildDocsPrBody({ context, analysis, files, categoryLabels }) {
  const pr = context.pullRequest;
  const issues = context.issues.length
    ? context.issues.map((i) => `- [${context.sourceRepo}#${i.number}](${i.url}) ${i.title}`).join('\n')
    : '- なし（実装PRにIssueが関連付けられていません）';
  const updated = files
    .map((f) => `| \`${f.path}\` | ${categoryLabels[f.category]} | ${f.created ? '新規' : '更新'} | ${f.summary.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
    .join('\n');
  const reasons = Object.entries(analysis.affected_documents)
    .map(([category, d]) => `- **${categoryLabels[category]}**：${d.required ? '更新' : '更新なし'} — ${d.reason}`)
    .join('\n');
  const meta = {
    sourceRepo: context.sourceRepo,
    sourcePr: pr.number,
    issues: context.issues.map((i) => i.number),
    mergeCommitSha: pr.mergeCommitSha,
  };

  return `## Related Issue
${issues}

## Related Implementation PR
- [${context.sourceRepo}#${pr.number}](${pr.url}) ${pr.title}

## Change Summary
${analysis.summary}

## Updated Documents
| File | Category | Type | Summary |
| --- | --- | --- | --- |
${updated}

## Reason
${reasons}

## Impact
- Change Type: ${analysis.change_type}
- Breaking Change: ${yesNo(analysis.breaking_change)}
- Migration Required: ${yesNo(analysis.migration_required)}
- Manual Update Required: ${yesNo(files.some((f) => f.category === 'manual'))}
${context.diffTruncated ? '\n> [!WARNING]\n> 実装diffが大きいため、AIへの入力時に一部を省略しました。差分全体は実装PRで確認してください。\n' : ''}
---
このPRはAIが自動生成しました。修正が必要な場合は **Review Comment**（行コメント または Comment / Request changes のレビュー）で指示してください。AIが同じPRへ修正commitを追加します。Approve では起動しません。

${embedMeta(meta)}
`;
}
