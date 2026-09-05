/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TokenRouter-aligned USD pricing ($ / 1M tokens).
 * Rates match Singularity Auto catalog / TokenRouter published costs.
 * Cache reads default to 10% of input when a model does not declare a cache rate.
 */

export interface ModelTokenPrice {
	readonly inputPer1M: number;
	readonly outputPer1M: number;
	readonly cachePer1M: number;
}

/** Fallback when model is unknown — DeepSeek V4 Flash-0731 band. */
export const DEFAULT_TOKEN_PRICE: ModelTokenPrice = {
	inputPer1M: 0.09,
	outputPer1M: 0.18,
	cachePer1M: 0.009,
};

/**
 * Canonical + short TokenRouter ids → $/1M.
 * Keep in sync with openRouterLlmDecision MODEL_CARDS where possible.
 */
const PRICE_TABLE: Record<string, ModelTokenPrice> = {
	'deepseek/deepseek-v4-flash-0731': p(0.09, 0.18),
	'deepseek-v4-flash-0731': p(0.09, 0.18),
	// Legacy short id — same rate as Flash-0731
	'deepseek-v4-flash': p(0.09, 0.18),
	'google/gemini-2.0-flash-lite-001': p(0.075, 0.3),
	'google/gemini-2.5-flash': p(0.3, 2.5),
	'google/gemini-3.5-flash': p(0.3, 2.5),
	'google/gemini-3.5-flash-lite': p(0.075, 0.3),
	'google/gemini-3.6-flash': p(0.3, 2.5),
	'zhipu/glm-4-flash': p(0.1, 0.1),
	'z-ai/glm-5-turbo': p(0.1, 0.1),
	'openai/gpt-5.6-luna': p(1.25, 10),
	'gpt-5.6-luna': p(1.25, 10),
	'openai/gpt-5.2': p(1.25, 10),
	'openai/gpt-5.4': p(1.25, 10),
	'openai/gpt-5.4-nano': p(0.1, 0.4),
	'qwen/qwen3.7-plus': p(0.32, 1.28),
	'qwen/qwen3.7-max': p(0.32, 1.28),
	'deepseek/deepseek-chat': p(0.27, 1.1),
	'deepseek/deepseek-v4-pro': p(0.55, 2.19),
	'deepseek-v4-pro': p(0.55, 2.19),
	'moonshotai/kimi-k2.5': p(0.375, 2.025),
	'moonshotai/kimi-k2.6': p(0.57, 2.4),
	'mistralai/codestral-2501': p(0.3, 0.9),
	'zai/glm-5.2': p(0.54, 1.71),
	'deepseek/deepseek-v4-pro-0813': p(0.55, 2.19),
	'z-ai/glm-5.2': p(0.54, 1.71),
	'deepseek/deepseek-r1': p(0.55, 2.19),
	'openai/gpt-4o-mini': p(0.15, 0.6),
	'openai/gpt-4o': p(2.5, 10),
	'anthropic/claude-3.7-sonnet': p(3, 15),
	'anthropic/claude-sonnet-4.5': p(3, 15),
	'anthropic/claude-sonnet-5': p(3, 15),
	'anthropic/claude-3-opus': p(15, 75),
	'anthropic/claude-opus-4.8-fast': p(15, 75),
	'google/gemini-1.5-pro': p(1.25, 5),
	'google/gemini-3.1-pro-preview': p(1.25, 5),
	'qwen/qwen3.8-max': p(2, 6),
	'nvidia/nemotron-3-ultra': p(0.5, 2.2),
	'openai/o1': p(15, 60),
	'x-ai/grok-2': p(2, 10),
	'x-ai/grok-4.5': p(2, 10),
	'poolside/laguna-s-2.1:free': p(0, 0),
	'nvidia/nemotron-3-nano-30b-a3b:free': p(0, 0),
	'nvidia/nemotron-3-nano-30b-a3b': p(0, 0),
	'stepfun/step-3.5-flash': p(0.09, 0.18),
};

function p(inputPer1M: number, outputPer1M: number, cachePer1M = inputPer1M * 0.1): ModelTokenPrice {
	return { inputPer1M, outputPer1M, cachePer1M };
}

const liveOverrides = new Map<string, ModelTokenPrice>();

