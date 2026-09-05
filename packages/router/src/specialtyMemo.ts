import { createHash } from 'node:crypto';
import type { SpecialtyClassification } from './specialtyClassifier.js';

/**
 * Session-scoped memo for Nemotron specialty classifications.
 *
 * Within one planner→worker→verifier burst the same (or near-same) prompt hits
 * `routeAsync` repeatedly; re-classifying each time costs up to a 2.5s network
 * hop per completion. Entries live 60s and are keyed by a normalized prompt
 * bucket so trivial rewording still hits.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 64;

interface Entry extends SpecialtyClassification {
  storedAt: number;
}

const memo = new Map<string, Entry>();

export function specialtyMemoKey(prompt: string): string {
  const normalized = prompt
    .slice(0, 400)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function getSpecialtyMemo(key: string): SpecialtyClassification | undefined {
  const hit = memo.get(key);
  if (!hit) {
    return undefined;
  }
  if (Date.now() - hit.storedAt > TTL_MS) {
    memo.delete(key);
    return undefined;
  }
  return { ...hit };
}

export function setSpecialtyMemo(
  key: string,
  classification: SpecialtyClassification,
): void {
  if (classification.source !== 'llm') {
    return;
  }
  memo.set(key, { ...classification, storedAt: Date.now() });
  while (memo.size > MAX_ENTRIES) {
    const oldest = [...memo.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (!oldest) {
      break;
    }
    memo.delete(oldest[0]);
  }
}

/** Legacy behavior restore path: clear all memoized classifications. */
export function clearSpecialtyMemo(): void {
  memo.clear();
}
