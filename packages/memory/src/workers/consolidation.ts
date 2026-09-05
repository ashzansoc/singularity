import type { MemoryRecord } from '../domain/memory.js';
import { nowIso, newMemoryId } from '../domain/memory.js';
import type { MemoryIntelligenceProvider } from '../providers/mem0/provider.js';
import type { MemoryRepository } from '../storage/repository.js';
import { tokenize, jaccard } from '../retrieval/ranker.js';

export async function consolidateProjectMemories(
  repo: MemoryRepository,
  projectId: string,
  intelligence: MemoryIntelligenceProvider,
): Promise<MemoryRecord | undefined> {
  const facts = (await repo.list({ project_id: projectId, status: 'ACTIVE' })).filter(
    (m) => m.type === 'FACT' || m.type === 'TECHNOLOGY_CHOICE',
  );
  if (facts.length < 3) {
    return undefined;
  }
  const groups: MemoryRecord[][] = [];
  for (const f of facts) {
    const g = groups.find((gg) => jaccard(tokenize(gg[0]!.content), tokenize(f.content)) > 0.35);
    if (g) {
      g.push(f);
    } else {
      groups.push([f]);
    }
  }
  const cluster = groups.sort((a, b) => b.length - a.length)[0];
  if (!cluster || cluster.length < 3) {
    return undefined;
  }
  const summary = await intelligence.consolidate(cluster.map((m) => m.content));
  if (!summary) {
    return undefined;
  }
  const ts = nowIso();
  const canonical: MemoryRecord = {
    id: newMemoryId(),
    project_id: projectId,
    type: 'FACT',
    scope: 'PROJECT',
    title: summary.slice(0, 120),
    content: summary,
    reason: `Consolidated from ${cluster.length} memories`,
    status: 'ACTIVE',
    importance: Math.max(...cluster.map((m) => m.importance)),
    confidence: Math.max(...cluster.map((m) => m.confidence)),
    source_type: 'SYSTEM',
    source_id: cluster.map((m) => m.id).join(','),
    entities: [...new Set(cluster.flatMap((m) => m.entities))],
    embedding_pending: true,
    created_at: ts,
    updated_at: ts,
  };
  await repo.insert(canonical);
  return canonical;
}