export function setLiveTokenPrice(modelId: string, price: ModelTokenPrice): void {
	const keys = normalizeKeys(modelId);
	for (const k of keys) {
		liveOverrides.set(k, price);
	}
}

export function getTokenPrice(modelId: string | undefined): ModelTokenPrice {
	if (!modelId) {
		return DEFAULT_TOKEN_PRICE;
	}
	for (const k of normalizeKeys(modelId)) {
		const live = liveOverrides.get(k);
		if (live) {
			return live;
		}
		const row = PRICE_TABLE[k];
		if (row) {
			return row;
		}
	}
	return DEFAULT_TOKEN_PRICE;
}

export interface UsageCostBreakdown {
	readonly inputUsd: number;
	readonly outputUsd: number;
	readonly cacheUsd: number;
	readonly totalUsd: number;
}

/**
 * Bill cache-miss input at input rate, cache reads at cache rate, output at output rate.
 * `inputTokens` must be fresh (non-cached) prompt tokens only — not total prompt_tokens.
 */
export function estimateUsageCostUsd(
	modelId: string | undefined,
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens: number,
): UsageCostBreakdown {
	const price = getTokenPrice(modelId);
	const freshInput = Math.max(0, inputTokens);
	const output = Math.max(0, outputTokens);
	const cached = Math.max(0, cachedInputTokens);
	const inputUsd = (freshInput * price.inputPer1M) / 1_000_000;
	const cacheUsd = (cached * price.cachePer1M) / 1_000_000;
	const outputUsd = (output * price.outputPer1M) / 1_000_000;
	return {
		inputUsd,
		outputUsd,
		cacheUsd,
		totalUsd: inputUsd + outputUsd + cacheUsd,
	};
}

export function formatUsd(amount: number): string {
	if (!Number.isFinite(amount) || amount <= 0) {
		return '$0.00';
	}
	if (amount < 0.01) {
		return `$${amount.toFixed(4)}`;
	}
	if (amount < 1) {
		return `$${amount.toFixed(3)}`;
	}
	return `$${amount.toFixed(2)}`;
}

function normalizeKeys(modelId: string): string[] {
	const raw = modelId.trim().toLowerCase();
	const keys = new Set<string>([raw]);
	const slash = raw.lastIndexOf('/');
	if (slash >= 0) {
		keys.add(raw.slice(slash + 1));
	}
	return [...keys];
}

/**
 * Best-effort: pull pricing from TokenRouter/OpenRouter-style /models payloads.
 * Supports common shapes: pricing.{prompt,completion,input,output,cache_read}, cost.{input,output,cacheRead}.
 */
export function ingestModelsPricingPayload(payload: unknown): number {
	const data = (payload as { data?: unknown })?.data;
	const list = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
	let n = 0;
	for (const row of list) {
		if (!row || typeof row !== 'object') {
			continue;
		}
		const id = String((row as { id?: string }).id ?? '').trim();
		if (!id) {
			continue;
		}
		const parsed = parseModelRowPrice(row);
		if (!parsed) {
			continue;
		}
		setLiveTokenPrice(id, parsed);
		n++;
	}
	return n;
}

function parseModelRowPrice(row: unknown): ModelTokenPrice | undefined {
	const r = row as Record<string, unknown>;
	const pricing = (r.pricing ?? r.cost ?? r.price) as Record<string, unknown> | undefined;
	if (!pricing || typeof pricing !== 'object') {
		return undefined;
	}
	const input = num(pricing.prompt ?? pricing.input ?? pricing.input_cost_per_token ?? pricing.inputPer1M);
	const output = num(pricing.completion ?? pricing.output ?? pricing.output_cost_per_token ?? pricing.outputPer1M);
	const cache = num(pricing.cache_read ?? pricing.cacheRead ?? pricing.input_cache_read ?? pricing.cachePer1M);
	if (input === undefined || output === undefined) {
		return undefined;
	}
	// OpenRouter often quotes $/token; TokenRouter/models.dev may quote $/1M.
	const scale = input > 0 && input < 0.001 ? 1_000_000 : 1;
	const inputPer1M = input * scale;
	const outputPer1M = output * scale;
	const cachePer1M = cache !== undefined ? cache * scale : inputPer1M * 0.1;
	return { inputPer1M, outputPer1M, cachePer1M };
}

function num(v: unknown): number | undefined {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}
