// docs repo のファイル読み書きと、AIが触ってよいパスの制限
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

export function isAllowedDocPath(path, allowedDirs) {
  if (typeof path !== 'string' || !path.endsWith('.md')) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized.split('/').includes('..')) return false;
  const [dir, ...rest] = normalized.split('/');
  return allowedDirs.includes(dir) && rest.length >= 1;
}

export function assertAllowedDocPath(path, allowedDirs) {
  if (!isAllowedDocPath(path, allowedDirs)) {
    throw new Error(`AI attempted to write a disallowed path: ${JSON.stringify(path)}`);
  }
}

function listMarkdown(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listMarkdown(root, rel);
    return entry.name.endsWith('.md') ? [rel] : [];
  });
}

// { path: content } を返す。変更記録は量が増えるので本文は含めずパス一覧だけ渡す
export function loadDocs(docsDir, allowedDirs) {
  const docs = {};
  const changeLogs = [];
  for (const dir of allowedDirs) {
    for (const path of listMarkdown(docsDir, dir).sort()) {
      if (dir === 'changes') changeLogs.push(path);
      else docs[path] = readFileSync(join(docsDir, path), 'utf8');
    }
  }
  return { docs, changeLogs };
}

export function readDoc(docsDir, path) {
  const abs = join(docsDir, path);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

export function writeDoc(docsDir, path, content) {
  const abs = join(docsDir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content.endsWith('\n') ? content : `${content}\n`);
}

// Docs PR本文に埋め込むメタデータ（Workflow B が関連Issue / 実装PRを辿るために使う）
const META_PATTERN = /<!--\s*auto-doc-meta:\s*(\{.*?\})\s*-->/s;

export function embedMeta(meta) {
  return `<!-- auto-doc-meta: ${JSON.stringify(meta)} -->`;
}

export function parseMeta(body) {
  const match = (body ?? '').match(META_PATTERN);
  return match ? JSON.parse(match[1]) : null;
}
