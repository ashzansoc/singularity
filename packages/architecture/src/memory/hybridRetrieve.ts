import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { Adr } from '../domain/adr/schema.js';
import type { DecisionStore } from './decisionStore.js';
import { HashArchitectureEmbedder, searchEmbeddings } from './vectorStore.js';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.+#-]+/)
      .filter((t) => t.length > 2),
  );
}

function keywordScore(query: string, adr: Adr): number {
  const q = tokenize(query);
  const blob = [
    adr.title,
    adr.decision.summary,
    adr.problem,
    ...adr.affected_components,
    ...adr.constraints,
  ]
    .join(' ')
    .toLowerCase();
  let hit = 0;
  for (const t of q) {
    if (blob.includes(t)) {
      hit += 1;
    }
  }
  return q.size ? hit / q.size : 0;
}

export interface HybridHit {
  adr: Adr;
  score: number;
}

/**
 * Explicit / "why" search — not for the coding token loop.
 */
export async function hybridSearch(
  store: DecisionStore,
  projectId: string,
  query: string,
  opts?: { limit?: number; historical?: boolean },
): Promise<HybridHit[]> {
  const limit = opts?.limit ?? 8;
  const embedder = new HashArchitectureEmbedder();
  const qEmb = embedder.embed(query);
  const vectorHits = await searchEmbeddings(store, projectId, qEmb, 16);
  const vecMap = new Map(vectorHits.map((v) => [v.adr_id, v.score]));
  const adrs = store.list({ project_id: projectId });
  const scored: HybridHit[] = [];
  for (const adr of adrs) {
    if (adr.record_kind === 'observation') {
      continue;
    }
    if (!opts?.historical && !isActiveStatus(adr.status)) {
      continue;
    }
    const kw = keywordScore(query, adr);
    const vec = vecMap.get(adr.id) ?? 0;
    const entity = adr.affected_components.some((c) =>
      query.toLowerCase().includes(c.toLowerCase()),
    )
      ? 0.25
      : 0;
    const recency = Math.min(
      0.15,
      0.15 *
        Math.exp(
          -(Date.now() - Date.parse(adr.timestamps.updated_at || adr.timestamps.created_at)) /
            86_400_000 /
            30,
        ),
    );
    const statusBoost = isActiveStatus(adr.status) ? 0.35 : 0.05;
    const conf = adr.confidence * 0.15;
    const score = kw * 0.35 + vec * 0.3 + entity + recency + statusBoost + conf;
    scored.push({ adr, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
