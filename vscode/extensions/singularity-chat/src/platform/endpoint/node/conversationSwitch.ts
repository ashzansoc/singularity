/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pattern 1 mid-conversation switching + affinity + escalate-before-stream.
 * Mirrors packages/router conversationSwitch / contextSegments for the Singularity Auto path.
 */

export type ContextSegmentId =
	| 'system'
	| 'repository'
	| 'conversation'
	| 'retrieval'
	| 'currentPrompt';

export interface ContextSegment {
	id: ContextSegmentId;
	hash: string;
	version: number;
	tokenCount: number;
	dirty: boolean;
}

export interface SegmentedContextState {
	conversationId: string;
	segments: Record<ContextSegmentId, ContextSegment>;
	totalTokens: number;
	unchangedTokens: number;
	rebuiltTokens: number;
}

export interface ConversationTurnState {
	conversationId: string;
	turnCount: number;
	modelId: string;
	provider: string;
	tier: string;
	subTier: string;
	intent: string;
	confidence: number;
	estimatedContextTokens: number;
	lastPromptHash: string;
}

export interface TurnRouteCandidate {
	modelId: string;
	provider: string;
	tier: string;
	subTier: string;
	intent: string;
	confidence: number;
	contextTokens?: number;
}

export type SwitchAction = 'stay' | 'switch' | 'escalate';

export interface SwitchDecision {
	action: SwitchAction;
	modelId: string;
	provider: string;
	tier: string;
	subTier: string;
	intent: string;
	confidence: number;
	reason: string;
	preservesProviderCache: boolean;
	cacheReuseTokens: number;
}

const SEGMENT_IDS: ContextSegmentId[] = [
	'system',
	'repository',
	'conversation',
	'retrieval',
	'currentPrompt',
];

const LARGE_CONTEXT_TOKENS = 24_000;
/** Only accept a model pick when confidence is clearly up; otherwise escalate. */
export const MIN_ACCEPT_CONFIDENCE = 0.75;
const MIN_TIER_JUMP = 1;

const TIER_ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'] as const;

/** Default Auto policy: DeepSeek V4 Flash-0731 only (Pro is disabled). */
export const DEEPSEEK_FLASH_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';
export const DEEPSEEK_PRO_MODEL_ID = 'deepseek/deepseek-v4-pro-0813';
/** Vision-only exception — neither DeepSeek model accepts images. */
export const VISION_FALLBACK_MODEL_ID = 'google/gemini-2.5-flash';

/** Rewrite disabled DeepSeek Pro ids onto Flash-0731. */
export function remapDisabledDeepSeekPro(modelId: string): string {
	return /deepseek-v4-pro/i.test(modelId) ? DEEPSEEK_FLASH_MODEL_ID : modelId;
}

/** Architecture catalog preferences by tier (Flash-0731 only). */
export const FREE_TIER_SURROGATES: Record<string, readonly string[]> = {
	T0: [DEEPSEEK_FLASH_MODEL_ID, VISION_FALLBACK_MODEL_ID],
	T1: [DEEPSEEK_FLASH_MODEL_ID],
	T2: [DEEPSEEK_FLASH_MODEL_ID],
	T3: [DEEPSEEK_FLASH_MODEL_ID],
	T4: [DEEPSEEK_FLASH_MODEL_ID],
	T5: [DEEPSEEK_FLASH_MODEL_ID],
	T6: [DEEPSEEK_FLASH_MODEL_ID],
};

const INTENT_SURROGATE_BIAS: Record<string, readonly string[]> = {
	AUTOCOMPLETE: [DEEPSEEK_FLASH_MODEL_ID],
	UNKNOWN: [DEEPSEEK_FLASH_MODEL_ID],
	CODE: [DEEPSEEK_FLASH_MODEL_ID],
	INLINE_EDIT: [DEEPSEEK_FLASH_MODEL_ID],
	EXPLAIN: [DEEPSEEK_FLASH_MODEL_ID],
	DOCUMENTATION: [DEEPSEEK_FLASH_MODEL_ID],
	DEBUG: [DEEPSEEK_FLASH_MODEL_ID],
	REVIEW: [DEEPSEEK_FLASH_MODEL_ID],
	REFACTOR: [DEEPSEEK_FLASH_MODEL_ID],
	ARCHITECTURE: [DEEPSEEK_FLASH_MODEL_ID],
	AGENT: [DEEPSEEK_FLASH_MODEL_ID],
	TEST: [DEEPSEEK_FLASH_MODEL_ID],
};

/**
 * Auto may only need these live endpoints in the common case.
 */
