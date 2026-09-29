import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAi } from '../src/ai.js';
import { changeLogPath, loadConfig } from '../src/config.js';
import { parseClosingIssueNumbers, truncateDiff } from '../src/context.js';
import { embedMeta, isAllowedDocPath, parseMeta } from '../src/docs.js';
import { resolveTargets, runGenerate, runReviewFix } from '../src/pipeline.js';
import { buildDocsPrBody, docsBranchName } from '../src/pr-body.js';

const config = loadConfig();
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function tempDocs() {
  const dir = mkdtempSync(join(tmpdir(), 'auto-doc-'));
  for (const d of ['overview', 'features', 'manual', 'changes', 'templates']) {
    cpSync(join(repoRoot, d), join(dir, d), { recursive: true });
  }
  return dir;
}

const context = {
  sourceRepo: 'owner/source',
  pullRequest: { number: 2, title: 'ゼロ除算エラー表示', body: 'Closes #1', url: 'https://example.com/pr/2', merged: true, mergeCommitSha: 'abc' },
  issues: [{ number: 1, title: 'ゼロ除算時のエラー表示を追加する', body: '...', url: 'https://example.com/issues/1', labels: [] }],
  files: [{ filename: 'src/calculator.js', status: 'modified', additions: 10, deletions: 2 }],
  commits: [{ sha: 'abc1234', message: 'feat: zero division' }],
  diff: 'diff --git a/src/calculator.js b/src/calculator.js',
  diffTruncated: false,
};

test('Issueの関連付けキーワードを抽出する', () => {
  assert.deepEqual(parseClosingIssueNumbers('Closes #1\nfixes #12, resolved #1\nrefs #3'), [1, 12]);
  assert.deepEqual(parseClosingIssueNumbers(null), []);
});

test('AIが書き込めるパスを制限する', () => {
  const dirs = config.allowedDocDirs;
  assert.ok(isAllowedDocPath('features/calculator.md', dirs));
  assert.ok(isAllowedDocPath('changes/issue-001.md', dirs));
  for (const bad of ['README.md', 'features/../README.md', '/etc/passwd.md', 'automation/prompts/system.md', '.github/workflows/x.md', 'features/a.js', 'features']) {
    assert.equal(isAllowedDocPath(bad, dirs), false, bad);
  }
});

test('変更記録のファイル名はIssue番号を3桁で使う', () => {
  assert.equal(changeLogPath({ issues: [{ number: 1 }], prNumber: 5 }), 'changes/issue-001.md');
  assert.equal(changeLogPath({ issues: [], prNumber: 5 }), 'changes/pr-005.md');
});

test('大きなdiffは省略したことを明示して切り詰める', () => {
  const { diff, truncated } = truncateDiff('x'.repeat(100), 10);
  assert.ok(truncated);
  assert.match(diff, /diff truncated: 90 chars omitted/);
});

test('PR本文のメタデータを往復できる', () => {
  const meta = { sourceRepo: 'o/r', sourcePr: 2, issues: [1] };
  assert.deepEqual(parseMeta(`body\n\n${embedMeta(meta)}\n`), meta);
  assert.equal(parseMeta('no meta'), null);
});

test('更新対象の判定：不要カテゴリを除外し、カテゴリ外パスを捨て、変更記録は常に含める', () => {
  const doc = (required, files) => ({ required, files, reason: '' });
  const targets = resolveTargets(
    {
      affected_documents: {
        overview: doc(false, ['overview/features.md']),
        feature_spec: doc(true, ['features/calculator.md', 'manual/calculator.md', '../secret.md']),
        manual: doc(true, []),
        change_log: doc(false, []),
      },
    },
    config,
    'changes/issue-001.md',
  );
  assert.deepEqual(targets, [
    { category: 'feature_spec', path: 'features/calculator.md' },
    { category: 'manual', path: 'manual/calculator.md' },
    { category: 'change_log', path: 'changes/issue-001.md' },
  ]);
});

test('mockモードで 分析→判定→生成 とPR本文作成が通る', async () => {
  const docsDir = tempDocs();
  const ai = createAi(config, { mode: 'mock' });
  const { analysis, files } = await runGenerate({ ai, config, context, docsDir });

  assert.deepEqual(files.map((f) => f.path), ['overview/features.md', 'features/calculator.md', 'manual/calculator.md', 'changes/issue-001.md']);
  assert.equal(files.find((f) => f.path === 'changes/issue-001.md').created, true);

  const body = buildDocsPrBody({ context, analysis, files, categoryLabels: { overview: '機能一覧', feature_spec: '機能仕様', manual: '操作マニュアル', change_log: '変更記録' } });
  for (const heading of ['Related Issue', 'Related Implementation PR', 'Change Summary', 'Updated Documents', 'Reason']) {
    assert.match(body, new RegExp(`## ${heading}`));
  }
  assert.deepEqual(parseMeta(body).issues, [1]);
  assert.equal(docsBranchName(context), 'docs/issue-1-pr-2');
});

test('mockモードでレビューコメントの対象ファイルだけを修正する', async () => {
  const docsDir = tempDocs();
  const ai = createAi(config, { mode: 'mock' });
  const { edits, reply } = await runReviewFix({
    ai,
    config,
    context,
    docsDir,
    docsPr: { number: 3, url: 'https://example.com/pr/3', title: 'docs' },
    review: { author: 'reviewer', state: 'commented', body: '' },
    comments: [
      { id: 1, path: 'manual/calculator.md', line: 3, diff_hunk: '@@', body: '表現を直して' },
      { id: 2, path: 'README.md', line: 1, diff_hunk: '@@', body: 'スコープ外' },
    ],
    prFiles: ['manual/calculator.md'],
  });
  assert.deepEqual(edits.map((e) => e.path), ['manual/calculator.md']);
  assert.match(edits[0].content, /mock fix/);
  assert.notEqual(edits[0].content, readFileSync(join(docsDir, 'manual/calculator.md'), 'utf8'));
  assert.match(reply, /2件/);
});
