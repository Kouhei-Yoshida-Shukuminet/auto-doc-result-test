// 実装repoから Issue / PR / 変更ファイル / diff / コミットを収集する
import { splitRepo } from './github.js';

const CLOSING_KEYWORD = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi;

export function parseClosingIssueNumbers(text) {
  return [...new Set([...(text ?? '').matchAll(CLOSING_KEYWORD)].map((m) => Number(m[1])))];
}

async function linkedIssueNumbers(gh, { owner, repo }, pr) {
  // GitHubが解決した関連付け（Development欄）を優先し、本文のキーワードで補完する
  let numbers = [];
  try {
    const data = await gh.graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) { closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } } }
        }
      }`,
      { owner, repo, number: pr.number },
    );
    numbers = data.repository.pullRequest.closingIssuesReferences.nodes
      .filter((n) => n.repository.nameWithOwner.toLowerCase() === `${owner}/${repo}`.toLowerCase())
      .map((n) => n.number);
  } catch (error) {
    console.warn(`closingIssuesReferences unavailable, falling back to PR body: ${error.message}`);
  }
  return [...new Set([...numbers, ...parseClosingIssueNumbers(pr.body)])];
}

export function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return { diff, truncated: false };
  return {
    diff: `${diff.slice(0, maxChars)}\n\n[... diff truncated: ${diff.length - maxChars} chars omitted ...]\n`,
    truncated: true,
  };
}

export async function collectSourceContext(gh, { sourceRepo, prNumber, maxDiffChars }) {
  const { owner, repo } = splitRepo(sourceRepo);
  const base = `/repos/${owner}/${repo}`;

  const pr = await gh.get(`${base}/pulls/${prNumber}`);
  const [issueNumbers, files, commits, rawDiff] = await Promise.all([
    linkedIssueNumbers(gh, { owner, repo }, pr),
    gh.paginate(`${base}/pulls/${prNumber}/files`),
    gh.paginate(`${base}/pulls/${prNumber}/commits`),
    gh.getText(`${base}/pulls/${prNumber}`, 'application/vnd.github.diff'),
  ]);
  const issues = await Promise.all(
    issueNumbers.map(async (number) => {
      const issue = await gh.get(`${base}/issues/${number}`);
      return {
        number,
        title: issue.title,
        body: issue.body ?? '',
        url: issue.html_url,
        labels: issue.labels.map((l) => l.name),
      };
    }),
  );
  const { diff, truncated } = truncateDiff(rawDiff, maxDiffChars);
  if (truncated) console.warn(`::warning::Diff exceeds ${maxDiffChars} chars and was truncated for the AI context.`);

  return {
    sourceRepo,
    pullRequest: {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      url: pr.html_url,
      author: pr.user?.login,
      merged: pr.merged,
      mergeCommitSha: pr.merge_commit_sha,
      baseRef: pr.base.ref,
    },
    issues,
    files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })),
    commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message })),
    diff,
    diffTruncated: truncated,
  };
}
