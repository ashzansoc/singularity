import type { IndexedFile, RepoIndexPort } from '../types.js';

export interface RetrievalStageResult {
  files: IndexedFile[];
  reason: string;
}

export interface DeterministicHits {
  filename: IndexedFile[];
  symbol: IndexedFile[];
  keyword: IndexedFile[];
  dependency: IndexedFile[];
  tests: IndexedFile[];
  merged: IndexedFile[];
}

export function uniqueFiles(groups: RetrievalStageResult[]): IndexedFile[] {
  const seen = new Set<string>();
  const out: IndexedFile[] = [];
  for (const g of groups) {
    for (const f of g.files) {
      if (seen.has(f.path)) {
        continue;
      }
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

/**
 * Stage 1 — deterministic retrieval. Filename / symbol / keyword run concurrently,
 * then import neighborhood + test-file heuristics.
 */
export async function deterministicRetrieve(
  index: RepoIndexPort,
  task: string,
): Promise<DeterministicHits> {
  const [filename, symbol, keyword] = await Promise.all([
    Promise.resolve(index.searchFilename(task)),
    Promise.resolve(index.searchSymbol(task)),
    Promise.resolve(index.searchKeyword(task)),
  ]);

  const seed = uniqueFiles([
    { files: filename, reason: 'filename' },
    { files: symbol, reason: 'symbol' },
    { files: keyword, reason: 'keyword' },
  ]);

  const depFiles: IndexedFile[] = [];
  const testFiles: IndexedFile[] = [];
  const byPath = new Map(index.listFileMetadata().map((f) => [f.path, f]));
  for (const f of seed.slice(0, 24)) {
    const nb = index.neighborhood(f.path);
    for (const p of [...nb.imports, ...nb.importedBy]) {
      const hit = byPath.get(p);
      if (hit) {
        depFiles.push(hit);
      }
    }
    for (const p of nb.tests) {
      const hit = byPath.get(p);
      if (hit) {
        testFiles.push(hit);
      }
    }
  }

  return {
    filename,
    symbol,
    keyword,
    dependency: uniqueFiles([{ files: depFiles, reason: 'dep' }]),
    tests: uniqueFiles([{ files: testFiles, reason: 'test' }]),
    merged: uniqueFiles([
      { files: filename, reason: 'filename' },
      { files: symbol, reason: 'symbol' },
      { files: keyword, reason: 'keyword' },
      { files: depFiles, reason: 'dep' },
      { files: testFiles, reason: 'test' },
    ]),
  };
}
