/**
 * Semantic memory facade over durable graph entities + embeddings.
 */

import type { BrainStore } from './store.js';
import { normLabel } from './store.js';
import type { SemanticMemory } from './types.js';
import { clusterForType } from './types.js';

const SEMANTIC_TYPES = new Set([
  'fact', 'concept', 'constraint', 'requirement', 'assumption', 'topic',
  'decision', 'learning', 'lesson', 'observation', 'preference',
]);

export function entityToSemantic(e: {
  id: string;
  type: string;
  label: string;
  description?: string;
  importance: number;
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  sourceType: string;
  projectId?: string;
}): SemanticMemory {
  return {
    id: e.id,
    type: e.type,
    content: e.description?.trim() ? `${e.label}: ${e.description}` : e.label,
    importance: e.importance,
    confidence: e.confidence,
    createdAt: e.firstSeenAt,
    updatedAt: e.lastSeenAt,
    source: e.sourceType,
    projectId: e.projectId,
    label: e.label,
  };
}

export class SemanticMemoryApi {
  constructor(private store: BrainStore) {}

  write(input: {
    type?: string;
    label: string;
    content: string;
    confidence?: number;
    importance?: number;
    source?: string;
    projectId?: string;
  }): SemanticMemory {
    const type = input.type ?? 'fact';
    const ent = this.store.upsertEntity({
      type,
      label: input.label,
      description: input.content,
      confidence: input.confidence ?? 0.7,
      importance: input.importance ?? 0.55,
      sourceType: input.source ?? 'brain.semantic',
      projectId: input.projectId,
      authority: type === 'fact' ? 'fact' : 'observation',
      cluster: clusterForType(type),
    });
    return entityToSemantic(ent);
  }

  update(id: string, patch: { content?: string; confidence?: number; importance?: number }): SemanticMemory | undefined {
    const ent = this.store.getEntity(id);
    if (!ent) {
      return undefined;
    }
    const next = this.store.upsertEntity({
      type: ent.type,
      label: ent.label,
      description: patch.content ?? ent.description,
      confidence: patch.confidence ?? ent.confidence,
      importance: patch.importance ?? ent.importance,
      sourceType: ent.sourceType,
      sourceRef: ent.sourceRef,
      projectId: ent.projectId,
      authority: ent.authority,
      cluster: ent.cluster,
    });
    return entityToSemantic(next);
  }

  read(id: string): SemanticMemory | undefined {
    const e = this.store.getEntity(id);
    return e ? entityToSemantic(e) : undefined;
  }

  search(query: string, limit = 12): SemanticMemory[] {
    const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const pool = this.store.topEntities(800).filter((e) => SEMANTIC_TYPES.has(e.type) || e.cluster === 'memory' || e.cluster === 'decisions');
    const scored = pool.map((e) => {
      const hay = `${e.label} ${e.description ?? ''}`.toLowerCase();
      let hit = 0;
      for (const t of tokens) {
        if (hay.includes(t)) {
          hit += 1;
        }
      }
      if (normLabel(e.label) === normLabel(query)) {
        hit += 3;
      }
      return { e, hit };
    }).filter((x) => x.hit > 0 || !tokens.length);
    return scored
      .sort((a, b) => b.hit - a.hit || b.e.importance - a.e.importance)
      .slice(0, limit)
      .map((x) => entityToSemantic(x.e));
  }
}
