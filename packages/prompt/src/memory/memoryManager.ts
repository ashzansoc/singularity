/**
 * Level 3 — Memory Graph
 */

import { estimateTokens, sha256, sha256Object } from '../hash.js';
import { cosineSimilarity } from '../embed/hashEmbedder.js';
import type { MemoryManager } from '../interfaces/index.js';
import type { MemoryNode, MemoryScope } from '../graph/types.js';

export class InMemoryMemoryManager implements MemoryManager {
	private readonly memories = new Map<string, MemoryNode>();

	upsert(
		memory: Omit<MemoryNode, 'kind' | 'hash' | 'version' | 'tokenCount' | 'dependencies' | 'lastModified'> &
			Partial<MemoryNode>,
	): MemoryNode {
		const content = memory.content ?? memory.label;
		const prev = this.memories.get(memory.id);
		const node: MemoryNode = {
			id: memory.id,
			kind: 'memory',
			label: memory.label,
			content,
			scope: memory.scope,
			priority: memory.priority ?? 5,
			importance: memory.importance ?? 0.5,
			embedding: memory.embedding,
			hash: memory.hash ?? sha256(content),
			version: (prev?.version ?? 0) + 1,
			tokenCount: estimateTokens(content),
			dependencies: memory.dependencies ?? [],
			lastModified: Date.now(),
			lastUsed: memory.lastUsed ?? Date.now(),
			ttl: memory.ttl,
			tags: memory.tags ?? [],
			meta: memory.meta,
		};
		this.memories.set(node.id, node);
		return node;
	}

	remove(id: string): void {
		this.memories.delete(id);
	}

	get(id: string): MemoryNode | undefined {
		return this.memories.get(id);
	}

	list(scope?: MemoryScope): MemoryNode[] {
		const now = Date.now();
		const all = [...this.memories.values()].filter((m) => {
			if (m.ttl && now - m.lastModified > m.ttl) {
				this.memories.delete(m.id);
				return false;
			}
			return scope ? m.scope === scope : true;
		});
		return all;
	}

	touch(id: string): void {
		const m = this.memories.get(id);
		if (m) {
			m.lastUsed = Date.now();
			this.memories.set(id, m);
		}
	}

	semanticSearch(queryEmbedding: number[], topK: number, scope?: MemoryScope): MemoryNode[] {
		const scored = this.list(scope)
			.map((m) => {
				const sim = m.embedding ? cosineSimilarity(queryEmbedding, m.embedding) : 0;
				const score = sim * 0.7 + m.importance * 0.2 + (1 / (1 + m.priority)) * 0.1;
				return { m, score };
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);
		for (const s of scored) {
			this.touch(s.m.id);
		}
		return scored.map((s) => s.m);
	}

	memoryHash(): string {
		const rows = this.list()
			.map((m) => ({ id: m.id, hash: m.hash }))
			.sort((a, b) => a.id.localeCompare(b.id));
		return sha256Object(rows);
	}
}
