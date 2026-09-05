/**
 * Level 12 — Delta Engine with file/symbol dirty tracking (Context Diff).
 */

import type { DeltaEngine, DeltaResult } from '../interfaces/index.js';
import type { PromptIR } from '../ir/types.js';
import { sha256Object } from '../hash.js';

export interface ContextDiffMeta {
	unchanged: string[];
	changed: string[];
	addedDeps: string[];
	reusedBlockIds: string[];
	rebuiltBlockIds: string[];
	freshTokens: number;
	reusedTokens: number;
}

export class DefaultDeltaEngine implements DeltaEngine {
	apply(prior: PromptIR | undefined, next: PromptIR): DeltaResult {
		if (!prior) {
			const diff: ContextDiffMeta = {
				unchanged: [],
				changed: next.blocks.map((b) => b.id),
				addedDeps: [],
				reusedBlockIds: [],
				rebuiltBlockIds: next.blocks.map((b) => b.id),
				freshTokens: next.totalTokens,
				reusedTokens: 0,
			};
			const ir: PromptIR = {
				...next,
				metadata: {
					...next.metadata,
					contextDiff: {
						unchanged: diff.unchanged,
						changed: diff.changed,
						addedDeps: diff.addedDeps,
						reusedBlockIds: diff.reusedBlockIds,
						rebuiltBlockIds: diff.rebuiltBlockIds,
					},
				},
			};
			return {
				ir,
				reusedBlockIds: [],
				rebuiltBlockIds: next.blocks.map((b) => b.id),
			};
		}

		const priorByKey = new Map(prior.blocks.map((b) => [b.role + ':' + b.hash, b]));
		const priorById = new Map(prior.blocks.map((b) => [b.id, b]));
		const reusedBlockIds: string[] = [];
		const rebuiltBlockIds: string[] = [];
		const unchanged: string[] = [];
		const changed: string[] = [];
		let freshTokens = 0;
		let reusedTokens = 0;

		const blocks = next.blocks.map((b) => {
			const key = b.role + ':' + b.hash;
			const prev = priorByKey.get(key) ?? (priorById.get(b.id)?.hash === b.hash ? priorById.get(b.id) : undefined);
			if (prev) {
				reusedBlockIds.push(b.id);
				unchanged.push(b.id);
				reusedTokens += b.tokenCount || b.estimatedTokens;
				return { ...prev, id: b.id };
			}
			rebuiltBlockIds.push(b.id);
			changed.push(b.id);
			freshTokens += b.tokenCount || b.estimatedTokens;
			return b;
		});

		const priorDeps = new Set(prior.blocks.flatMap((b) => b.dependencies));
		const addedDeps = [
			...new Set(next.blocks.flatMap((b) => b.dependencies).filter((d) => !priorDeps.has(d))),
		].slice(0, 32);

		const ir: PromptIR = {
			...next,
			blocks,
			irHash: sha256Object({
				sessionId: next.sessionId,
				intent: next.intent,
				blocks: blocks.map((b) => b.hash),
				budget: next.budgetTokens,
				v: next.compilerVersion,
			}),
			metadata: {
				...next.metadata,
				contextDiff: {
					unchanged,
					changed,
					addedDeps,
					reusedBlockIds,
					rebuiltBlockIds,
				},
			},
		};

		void freshTokens;
		void reusedTokens;

		return { ir, reusedBlockIds, rebuiltBlockIds };
	}
}
