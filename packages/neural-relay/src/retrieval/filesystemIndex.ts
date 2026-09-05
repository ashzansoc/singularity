import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  estimateTokens,
  isCodeOrConfigPath,
  languageFromPath,
  shouldIgnorePath,
} from '../hash.js';
import type { IndexedFile, RepoIndexPort } from '../types.js';

function walkFiles(root: string, maxFiles = 2_000): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      const rel = relative(root, abs).replace(/\\/g, '/');
      if (shouldIgnorePath(rel)) {
        continue;
      }
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(abs);
      } else if (st.isFile() && isCodeOrConfigPath(rel)) {
        out.push(rel);
      }
    }
  }
  return out;
}

function extractSymbols(text: string): string[] {
  const names = new Set<string>();
  const re =
    /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) {
      names.add(m[1]);
    }
  }
  return [...names].slice(0, 40);
}

function extractImports(text: string): string[] {
  const specs = new Set<string>();
  const re =
    /(?:from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const spec = m[1] || m[2] || m[3];
    if (spec) {
      specs.add(spec);
    }
  }
  return [...specs].slice(0, 40);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)(\/|$)|(\.|\/)(test|spec)\.(tsx?|jsx?)$/i.test(
    path,
  );
}

/**
 * Smallest practical POC index: walk the workspace and extract symbols/imports
 * with regex. Prefer IntelligenceEngine when the host already has a graph.
 */
export class FilesystemRepoIndex implements RepoIndexPort {
  readonly workspaceRoot: string;
  private files: IndexedFile[] = [];
  private byPath = new Map<string, IndexedFile>();
  private contents = new Map<string, string>();

  constructor(workspaceRoot: string, maxFiles = 2_000, seedPaths?: string[]) {
    this.workspaceRoot = workspaceRoot;
    if (seedPaths?.length) {
      this.populateFromRelativePaths(seedPaths.slice(0, maxFiles));
    } else {
      this.rebuild(maxFiles);
    }
  }

  /** Build an index from paths whose contents were read via the VS Code workspace API. */
  static fromPreloadedContents(
    workspaceRoot: string,
    contentsByPath: Map<string, string>,
  ): FilesystemRepoIndex {
    const idx = new FilesystemRepoIndex(workspaceRoot, 0);
    idx.populateFromContents(contentsByPath);
    return idx;
  }

  rebuild(maxFiles = 2_000): void {
    const rels = existsSync(this.workspaceRoot)
      ? walkFiles(this.workspaceRoot, maxFiles)
      : [];
    this.populateFromRelativePaths(rels);
  }

  private populateFromContents(contentsByPath: Map<string, string>): void {
    this.files = [];
    this.byPath.clear();
    this.contents.clear();
    for (const [rel, text] of contentsByPath) {
      if (!isCodeOrConfigPath(rel) || shouldIgnorePath(rel)) {
        continue;
      }
      const body = text.slice(0, 80_000);
      const indexed: IndexedFile = {
        path: rel,
        language: languageFromPath(rel),
        size: body.length,
        summary: body
          .split('\n')
          .filter((l) => l.trim() && !l.trim().startsWith('import '))
          .slice(0, 4)
          .join(' ')
          .slice(0, 240),
        symbols: extractSymbols(body),
        imports: extractImports(body),
        importedBy: [],
        tests: [],
      };
      this.contents.set(rel, body);
      this.files.push(indexed);
      this.byPath.set(rel, indexed);
    }
    this.linkImportsAndTests();
  }

  private populateFromRelativePaths(rels: string[]): void {
    this.files = [];
    this.byPath.clear();
    this.contents.clear();

    for (const rel of rels) {
      const abs = join(this.workspaceRoot, rel);
      let text = '';
      let size = 0;
      try {
        const buf = readFileSync(abs);
        size = buf.length;
        text = buf.toString('utf8').slice(0, 80_000);
      } catch {
        continue;
      }
      this.contents.set(rel, text);
      const indexed: IndexedFile = {
        path: rel,
        language: languageFromPath(rel),
        size,
        summary: text
          .split('\n')
          .filter((l) => l.trim() && !l.trim().startsWith('import '))
          .slice(0, 4)
          .join(' ')
          .slice(0, 240),
        symbols: extractSymbols(text),
        imports: extractImports(text),
        importedBy: [],
        tests: [],
      };
      this.files.push(indexed);
      this.byPath.set(rel, indexed);
    }

    this.linkImportsAndTests();
  }

  private linkImportsAndTests(): void {
    for (const file of this.files) {
      for (const spec of file.imports) {
        const resolved = resolveImport(file.path, spec, this.byPath);
        if (resolved) {
          resolved.importedBy.push(file.path);
        }
      }
    }

    for (const file of this.files) {
      if (isTestPath(file.path)) {
        continue;
      }
      const base = file.path.replace(/\.(tsx?|jsx?)$/, '');
      const name = base.split('/').pop() ?? '';
      file.tests = this.files
        .filter(
          (f) =>
            isTestPath(f.path) &&
            (f.path.includes(name) ||
              f.imports.some((i) => i.includes(name)) ||
              f.symbols.some((s) => file.symbols.includes(s))),
        )
        .map((f) => f.path)
        .slice(0, 8);
    }
  }

  listFileMetadata(): IndexedFile[] {
    return this.files;
  }

  searchFilename(query: string): IndexedFile[] {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((t) => t.length > 2);
    if (!tokens.length) {
      return [];
    }
    return this.files.filter((f) =>
      tokens.some((t) => f.path.toLowerCase().includes(t)),
    );
  }

  searchSymbol(query: string): IndexedFile[] {
    const tokens = query.toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean);
    return this.files.filter((f) =>
      f.symbols.some((s) =>
        tokens.some((t) => s.toLowerCase().includes(t) && t.length > 2),
      ),
    );
  }

  searchKeyword(query: string): IndexedFile[] {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((t) => t.length > 2);
    if (!tokens.length) {
      return [];
    }
    return this.files.filter((f) => {
      const hay = `${f.path} ${f.summary} ${f.symbols.join(' ')}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
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
    const imports = f.imports
      .map((spec) => resolveImport(path, spec, this.byPath)?.path)
      .filter((p): p is string => Boolean(p));
    return {
      imports,
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

function resolveImport(
  fromPath: string,
  spec: string,
  byPath: Map<string, IndexedFile>,
): IndexedFile | undefined {
  if (!spec.startsWith('.')) {
    return undefined;
  }
  const fromDir = fromPath.includes('/')
    ? fromPath.slice(0, fromPath.lastIndexOf('/'))
    : '';
  const joined = normalizeRel(`${fromDir}/${spec}`);
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
  ];
  for (const c of candidates) {
    const hit = byPath.get(c);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function normalizeRel(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') {
      continue;
    }
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}
