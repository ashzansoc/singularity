/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatLocation } from '../../../vscodeTypes';
import type { IChatEndpoint } from '../../networking/common/networking';

/** Minimal request shape (mirrors IAutoModeRoutingRequest without circular imports). */
export interface SingularityRoutingRequest {
	readonly prompt: string;
	readonly location?: ChatLocation;
	readonly references?: readonly { readonly value: unknown }[];
}

export interface SingularityRouteDecision {
	readonly modelId: string;
	readonly intent: string;
	readonly intentConfidence: number;
	readonly tier: string;
	readonly subTier: string;
	readonly score: number;
	readonly reason: string;
	/** Preferred Vercel AI Gateway model for this sub-tier. */
	readonly recommendedModelId: string;
}

type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
type SubTier = `${Tier}.${1 | 2 | 3 | 4 | 5}`;

const TIERS: Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

/** Sub-tier → catalog model id. DeepSeek V4 Flash-0731 only (Pro disabled). */
const SUB_TIER_MODELS: Record<SubTier, string> = {
	'T0.1': 'deepseek/deepseek-v4-flash-0731',
	'T0.2': 'deepseek/deepseek-v4-flash-0731',
	'T0.3': 'deepseek/deepseek-v4-flash-0731',
	'T0.4': 'google/gemini-2.5-flash', // vision exception
	'T0.5': 'deepseek/deepseek-v4-flash-0731',
	'T1.1': 'deepseek/deepseek-v4-flash-0731',
	'T1.2': 'deepseek/deepseek-v4-flash-0731',
	'T1.3': 'deepseek/deepseek-v4-flash-0731',
	'T1.4': 'deepseek/deepseek-v4-flash-0731',
	'T1.5': 'deepseek/deepseek-v4-flash-0731',
	'T2.1': 'deepseek/deepseek-v4-flash-0731',
	'T2.2': 'deepseek/deepseek-v4-flash-0731',
	'T2.3': 'deepseek/deepseek-v4-flash-0731',
	'T2.4': 'deepseek/deepseek-v4-flash-0731',
	'T2.5': 'deepseek/deepseek-v4-flash-0731',
	'T3.1': 'deepseek/deepseek-v4-flash-0731',
	'T3.2': 'deepseek/deepseek-v4-flash-0731',
	'T3.3': 'deepseek/deepseek-v4-flash-0731',
	'T3.4': 'deepseek/deepseek-v4-flash-0731',
	'T3.5': 'deepseek/deepseek-v4-flash-0731',
	'T4.1': 'deepseek/deepseek-v4-flash-0731',
	'T4.2': 'deepseek/deepseek-v4-flash-0731',
	'T4.3': 'deepseek/deepseek-v4-flash-0731',
	'T4.4': 'deepseek/deepseek-v4-flash-0731',
	'T4.5': 'deepseek/deepseek-v4-flash-0731',
	'T5.1': 'deepseek/deepseek-v4-flash-0731',
	'T5.2': 'deepseek/deepseek-v4-flash-0731',
	'T5.3': 'deepseek/deepseek-v4-flash-0731',
	'T5.4': 'deepseek/deepseek-v4-flash-0731',
	'T5.5': 'deepseek/deepseek-v4-flash-0731',
	'T6.1': 'deepseek/deepseek-v4-flash-0731',
	'T6.2': 'deepseek/deepseek-v4-flash-0731',
	'T6.3': 'deepseek/deepseek-v4-flash-0731',
	'T6.4': 'deepseek/deepseek-v4-flash-0731',
	'T6.5': 'deepseek/deepseek-v4-flash-0731',
};

const INTENT_DEFAULT_TIER: Record<string, Tier> = {
	AUTOCOMPLETE: 'T0',
	SEARCH: 'T0',
	INLINE_EDIT: 'T1',
	CODE: 'T1',
	TERMINAL: 'T1',
	TEST: 'T1',
	EXPLAIN: 'T2',
	DOCUMENTATION: 'T2',
	DEBUG: 'T3',
	AGENT: 'T3',
	ARCHITECTURE: 'T5',
	REFACTOR: 'T5',
	REVIEW: 'T5',
};

/**
 * Cost/capability-aware picker among live Singularity endpoints, aligned with
 * Singularity T0.1–T6.5 Vercel model profiles.
 */
