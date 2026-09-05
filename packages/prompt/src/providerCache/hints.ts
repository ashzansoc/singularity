/**
 * Level 7 — Provider Prompt Cache hints
 * Final optimization only — never depend on provider caching for correctness.
 */

import type { PromptIR } from '../ir/types.js';
import type { ProviderKind } from '../adapters/types.js';
import { sha256 } from '../hash.js';

export interface ProviderCacheHints {
	cacheControl?: { type: 'ephemeral' };
	promptCacheKey?: string;
	prefixHash?: string;
	/** Blocks marked as stable prefixes (system / repository). */
	breakpointBlockIds: string[];
}

/**
 * Derive optional provider cache annotations from IR.
 * Safe to ignore — adapters work without provider-side caching.
 */
export function buildProviderCacheHints(ir: PromptIR, provider: ProviderKind): ProviderCacheHints {
	const breakpointBlocks = ir.blocks.filter((b) => b.cacheBreakpoint);
	const prefixText = breakpointBlocks.map((b) => b.text).join('\n\n');
	const prefixHash = prefixText ? sha256(prefixText) : undefined;

	const hints: ProviderCacheHints = {
		breakpointBlockIds: breakpointBlocks.map((b) => b.id),
		...(prefixHash ? { prefixHash } : {}),
	};

	if (!prefixHash) {
		return hints;
	}

	switch (provider) {
		case 'anthropic':
		case 'claude':
			return {
				...hints,
				cacheControl: { type: 'ephemeral' },
				promptCacheKey: `singularity:${ir.sessionId}:${prefixHash}`,
			};
		case 'openai':
		case 'gpt':
		case 'azure':
			return {
				...hints,
				promptCacheKey: `singularity:${ir.sessionId}:${prefixHash}`,
			};
		case 'gemini':
		case 'google':
			return {
				...hints,
				promptCacheKey: `singularity:${ir.sessionId}:${prefixHash}`,
			};
		default:
			return hints;
	}
}