export const AUTO_ROUTABLE_MODEL_IDS: readonly string[] = [
	DEEPSEEK_FLASH_MODEL_ID,
];

export function hashContent(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export function estimateTokens(text: string): number {
	if (!text) {
		return 0;
	}
	return Math.max(1, Math.ceil(text.length / 4));
}

export function providerOf(modelId: string): string {
	const slash = modelId.indexOf('/');
	return slash > 0 ? modelId.slice(0, slash).toLowerCase() : 'unknown';
}

export function parseTier(tier: string): (typeof TIER_ORDER)[number] {
	const m = tier.toUpperCase().match(/T([0-6])/);
	if (m) {
		return `T${m[1]}` as (typeof TIER_ORDER)[number];
	}
	return 'T1';
}

export function tierIndex(tier: string): number {
	return TIER_ORDER.indexOf(parseTier(tier));
}

function emptySegment(id: ContextSegmentId): ContextSegment {
	return { id, hash: '', version: 0, tokenCount: 0, dirty: true };
}

export function createSegmentedContext(conversationId: string): SegmentedContextState {
	const segments = Object.fromEntries(
		SEGMENT_IDS.map((id) => [id, emptySegment(id)]),
	) as Record<ContextSegmentId, ContextSegment>;
	return { conversationId, segments, totalTokens: 0, unchangedTokens: 0, rebuiltTokens: 0 };
}

export function updateContextSegments(
	prev: SegmentedContextState | undefined,
	conversationId: string,
	input: {
		system?: string;
		repository?: string;
		conversation?: string;
		retrieval?: string;
		currentPrompt: string;
		tokenEstimates?: Partial<Record<ContextSegmentId, number>>;
	},
): SegmentedContextState {
	const base = prev?.conversationId === conversationId ? prev : createSegmentedContext(conversationId);
	const values: Record<ContextSegmentId, string> = {
		system: input.system ?? '',
		repository: input.repository ?? '',
		conversation: input.conversation ?? '',
		retrieval: input.retrieval ?? '',
		currentPrompt: input.currentPrompt,
	};

	let unchangedTokens = 0;
	let rebuiltTokens = 0;
	let totalTokens = 0;
	const segments = { ...base.segments };

	for (const id of SEGMENT_IDS) {
		const content = values[id];
		const hash = hashContent(content);
		const tokens = input.tokenEstimates?.[id] ?? (content ? estimateTokens(content) : 0);
		const prevSeg = base.segments[id];
		const dirty = !prevSeg || prevSeg.hash !== hash;
		segments[id] = {
			id,
			hash,
			version: dirty ? (prevSeg?.version ?? 0) + 1 : prevSeg.version,
			tokenCount: tokens,
			dirty,
		};
		totalTokens += tokens;
		if (dirty) {
			rebuiltTokens += tokens;
		} else {
			unchangedTokens += tokens;
		}
	}

	return { conversationId, segments, totalTokens, unchangedTokens, rebuiltTokens };
}

export function escalateCandidateIfNeeded(
	candidate: TurnRouteCandidate,
	escalateModelId: (from: TurnRouteCandidate) => TurnRouteCandidate | undefined,
): { candidate: TurnRouteCandidate; escalated: boolean; reason?: string } {
	// User rule: only use the pick when confidence is up; otherwise don't.
	if (candidate.confidence >= MIN_ACCEPT_CONFIDENCE) {
		return { candidate, escalated: false };
	}
	const next = escalateModelId(candidate);
	if (!next || next.modelId === candidate.modelId) {
		return { candidate, escalated: false, reason: 'no-escalate-target' };
	}
	return {
		candidate: { ...next, confidence: Math.max(next.confidence, MIN_ACCEPT_CONFIDENCE) },
		escalated: true,
		reason: `low_confidence:${candidate.confidence.toFixed(2)}`,
	};
}

export function decideConversationSwitch(
	prev: ConversationTurnState | undefined,
	candidate: TurnRouteCandidate,
): SwitchDecision {
	const provider = candidate.provider || providerOf(candidate.modelId);
	const ctx = candidate.contextTokens ?? prev?.estimatedContextTokens ?? 0;

	if (!prev || prev.turnCount === 0) {
		return {
			action: 'switch',
			modelId: candidate.modelId,
			provider,
			tier: candidate.tier,
			subTier: candidate.subTier,
			intent: candidate.intent,
			confidence: candidate.confidence,
			reason: 'first-turn',
			preservesProviderCache: false,
			cacheReuseTokens: 0,
		};
	}

	if (prev.modelId === candidate.modelId) {
		return {
			action: 'stay',
			modelId: prev.modelId,
			provider: prev.provider,
			tier: prev.tier,
			subTier: prev.subTier,
			intent: candidate.intent,
			confidence: candidate.confidence,
			reason: 'same-model',
			preservesProviderCache: true,
			cacheReuseTokens: ctx,
		};
	}

	const delta = tierIndex(candidate.tier) - tierIndex(prev.tier);
	const sameProvider = prev.provider === provider;
	const intentChanged = prev.intent !== candidate.intent && candidate.intent !== 'UNKNOWN';
	const largeContext = ctx >= LARGE_CONTEXT_TOKENS;
	const nextTier = parseTier(candidate.tier);

	if (delta <= -MIN_TIER_JUMP && (candidate.intent === 'UNKNOWN' || candidate.intent === 'AUTOCOMPLETE' || nextTier === 'T0')) {
		return {
			action: 'switch',
			modelId: candidate.modelId,
			provider,
			tier: candidate.tier,
			subTier: candidate.subTier,
			intent: candidate.intent,
			confidence: candidate.confidence,
			reason: 'cost-downshift',
			preservesProviderCache: false,
			cacheReuseTokens: 0,
		};
	}

	if (delta >= MIN_TIER_JUMP) {
		return {
			action: 'switch',
			modelId: candidate.modelId,
			provider,
			tier: candidate.tier,
			subTier: candidate.subTier,
			intent: candidate.intent,
			confidence: candidate.confidence,
			reason: intentChanged ? 'intent-upgrade' : 'tier-upgrade',
			preservesProviderCache: false,
			cacheReuseTokens: 0,
		};
	}

	if (sameProvider && largeContext && Math.abs(delta) < MIN_TIER_JUMP) {
		return {
			action: 'stay',
			modelId: prev.modelId,
			provider: prev.provider,
			tier: prev.tier,
			subTier: prev.subTier,
			intent: candidate.intent,
			confidence: candidate.confidence,
			reason: 'affinity-cache',
			preservesProviderCache: true,
			cacheReuseTokens: ctx,
		};
	}

	if (intentChanged || !sameProvider) {
		return {
			action: 'switch',
			modelId: candidate.modelId,
			provider,
			tier: candidate.tier,
			subTier: candidate.subTier,
			intent: candidate.intent,
			confidence: candidate.confidence,
			reason: intentChanged ? 'intent-change' : 'provider-change',
			preservesProviderCache: false,
			cacheReuseTokens: 0,
		};
	}

	return {
		action: 'stay',
		modelId: prev.modelId,
		provider: prev.provider,
		tier: prev.tier,
		subTier: prev.subTier,
		intent: candidate.intent,
		confidence: candidate.confidence,
		reason: 'affinity-stable',
		preservesProviderCache: true,
		cacheReuseTokens: Math.floor(ctx * 0.5),
	};
}

export function applySwitchToState(
	prev: ConversationTurnState | undefined,
	conversationId: string,
	decision: SwitchDecision,
	promptHash: string,
	contextTokens: number,
): ConversationTurnState {
	return {
		conversationId,
		turnCount: (prev?.turnCount ?? 0) + 1,
		modelId: decision.modelId,
		provider: decision.provider,
		tier: decision.tier,
		subTier: decision.subTier,
		intent: decision.intent,
		confidence: decision.confidence,
		estimatedContextTokens: contextTokens,
		lastPromptHash: promptHash,
	};
}

/**
 * Map a catalog / LLM model pick onto a live free-tier-friendly endpoint id preference list.
 */
export function freeTierSurrogatePreferences(
	tier: string,
	intent: string,
	wantedModelId: string,
): string[] {
	const t = parseTier(tier);
	const intentBias = INTENT_SURROGATE_BIAS[intent] ?? [];
	const tierList = FREE_TIER_SURROGATES[t] ?? FREE_TIER_SURROGATES.T1;
	const ordered = [remapDisabledDeepSeekPro(wantedModelId), ...intentBias, ...tierList];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ordered) {
		const key = id.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			out.push(id);
		}
	}
	return out;
}

/** Next higher free-tier surrogate band for escalate-before-stream. */
export function escalateFreeTierPreferences(tier: string, intent: string): string[] {
	const idx = Math.min(tierIndex(tier) + 1, TIER_ORDER.length - 1);
	const next = TIER_ORDER[idx]!;
	return freeTierSurrogatePreferences(next, intent, FREE_TIER_SURROGATES[next]![0]!);
}
