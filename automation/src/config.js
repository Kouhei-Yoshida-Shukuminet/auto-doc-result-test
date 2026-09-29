import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const AUTOMATION_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function loadConfig() {
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  // モデルは環境変数で差し替え可能（コード変更なしで比較検証できるように）
  if (process.env.AUTO_DOC_MODEL) config.model = process.env.AUTO_DOC_MODEL;
  return config;
}

export function changeLogPath({ issues, prNumber }) {
  if (issues.length > 0) return `changes/issue-${String(issues[0].number).padStart(3, '0')}.md`;
  return `changes/pr-${String(prNumber).padStart(3, '0')}.md`;
}
