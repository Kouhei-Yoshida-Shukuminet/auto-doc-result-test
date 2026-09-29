// prompts/*.md を読み込み {{name}} を差し込む。プロンプトの変更はMarkdown側だけで完結させる
import { readFileSync } from 'node:fs';

export function loadPrompt(name) {
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8');
}

export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Missing prompt variable: ${key}`);
    return vars[key];
  });
}

const escapeAttr = (value) => String(value).replace(/"/g, '&quot;');

export function renderSourceContext(context) {
  const issues = context.issues.length
    ? context.issues
        .map((i) => `<issue number="${i.number}" url="${escapeAttr(i.url)}">\n# ${i.title}\n\n${i.body}\n</issue>`)
        .join('\n')
    : '<issue>関連Issueなし</issue>';
  const pr = context.pullRequest;
  const files = context.files.map((f) => `- ${f.status} ${f.filename} (+${f.additions} -${f.deletions})`).join('\n');
  const commits = context.commits.map((c) => `- ${c.sha} ${c.message.split('\n')[0]}`).join('\n');
  return [
    `<source_repository>${context.sourceRepo}</source_repository>`,
    issues,
    `<pull_request number="${pr.number}" url="${escapeAttr(pr.url)}">\n# ${pr.title}\n\n${pr.body}\n</pull_request>`,
    `<changed_files>\n${files}\n</changed_files>`,
    `<commits>\n${commits}\n</commits>`,
    `<diff${context.diffTruncated ? ' truncated="true"' : ''}>\n${context.diff}\n</diff>`,
  ].join('\n\n');
}

export function renderDocs(docs, changeLogs = []) {
  const bodies = Object.entries(docs)
    .map(([path, content]) => `<document path="${escapeAttr(path)}">\n${content}\n</document>`)
    .join('\n');
  const logs = changeLogs.length ? changeLogs.map((p) => `- ${p}`).join('\n') : '（なし）';
  return `<existing_documents>\n${bodies}\n</existing_documents>\n\n<existing_change_logs>\n${logs}\n</existing_change_logs>`;
}

export function withLineNumbers(content) {
  return content
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4)}| ${line}`)
    .join('\n');
}
