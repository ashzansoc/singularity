import { join, posix, relative, sep } from 'node:path';
import type { WikiPageCategory } from './types.js';

export interface WikiPaths {
  root: string;
  schema: string;
  meta: string;
  raw: string;
  rawAssets: string;
  pages: string;
  index: string;
  log: string;
  overview: string;
  synthesis: string;
  contradictions: string;
  sources: string;
  entities: string;
  concepts: string;
  queries: string;
}

export function wikiPaths(workspaceRoot: string, wikiRootRel: string): WikiPaths {
  const root = join(workspaceRoot, ...wikiRootRel.split(/[\\/]/).filter(Boolean));
  const pages = join(root, 'wiki');
  return {
    root,
    schema: join(root, 'SCHEMA.md'),
    meta: join(root, 'meta.json'),
    raw: join(root, 'raw'),
    rawAssets: join(root, 'raw', 'assets'),
    pages,
    index: join(pages, 'index.md'),
    log: join(pages, 'log.md'),
    overview: join(pages, 'overview.md'),
    synthesis: join(pages, 'synthesis.md'),
    contradictions: join(pages, 'contradictions.md'),
    sources: join(pages, 'sources'),
    entities: join(pages, 'entities'),
    concepts: join(pages, 'concepts'),
    queries: join(pages, 'queries'),
  };
}

export function relToWorkspace(workspaceRoot: string, absPath: string): string {
  return toPosix(relative(workspaceRoot, absPath));
}

export function relToPages(pagesDir: string, absPath: string): string {
  return toPosix(relative(pagesDir, absPath));
}

export function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

export function categoryDir(category: WikiPageCategory): string {
  switch (category) {
    case 'source':
      return 'sources';
    case 'entity':
      return 'entities';
    case 'concept':
      return 'concepts';
    case 'query':
      return 'queries';
    case 'overview':
    case 'synthesis':
    case 'contradiction':
    case 'other':
    default:
      return '';
  }
}

export function pageRelPath(
  category: WikiPageCategory,
  slug: string,
): string {
  const dir = categoryDir(category);
  const file = `${slug}.md`;
  return dir ? `${dir}/${file}` : file;
}
