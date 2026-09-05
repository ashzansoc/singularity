/**
 * Feature 8–9 — Prompt fingerprints + context snapshots
 */

import { cosineSimilarity } from '../embed/hashEmbedder.js';
import { sha256, sha256Object } from '../hash.js';
import type { IntelligenceEmbedder } from '../interfaces/v3.js';
import type { PromptFingerprint } from '../ir/types.js';
import type { PromptIR } from '../ir/types.js';
import type { PromptSnapshot, SnapshotStore } from '../interfaces/v3.js';
import { IR_VERSION } from '../graph/types.js';

export async function buildPromptFingerprint(input: {
	ir: PromptIR;
	embedder: IntelligenceEmbedder;
	repositoryVersion: string;
	conversationVersion: string;
	memoryVersion: string;
	dependencyVersion: string;
}): Promise<PromptFingerprint> {
	const blockDigests = input.ir.blocks.map((b) => ({
		role: b.role,
		hash: b.hash,
		deps: b.dependencies,
	}));
	const sha = sha256Object({
		blocks: blockDigests,
		intent: input.ir.intent,
		v: IR_VERSION,
	});
	// Similarity hash: coarse buckets (roles + token bands + intent)
	const similarityHash = sha256(
		[
			input.ir.intent,
			...input.ir.blocks.map(
				(b) => `${b.role}:${Math.round(b.estimatedTokens / 64)}`,
			),
			input.repositoryVersion.slice(0, 8),
		].join('|'),
	);
	const embText = input.ir.blocks
		.map((b) => b.text)
		.join('\n')
		.slice(0, 12_000);
	const embedding = await Promise.resolve(input.embedder.embed(embText));

	const blockFingerprints = input.ir.blocks.map((b) => ({
		blockId: b.id,
		role: b.role,
		contentSha256: b.hash,
		tokenCount: b.tokenCount || b.estimatedTokens,
		cacheBreakpoint: b.cacheBreakpoint,
	}));

	return {
		sha256: sha,
		similarityHash,
		embedding,
		repositoryVersion: input.repositoryVersion,
		conversationVersion: input.conversationVersion,
		memoryVersion: input.memoryVersion,
		dependencyVersion: input.dependencyVersion,
		intent: input.ir.intent,
		irVersion: IR_VERSION,
		blockFingerprints,
	};
}

export class InMemorySnapshotStore implements SnapshotStore {
	private readonly byId = new Map<string, PromptSnapshot>();
	private readonly max: number;

	constructor(max = 256) {
		this.max = max;
	}

	store(snapshot: PromptSnapshot): void {
		this.byId.set(snapshot.id, snapshot);
		while (this.byId.size > this.max) {
			const oldest = [...this.byId.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
			if (oldest) {
				this.byId.delete(oldest.id);
			} else {
				break;
			}
		}
	}

	findSimilar(embedding: number[], threshold = 0.92): PromptSnapshot | undefined {
		let best: PromptSnapshot | undefined;
		let bestScore = threshold;
		for (const s of this.byId.values()) {
			const sim = cosineSimilarity(embedding, s.embedding);
			if (sim >= bestScore) {
				bestScore = sim;
				best = s;
			}
		}
		if (best) {
			best.hits++;
			this.byId.set(best.id, best);
		}
		return best;
	}

	get(id: string): PromptSnapshot | undefined {
		return this.byId.get(id);
	}

	size(): number {
		return this.byId.size;
	}
}

export function snapshotIdFromFingerprint(fp: PromptFingerprint): string {
	return `snap:${fp.similarityHash.slice(0, 24)}`;
}
