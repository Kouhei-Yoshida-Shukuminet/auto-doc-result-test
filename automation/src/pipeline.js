// 変更分析 → 更新対象判定 → ドキュメント生成、およびレビューコメントによる修正
import { changeLogPath } from './config.js';
import { isAllowedDocPath, loadDocs, readDoc } from './docs.js';
import { loadPrompt, renderDocs, renderPrompt, renderSourceContext, withLineNumbers } from './prompts.js';
import { AnalysisSchema, GeneratedDocSchema, ReviewFixSchema } from './schemas.js';

const CATEGORY_DIRS = { overview: 'overview', feature_spec: 'features', manual: 'manual', change_log: 'changes' };

// AIの判定結果を、許可されたパス・カテゴリに対応するディレクトリへ正規化する
export function resolveTargets(analysis, config, changeLogFile) {
  const targets = [];
  const seen = new Set();
  for (const [category, dir] of Object.entries(CATEGORY_DIRS)) {
    const decision = analysis.affected_documents[category];
    if (category !== 'change_log' && !decision.required) continue;

    let files = category === 'change_log' ? [changeLogFile] : decision.files;
    if (files.length === 0) files = config.documentCategories[category].defaultFiles ?? [];
    for (const path of files) {
      if (!isAllowedDocPath(path, config.allowedDocDirs) || !path.startsWith(`${dir}/`)) {
        console.warn(`::warning::Ignoring AI-proposed path outside ${dir}/: ${path}`);
        continue;
      }
      if (seen.has(path)) continue;
      seen.add(path);
      targets.push({ category, path });
    }
  }
  return targets;
}

export async function runGenerate({ ai, config, context, docsDir }) {
  const { docs, changeLogs } = loadDocs(docsDir, config.allowedDocDirs);
  const changeLogFile = changeLogPath({ issues: context.issues, prNumber: context.pullRequest.number });
  const cats = config.documentCategories;
  const system = loadPrompt('system');
  const sourceContext = renderSourceContext(context);
  const existingDocs = renderDocs(docs, changeLogs);

  // Stage 1: 変更分析 + 更新対象判定
  const rawAnalysis = await ai.structured({
    stage: 'analyze',
    system,
    user: renderPrompt(loadPrompt('analyze'), {
      source_context: sourceContext,
      existing_docs: existingDocs,
      overview_files: cats.overview.defaultFiles.join(', '),
      feature_spec_files: cats.feature_spec.defaultFiles.join(', '),
      manual_files: cats.manual.defaultFiles.join(', '),
      change_log_file: changeLogFile,
    }),
    schema: AnalysisSchema,
    mockInput: {
      targets: {
        overview: cats.overview.defaultFiles,
        feature_spec: cats.feature_spec.defaultFiles,
        manual: cats.manual.defaultFiles,
        change_log: [changeLogFile],
      },
    },
  });
  const analysis = structuredClone(rawAnalysis);
  analysis.affected_documents.change_log = { ...analysis.affected_documents.change_log, required: true, files: [changeLogFile] };
  const targets = resolveTargets(analysis, config, changeLogFile);

  // Stage 2: 対象ファイルごとに生成
  const generateTemplate = loadPrompt('generate');
  const targetList = targets.map((t) => `- ${t.path}（${cats[t.category].label}）`).join('\n');
  const files = await Promise.all(
    targets.map(async ({ category, path }) => {
      const current = readDoc(docsDir, path);
      const template = cats[category].template ? readDoc(docsDir, cats[category].template) : null;
      const currentSection = current
        ? `現在の内容：\n\n<current_document path="${path}">\n${current}\n</current_document>`
        : `新規作成するファイルです。以下のテンプレートの構成に従ってください。\n\n<template>\n${template ?? '（テンプレートなし）'}\n</template>`;
      const out = await ai.structured({
        stage: 'generate',
        system,
        user: renderPrompt(generateTemplate, {
          source_context: sourceContext,
          existing_docs: existingDocs,
          analysis: JSON.stringify(analysis, null, 2),
          target_files: targetList,
          path,
          category_label: cats[category].label,
          current_section: currentSection,
        }),
        schema: GeneratedDocSchema,
        mockInput: { path, current, context },
      });
      return { category, path, content: out.content, summary: out.summary, created: current === null };
    }),
  );
  return { analysis, targets, files };
}

function renderReviewComments(comments) {
  if (comments.length === 0) return '（行コメントなし）';
  return comments
    .map((c) => {
      const range = c.start_line && c.start_line !== c.line ? ` start_line="${c.start_line}"` : '';
      return [
        `<comment id="${c.id}" path="${c.path}" line="${c.line ?? 'outdated'}"${range}>`,
        `<diff_hunk>\n${c.diff_hunk}\n</diff_hunk>`,
        `<body>\n${c.body}\n</body>`,
        '</comment>',
      ].join('\n');
    })
    .join('\n');
}

export async function runReviewFix({ ai, config, context, docsDir, docsPr, review, comments, prFiles }) {
  // 修正対象として渡すのは、既存Docs + このPRで変更されたファイル（変更記録を含む）
  const { docs } = loadDocs(docsDir, config.allowedDocDirs.filter((d) => d !== 'changes'));
  for (const path of prFiles) {
    if (!isAllowedDocPath(path, config.allowedDocDirs)) continue;
    const content = readDoc(docsDir, path);
    if (content !== null) docs[path] = content;
  }
  const currentDocs = Object.entries(docs)
    .map(([path, content]) => `<document path="${path}">\n${withLineNumbers(content)}\n</document>`)
    .join('\n');

  const result = await ai.structured({
    stage: 'reviewFix',
    system: loadPrompt('system'),
    user: renderPrompt(loadPrompt('review-fix'), {
      source_context: renderSourceContext(context),
      docs_pr_number: String(docsPr.number),
      docs_pr_url: docsPr.url,
      docs_pr_title: docsPr.title,
      pr_files: prFiles.map((p) => `- ${p}`).join('\n'),
      current_docs: currentDocs,
      review_author: review.author,
      review_state: review.state,
      review_body: review.body || '（本文なし）',
      review_comments: renderReviewComments(comments),
    }),
    schema: ReviewFixSchema,
    mockInput: { comments, docs },
  });

  const edits = [];
  for (const edit of result.edits) {
    if (!(edit.path in docs)) {
      console.warn(`::warning::Ignoring AI edit to a file outside the review scope: ${edit.path}`);
      continue;
    }
    const content = edit.content.endsWith('\n') ? edit.content : `${edit.content}\n`;
    if (content === docs[edit.path]) continue;
    edits.push({ ...edit, content });
  }
  return { edits, reply: result.reply };
}
