/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$]+/g)
    .filter((t) => t.length > 1);
}

export function languageFromPath(filePath: string): string {
  const p = filePath.toLowerCase();
  if (p.endsWith('.tsx')) {
    return 'typescript';
  }
  if (p.endsWith('.ts')) {
    return 'typescript';
  }
  if (p.endsWith('.jsx') || p.endsWith('.js') || p.endsWith('.mjs')) {
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
  if (p.endsWith('.json')) {
    return 'json';
  }
  if (p.endsWith('.md')) {
    return 'markdown';
  }
  if (p.endsWith('.css') || p.endsWith('.scss')) {
    return 'css';
  }
  if (p.endsWith('.html') || p.endsWith('.htm')) {
    return 'html';
  }
  return 'text';
}

export function isCodeOrConfigPath(filePath: string): boolean {
  return /\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|json|ya?ml|toml|md|css|scss|sql|html?)$/i.test(
    filePath,
  );
}

export function shouldIgnorePath(rel: string): boolean {
  return /(^|\/)(node_modules|\.git|dist|build|\.singularity|coverage|\.next)(\/|$)/.test(
    rel,
  );
}