export class SingularityAutoRouter {
	route(
		chatRequest: SingularityRoutingRequest | undefined,
		knownEndpoints: IChatEndpoint[],
		availableModelIds?: readonly string[],
	): { endpoint: IChatEndpoint; decision: SingularityRouteDecision } | undefined {
		const candidates = filterEndpoints(knownEndpoints, availableModelIds);
		if (!candidates.length) {
			return undefined;
		}

		const { intent, confidence } = inferIntent(chatRequest);
		const targetTier = resolveTargetTier(chatRequest, intent);
		const subTier = pickSubTier(chatRequest, intent, targetTier, confidence);
		const recommendedModelId = SUB_TIER_MODELS[subTier];

		const ranked = [...candidates].sort((a, b) => {
			const scoreA = endpointScore(a, targetTier, chatRequest);
			const scoreB = endpointScore(b, targetTier, chatRequest);
			if (scoreB !== scoreA) {
				return scoreB - scoreA;
			}
			return (a.multiplier ?? 1) - (b.multiplier ?? 1);
		});

		const endpoint = ranked[0]!;
		return {
			endpoint,
			decision: {
				modelId: endpoint.model,
				intent,
				intentConfidence: confidence,
				tier: targetTier,
				subTier,
				score: endpointScore(endpoint, targetTier, chatRequest),
				recommendedModelId,
				reason: `Singularity ${subTier} → ${recommendedModelId} (CAPI ${endpoint.model})`,
			},
		};
	}
}

function tierIndex(tier: Tier): number {
	return TIERS.indexOf(tier);
}

function filterEndpoints(
	knownEndpoints: IChatEndpoint[],
	availableModelIds: readonly string[] | undefined,
): IChatEndpoint[] {
	let list = knownEndpoints.filter((e) => e.model && e.model !== 'auto');
	if (availableModelIds?.length) {
		const allowed = new Set(availableModelIds);
		const filtered = list.filter((e) => allowed.has(e.model));
		if (filtered.length) {
			list = filtered;
		}
	}
	return list;
}

function inferIntent(chatRequest: SingularityRoutingRequest | undefined): { intent: string; confidence: number } {
	const prompt = (chatRequest?.prompt ?? '').toLowerCase();
	const raw = (chatRequest?.prompt ?? '').trim();
	const loc = chatRequest?.location;

	if (loc === ChatLocation.Editor) {
		return { intent: 'INLINE_EDIT', confidence: 0.95 };
	}
	if (loc === ChatLocation.Terminal) {
		return { intent: 'TERMINAL', confidence: 0.9 };
	}
	// Casual chat — keep UNKNOWN so default tier stays cheap (T0 via UNKNOWN→T1 in table is wrong)
	// We return SEARCH? No — use a soft UNKNOWN with high confidence; resolveTargetTier maps UNKNOWN to T1
	// so also short-circuit in resolveTargetTier for casual.
	if (isCasualBridgePrompt(prompt, raw)) {
		return { intent: 'AUTOCOMPLETE', confidence: 0.95 }; // AUTOCOMPLETE → T0
	}
	if (/\b(bug|error|stack|crash|fix|debug|traceback)\b/.test(prompt)) {
		return { intent: 'DEBUG', confidence: 0.9 };
	}
	if (/\b(refactor|restructure|clean\s*up)\b/.test(prompt)) {
		return { intent: 'REFACTOR', confidence: 0.9 };
	}
	if (/\b(architect|system\s+design|high[\s-]?level)\b/.test(prompt)) {
		return { intent: 'ARCHITECTURE', confidence: 0.88 };
	}
	if (/\b(review|security|vulnerabilit)\b/.test(prompt)) {
		return { intent: 'REVIEW', confidence: 0.88 };
	}
	if (/\b(document|readme|docstring|jsdoc|changelog)\b/.test(prompt)) {
		return { intent: 'DOCUMENTATION', confidence: 0.85 };
	}
	if (/\b(explain|summarize)\b/.test(prompt) || (/\b(what|how)\s+(does|do)\b/.test(prompt) && /\b(code|function|file|class|this)\b/.test(prompt))) {
		// Short explains stay on cheap T0 — avoid EXPLAIN→Kimi for basic questions.
		if (raw.length < 160 || isCasualBridgePrompt(prompt, raw)) {
			return { intent: 'AUTOCOMPLETE', confidence: 0.9 };
		}
		return { intent: 'EXPLAIN', confidence: 0.85 };
	}
	if (/\b(tests?|jest|vitest|pytest)\b/.test(prompt)) {
		return { intent: 'TEST', confidence: 0.85 };
	}
	if (/\b(find|search|where\s+is|locate|symbol)\b/.test(prompt)) {
		return { intent: 'SEARCH', confidence: 0.8 };
	}
	if (raw.length < 100 && !/\b(code|fix|build|make|implement|refactor)\b/.test(prompt)) {
		return { intent: 'AUTOCOMPLETE', confidence: 0.85 }; // T0 for short non-coding chat
	}
	return { intent: 'CODE', confidence: 0.5 };
}

