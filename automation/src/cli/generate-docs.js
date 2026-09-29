// Workflow A：実装PRのマージを起点に、docs repo の作業ツリーへ更新を書き込み、PR作成用ファイルを出力する
//
// usage: node src/cli/generate-docs.js --source-repo owner/repo --pr 12 --docs-dir ../ --out /tmp/auto-doc
//   GITHUB_TOKEN        実装repoの Issue / PR を読むトークン
//   ANTHROPIC_API_KEY   Claude API キー（AUTO_DOC_AI_MODE=mock の場合は不要）
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createAi } from '../ai.js';
import { loadConfig } from '../config.js';
import { collectSourceContext } from '../context.js';
import { writeDoc } from '../docs.js';
import { createGitHub } from '../github.js';
import { runGenerate } from '../pipeline.js';
import { buildDocsPrBody, docsBranchName, docsPrTitle } from '../pr-body.js';

const { values: args } = parseArgs({
  options: {
    'source-repo': { type: 'string' },
    pr: { type: 'string' },
    'docs-dir': { type: 'string', default: '.' },
    out: { type: 'string', default: '.auto-doc-out' },
  },
});
if (!args['source-repo'] || !args.pr) {
  console.error('usage: generate-docs.js --source-repo owner/repo --pr <number> [--docs-dir dir] [--out dir]');
  process.exit(2);
}

const config = loadConfig();
const docsDir = resolve(args['docs-dir']);
const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });

const gh = createGitHub({ token: process.env.GITHUB_TOKEN });
const context = await collectSourceContext(gh, {
  sourceRepo: args['source-repo'],
  prNumber: Number(args.pr),
  maxDiffChars: config.maxDiffChars,
});
if (!context.pullRequest.merged) console.warn('::warning::Source PR is not merged (continuing for local verification).');
console.log(`Source PR #${context.pullRequest.number}: ${context.pullRequest.title}`);
console.log(`Linked issues: ${context.issues.map((i) => `#${i.number}`).join(', ') || '(none)'}`);

const ai = createAi(config);
const { analysis, files } = await runGenerate({ ai, config, context, docsDir });
for (const file of files) writeDoc(docsDir, file.path, file.content);

const categoryLabels = Object.fromEntries(Object.entries(config.documentCategories).map(([k, v]) => [k, v.label]));
const branch = docsBranchName(context);
const title = docsPrTitle(context);
const body = buildDocsPrBody({ context, analysis, files, categoryLabels });
const commitMessage = `${title}\n\nGenerated from ${context.sourceRepo}#${context.pullRequest.number} [auto-doc]\n`;

writeFileSync(join(outDir, 'context.json'), JSON.stringify(context, null, 2));
writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
writeFileSync(join(outDir, 'pr-body.md'), body);
writeFileSync(join(outDir, 'pr-title.txt'), title);
writeFileSync(join(outDir, 'branch.txt'), branch);
writeFileSync(join(outDir, 'commit-message.txt'), commitMessage);
writeFileSync(join(outDir, 'changed-files.txt'), `${files.map((f) => f.path).join('\n')}\n`);

console.log(`AI mode: ${ai.mode}`);
console.log(`Branch: ${branch}`);
console.log(`Updated: ${files.map((f) => f.path).join(', ')}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## AI change analysis\n\n\`\`\`json\n${JSON.stringify(analysis, null, 2)}\n\`\`\`\n`);
}
