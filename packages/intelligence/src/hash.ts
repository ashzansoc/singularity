import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${randomUUID()}`;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/g)
    .filter((t) => t.length > 1);
}

export function languageFromPath(filePath: string): string | undefined {
  const p = filePath.toLowerCase();
  if (p.endsWith('.tsx')) {
    return 'typescriptreact';
  }
  if (p.endsWith('.ts')) {
    return 'typescript';
  }
  if (p.endsWith('.jsx')) {
    return 'javascriptreact';
  }
  if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) {
    return 'javascript';
  }
  if (p.endsWith('.py')) {
    return 'python';
  }
  if (p.endsWith('.go')) {
    return 'go';
  }
  if (p.endsWith('.rs')) {
    return 'rust';
  }
  if (p.endsWith('.java')) {
    return 'java';
  }
  return undefined;
}

export function isCodeFile(filePath: string): boolean {
  return Boolean(languageFromPath(filePath));
}

export function isDocFile(filePath: string): boolean {
  const p = filePath.toLowerCase();
  if (p.endsWith('.md') || p.endsWith('.mdx') || p.endsWith('.rst')) {
    return true;
  }
  return /(?:^|\/)(readme|architecture|adr|requirements)[^/]*$/i.test(p);
}

export const IGNORE_DIR_RE =
  /(?:^|\/)(node_modules|\.git|\.singularity|dist|out|build|\.next|coverage|\.venv|venv|__pycache__|\.cursor)(?:\/|$)/;

export function shouldIgnorePath(filePath: string): boolean {
  return IGNORE_DIR_RE.test(filePath.replaceAll('\\', '/'));
}

export function fileIdFromUri(uri: string): string {
  return `file:${uri}`;
}

export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice('file://'.length));
  }
  return uri;
}
