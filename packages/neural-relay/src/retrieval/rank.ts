import { estimateTokens, tokenize } from '../hash.js';
import type { ContextCandidate, IndexedFile, RepoIndexPort } from '../types.js';
import type { DeterministicHits } from './deterministic.js';

export interface RankOptions {
  task: string;
  limit?: number;
  excerptChars?: number;
}

/**
 * Stage 3 — merge deterministic + semantic hits and cap at top N (default 50).
 */
export function rankCandidates(
  index: RepoIndexPort,
  det: DeterministicHits,
  semantic: IndexedFile[],
  options: RankOptions,
): ContextCandidate[] {
  const limit = options.limit ?? 50;
  const excerptChars = options.excerptChars ?? 400;
  const scores = new Map<
    string,
    { file: IndexedFile; score: number; reasons: string[] }
  >();

  const bump = (file: IndexedFile, amount: number, reason: string) => {
    const cur = scores.get(file.path);
    if (cur) {
      cur.score += amount;
      if (!cur.reasons.includes(reason)) {
        cur.reasons.push(reason);
      }
      return;
    }
    scores.set(file.path, { file, score: amount, reasons: [reason] });
  };

  for (const f of det.filename) {
    bump(f, 3, 'filename');
  }
  for (const f of det.symbol) {
    bump(f, 2.5, 'symbol');
  }
  for (const f of det.keyword) {
    bump(f, 1.5, 'keyword');
  }
  for (const f of det.dependency) {
    bump(f, 1.2, 'dependency');
  }
  for (const f of det.tests) {
    bump(f, 1.1, 'test');
  }
  semantic.forEach((f, i) => {
    bump(f, Math.max(0.2, 1.4 - i * 0.02), 'semantic');
  });

  const qTokens = new Set(tokenize(options.task));
  const ranked = [...scores.values()].sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map(({ file, score, reasons }) => {
    const body = index.readFile(file.path) ?? '';
    const excerpt = body.slice(0, excerptChars);
    const extra = tokenize(`${file.path} ${file.summary}`).filter((t) =>
      qTokens.has(t),
    ).length;
    return {
      path: file.path,
      language: file.language,
      size: file.size,
      summary: file.summary,
      symbols: file.symbols,
      imports: file.imports,
      importedBy: file.importedBy,
      tests: file.tests,
      excerpt,
      score: score + extra * 0.1,
      reasons,
    };
  });
}

export function candidateMetadataTokens(cands: ContextCandidate[]): number {
  return estimateTokens(
    cands
      .map(
        (c) =>
          `${c.path} ${c.summary} ${c.symbols.join(',')} ${c.excerpt}`,
      )
      .join('\n'),
  );
}
