// Workflow B：Docs PR のレビューコメントをAIへの修正指示として、PRブランチの作業ツリーを修正する
//
// usage: node src/cli/apply-review.js --repo owner/docs-repo --pr 3 --review-id 123 --docs-dir ./docs --out /tmp/auto-doc
//   GITHUB_TOKEN          docs repo の PR / レビューを読むトークン
//   SOURCE_GITHUB_TOKEN   実装repoを読むトークン（未指定なら GITHUB_TOKEN。実装repoが public ならそれで読める）
//   ANTHROPIC_API_KEY     Claude API キー（AUTO_DOC_AI_MODE=mock の場合は不要）
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createAi } from '../ai.js';
import { loadConfig } from '../config.js';
import { collectSourceContext } from '../context.js';
import { parseMeta, writeDoc } from '../docs.js';
import { createGitHub, splitRepo } from '../github.js';
import { runReviewFix } from '../pipeline.js';

const FIX_COMMIT_TAG = '[auto-doc-fix]';

const { values: args } = parseArgs({
  options: {
    repo: { type: 'string', default: process.env.GITHUB_REPOSITORY },
    pr: { type: 'string' },
    'review-id': { type: 'string' },
    'docs-dir': { type: 'string', default: '.' },
    out: { type: 'string', default: '.auto-doc-out' },
  },
});
if (!args.repo || !args.pr || !args['review-id']) {
  console.error('usage: apply-review.js --repo owner/repo --pr <number> --review-id <id> [--docs-dir dir] [--out dir]');
  process.exit(2);
}

const config = loadConfig();
const docsDir = resolve(args['docs-dir']);
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });

function finish(status, reply = '') {
  writeFileSync(join(outDir, 'status.txt'), status);
  writeFileSync(join(outDir, 'reply.md'), reply);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\n`);
  console.log(`status=${status}`);
  process.exit(0);
}

const gh = createGitHub({ token: process.env.GITHUB_TOKEN });
const sourceGh = createGitHub({ token: process.env.SOURCE_GITHUB_TOKEN || process.env.GITHUB_TOKEN });
const { owner, repo } = splitRepo(args.repo);
const base = `/repos/${owner}/${repo}/pulls/${args.pr}`;
const reviewId = Number(args['review-id']);

const pr = await gh.get(base);
const meta = parseMeta(pr.body);
if (!meta) finish('skipped', 'auto-doc のメタデータがないPRのため対象外です。');

const review = await gh.get(`${base}/reviews/${reviewId}`);
const comments = (await gh.paginate(`${base}/comments`))
  .filter((c) => c.pull_request_review_id === reviewId)
  .map((c) => ({
    id: c.id,
    path: c.path,
    line: c.line,
    start_line: c.start_line,
    diff_hunk: c.diff_hunk,
    body: c.body,
  }));
if (!review.body?.trim() && comments.length === 0) finish('skipped', '');

// 無限ループ・暴走防止：AIによる修正コミット数に上限を設ける
const commits = await gh.paginate(`${base}/commits`);
const rounds = commits.filter((c) => c.commit.message.includes(FIX_COMMIT_TAG)).length;
if (rounds >= config.maxReviewFixRounds) {
  finish('limit', `AIによる修正が上限（${config.maxReviewFixRounds}回）に達したため、自動修正を停止しました。以降は手動で修正してください。`);
}

const prFiles = (await gh.paginate(`${base}/files`)).filter((f) => f.status !== 'removed').map((f) => f.filename);
const context = await collectSourceContext(sourceGh, {
  sourceRepo: meta.sourceRepo,
  prNumber: meta.sourcePr,
  maxDiffChars: config.maxDiffChars,
});

const ai = createAi(config);
const { edits, reply } = await runReviewFix({
  ai,
  config,
  context,
  docsDir,
  docsPr: { number: pr.number, url: pr.html_url, title: pr.title },
  review: { author: review.user.login, state: review.state, body: review.body ?? '' },
  comments,
  prFiles,
});
for (const edit of edits) writeDoc(docsDir, edit.path, edit.content);

const editList = edits.length ? edits.map((e) => `- \`${e.path}\`：${e.summary}`).join('\n') : '- なし';
const replyBody = `### 🤖 AI修正結果（review ${reviewId}）\n\n${reply}\n\n**変更したファイル**\n${editList}\n`;
writeFileSync(join(outDir, 'changed-files.txt'), `${edits.map((e) => e.path).join('\n')}\n`);
writeFileSync(
  join(outDir, 'commit-message.txt'),
  `docs: apply review feedback from @${review.user.login} ${FIX_COMMIT_TAG}\n\nReview: ${review.html_url}\n`,
);
finish(edits.length ? 'changed' : 'no-change', replyBody);
