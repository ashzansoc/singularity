/**
 * Wrap an existing IntelligenceEngine (Tree-sitter graph + retrieveContext)
 * as the Neural Relay repo index. Duck-typed so this package does not import
 * `@singularity/intelligence` (host already has the engine).
 */

import { estimateTokens, languageFromPath, shouldIgnorePath } from '../hash.js';
import type { IndexedFile, RepoIndexPort } from '../types.js';

export interface IntelligenceContextItem {
  label?: string;
  text?: string;
  uri?: string;
  score?: number;
}

export interface IntelligenceSymbolHit {
  name?: string;
  uri?: string;
}

export interface IntelligenceGraphNode {
  kind?: string;
  label?: string;
  content?: string;
  tokenCount?: number;
  meta?: Record<string, unknown>;
  dependencies?: string[];
}

export interface IntelligenceEngineLike {
  workspaceRoot: string;
  getContext(
    query: string,
    opts?: { limit?: number; depth?: number },
  ): { context?: IntelligenceContextItem[]; sources?: string[] };
  search(query: string, limit?: number): IntelligenceSymbolHit[];
  store: {
    listNodes(kind?: string): IntelligenceGraphNode[];
  };
}

function uriToRel(uri: string | undefined, root: string): string | undefined {
  if (!uri) {
    return undefined;
  }
  let path = uri;
  if (path.startsWith('file://')) {
    path = decodeURIComponent(path.slice('file://'.length));
  }
  const normRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const normPath = path.replace(/\\/g, '/');
  if (normPath === normRoot) {
    return '';
  }
  if (normPath.startsWith(`${normRoot}/`)) {
    return normPath.slice(normRoot.length + 1);
  }
  return normPath.replace(/^\//, '');
}

function nodeToIndexed(
  node: IntelligenceGraphNode,
  root: string,
): IndexedFile | undefined {
  const uri = String(node.meta?.uri ?? '');
  const rel =
    uriToRel(uri, root) ||
    (node.label && !node.label.includes('://') ? node.label : undefined);
  if (!rel) {
    return undefined;
  }
  const path = rel.replace(/\\/g, '/');
  if (shouldIgnorePath(path)) {
    return undefined;
  }
  const body = node.content ?? '';
  return {
    path,
    language: languageFromPath(rel),
    size: body.length,
    summary: body
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('import '))
      .slice(0, 4)
      .join(' ')
      .slice(0, 240),
    symbols: [],
    imports: [],
    importedBy: [],
    tests: [],
  };
}

/**
 * RepoIndexPort backed by IntelligenceEngine's graph + retrieveContext.
 */
export class IntelligenceRepoIndex implements RepoIndexPort {
  readonly workspaceRoot: string;
  private readonly engine: IntelligenceEngineLike;
  private files: IndexedFile[] = [];
  private byPath = new Map<string, IndexedFile>();
  private contents = new Map<string, string>();

  constructor(engine: IntelligenceEngineLike) {
    this.engine = engine;
    this.workspaceRoot = engine.workspaceRoot;
    this.rebuildFromStore();
  }

  private rebuildFromStore(): void {
    this.files = [];
    this.byPath.clear();
    this.contents.clear();
    for (const node of this.engine.store.listNodes('file')) {
      const indexed = nodeToIndexed(node, this.workspaceRoot);
      if (!indexed) {
        continue;
      }
      const body = node.content ?? '';
      this.contents.set(indexed.path, body);
      this.files.push(indexed);
      this.byPath.set(indexed.path, indexed);
    }
  }

  listFileMetadata(): IndexedFile[] {
    if (!this.files.length) {
      this.rebuildFromStore();
    }
    return this.files;
  }

  searchFilename(query: string): IndexedFile[] {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((t) => t.length > 2);
    return this.listFileMetadata().filter((f) =>
      tokens.some((t) => f.path.toLowerCase().includes(t)),
    );
  }

  searchSymbol(query: string): IndexedFile[] {
    const hits = this.engine.search(query, 32);
    const out: IndexedFile[] = [];
    const seen = new Set<string>();
    for (const h of hits) {
      const rel = uriToRel(h.uri, this.workspaceRoot);
      if (!rel || seen.has(rel)) {
        continue;
      }
      seen.add(rel);
      const file = this.byPath.get(rel);
      if (file) {
        out.push(file);
      }
    }
    return out;
  }

  searchKeyword(query: string): IndexedFile[] {
    return this.searchFilename(query);
  }

  semanticSearch(query: string, limit = 50): IndexedFile[] {
    const ctx = this.engine.getContext(query, { limit, depth: 2 });
    const out: IndexedFile[] = [];
    const seen = new Set<string>();
    for (const item of ctx.context ?? []) {
      const rel = uriToRel(item.uri, this.workspaceRoot);
      if (!rel || seen.has(rel)) {
        continue;
      }
      seen.add(rel);
      const file = this.byPath.get(rel);
      if (file) {
        out.push(file);
      }
    }
    return out.slice(0, limit);
  }

  neighborhood(path: string): {
    imports: string[];
    importedBy: string[];
    tests: string[];
  } {
    const f = this.byPath.get(path);
    if (!f) {
      return { imports: [], importedBy: [], tests: [] };
    }
    return {
      imports: [...f.imports],
      importedBy: [...f.importedBy],
      tests: [...f.tests],
    };
  }

  readFile(path: string): string | undefined {
    return this.contents.get(path);
  }

  estimateCorpusTokens(): number {
    let n = 0;
    for (const text of this.contents.values()) {
      n += estimateTokens(text);
    }
    return n;
  }
}