function isCasualBridgePrompt(prompt: string, raw: string): boolean {
	if (raw.length > 120) {
		return false;
	}
	if (/\b(code|function|file|bug|error|refactor|html|css|react|typescript|python)\b/.test(prompt)) {
		return false;
	}
	return /\b(how (are|have|is) (you|things)|how('s|s) it going|what'?s up|who are you|tell (me )?about (yourself|you)|what can you (do|tell)|about me\b)\b/.test(prompt)
		|| /^(how have you been|how are you|what can you tell about me|who are you)[\s?.!]*$/i.test(raw);
}

function resolveTargetTier(chatRequest: SingularityRoutingRequest | undefined, intent: string): Tier {
	let tier = INTENT_DEFAULT_TIER[intent] ?? 'T1';
	const prompt = chatRequest?.prompt ?? '';
	const tokens = Math.ceil(prompt.length / 4);

	// Frontend builds → Qwen 3.6 27B band (T2)
	if (/\b(build|create|implement|design)\b/i.test(prompt) &&
		/\b(frontend|react|ui|dashboard|landing|tsx|tailwind|component)\b/i.test(prompt)) {
		tier = higherTier(tier, 'T2');
	}

	if (tokens > 128_000) {
		tier = higherTier(tier, 'T4');
	} else if (tokens > 64_000) {
		tier = higherTier(tier, 'T2');
	}
	if (hasImageReference(chatRequest)) {
		tier = higherTier(tier, 'T4');
	}
	if (/\b(docker|kubernetes|k8s|security|performance|optimiz)\b/i.test(prompt)) {
		tier = higherTier(tier, 'T5');
	}
	return tier;
}

function pickSubTier(
	chatRequest: SingularityRoutingRequest | undefined,
	intent: string,
	tier: Tier,
	confidence: number,
): SubTier {
	const prompt = (chatRequest?.prompt ?? '').toLowerCase();
	const hasImages = hasImageReference(chatRequest);

	if (confidence < 0.4) {
		return 'T6.1';
	}

	switch (tier) {
		case 'T0':
			if (hasImages || /\b(screenshot|html|css|svg)\b/.test(prompt)) {
				return 'T0.4';
			}
			if (/\b(explain|summarize|readme|error)\b/.test(prompt)) {
				return 'T0.3';
			}
			if (/\b(regex|bash|git|function)\b/.test(prompt)) {
				return 'T0.2';
			}
			if (/\b(api|config|package|dependenc)\b/.test(prompt)) {
				return 'T0.5';
			}
			return 'T0.1';
		case 'T1':
			if (/\b(agent|migrat|tool|autonomous)\b/.test(prompt) || intent === 'AGENT') {
				return 'T1.4';
			}
			if (/\b(structure|dependenc|navigat|where\s+is)\b/.test(prompt) || intent === 'SEARCH') {
				return 'T1.3';
			}
			if (/\b(module|sdk|unit\s*test|convert)\b/.test(prompt) || intent === 'TEST') {
				return 'T1.5';
			}
			if (/\b(multi|files?|bug|performance|algorithm)\b/.test(prompt)) {
				return 'T1.2';
			}
			return 'T1.1';
		case 'T2':
			// Frontend specialty → Qwen 3.6 27B (T2.1)
			if (/\b(frontend|react|tsx|jsx|tailwind|css|ui|ux|dashboard|landing|shadcn|component|hero)\b/.test(prompt)) {
				return 'T2.1';
			}
			if (/\b(brainstorm|tradeoff|compare)\b/.test(prompt)) {
				return 'T2.5';
			}
			if (/\b(rfc|spec|design\s+doc)\b/.test(prompt)) {
				return 'T2.4';
			}
			if (/\b(learn|concept|example)\b/.test(prompt)) {
				return 'T2.3';
			}
			if (/\b(entire\s+repo|codebase|all\s+files|long\s+log)\b/.test(prompt)) {
				return 'T2.2';
			}
			return 'T2.3';
		case 'T3':
			if (/\b(huge|entire\s+repo|long\s+context)\b/.test(prompt)) {
				return 'T3.4';
			}
			if (/\b(pr\s*review|production|chain.of.thought)\b/.test(prompt) || intent === 'REVIEW') {
				return 'T3.3';
			}
			if (/\b(plan|research|multi.agent)\b/.test(prompt)) {
				return 'T3.2';
			}
			if (/\b(architect|multi.file|refactor)\b/.test(prompt)) {
				return 'T3.5';
			}
			return 'T3.1';
		case 'T4':
			if (/\b(plan|design\s+doc)\b/.test(prompt)) {
				return 'T4.5';
			}
			if (/\b(enterprise|migrat|cross.language)\b/.test(prompt)) {
				return 'T4.4';
			}
			if (/\b(book|transcript|document)\b/.test(prompt)) {
				return 'T4.3';
			}
			if (/\b(massive|multi.session)\b/.test(prompt)) {
				return 'T4.2';
			}
			return 'T4.1';
		case 'T5':
			if (/\b(brainstorm|novel|alternative)\b/.test(prompt)) {
				return 'T5.5';
			}
			if (/\b(agent|review|multi.stage)\b/.test(prompt)) {
				return 'T5.4';
			}
			if (/\b(massive|documentation.heavy)\b/.test(prompt)) {
				return 'T5.3';
			}
			if (/\b(mission.critical|highest|difficult\s+architect)\b/.test(prompt)) {
				return 'T5.2';
			}
			return 'T5.1';
		case 'T6':
			if (/\b(million|audit|cross.document)\b/.test(prompt)) {
				return 'T6.5';
			}
			if (/\b(orchestrat|research|verif)\b/.test(prompt)) {
				return 'T6.4';
			}
			if (/\b(creative|ideation|novel\s+architect)\b/.test(prompt)) {
				return 'T6.3';
			}
			if (/\b(redesign|extremely|complex\s+refactor)\b/.test(prompt)) {
				return 'T6.2';
			}
			return 'T6.1';
	}
}

function higherTier(a: Tier, b: Tier): Tier {
	return tierIndex(a) >= tierIndex(b) ? a : b;
}

function hasImageReference(chatRequest: SingularityRoutingRequest | undefined): boolean {
	const refs = chatRequest?.references;
	if (!refs?.length) {
		return false;
	}
	return refs.some((r) => {
		const v = r.value as { mimeType?: string } | undefined;
		return typeof v?.mimeType === 'string' && v.mimeType.startsWith('image/');
	});
}

function endpointScore(
	endpoint: IChatEndpoint,
	targetTier: Tier,
	chatRequest: SingularityRoutingRequest | undefined,
): number {
	const endpointTier = inferTier(endpoint);
	const distance = Math.abs(tierIndex(endpointTier) - tierIndex(targetTier));
	let score = 1 - distance * 0.18;
	if (tierIndex(endpointTier) < tierIndex(targetTier)) {
		score -= 0.05;
	}
	if (endpoint.supportsVision && hasImageReference(chatRequest)) {
		score += 0.08;
	}
	if (endpoint.supportsToolCalls && tierIndex(targetTier) >= 1) {
		score += 0.03;
	}
	return score;
}

function inferTier(endpoint: IChatEndpoint): Tier {
	const id = `${endpoint.model} ${endpoint.family} ${endpoint.name}`.toLowerCase();
	const category = (endpoint.priceCategory ?? endpoint.modelPickerCategory ?? '').toLowerCase();

	if (category === 'lightweight' || /\b(mini|flash|haiku|nano|lite)\b/.test(id)) {
		return 'T0';
	}
	if (/\b(opus|fable|gpt-5\.5(?!-mini)|frontier)\b/.test(id)) {
		return 'T6';
	}
	if (category === 'powerful' || /\b(sonnet|gpt-4\.1|gpt-4o|gemini.*pro|claude-4|claude-3\.5|grok-4\.5)\b/.test(id)) {
		return 'T5';
	}
	if (/\b(r1|thinking|reasoner|o1|o3)\b/.test(id)) {
		return 'T3';
	}
	if (/\b(kimi|long.?context|max)\b/.test(id)) {
		return 'T4';
	}
	if (endpoint.isPremium) {
		return 'T5';
	}
	if (category === 'versatile') {
		return 'T1';
	}
	return 'T1';
}
