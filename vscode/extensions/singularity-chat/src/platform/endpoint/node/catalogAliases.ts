/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Maps Singularity catalog model IDs onto live TokenRouter endpoints.
 * Default policy: DeepSeek Flash-0731 + Pro-0813 via TokenRouter.
 * Gemini stays only as a vision fallback (DeepSeek has no image modality).
 */

const FLASH = 'deepseek/deepseek-v4-flash-0731';
const PRO = 'deepseek/deepseek-v4-pro-0813';
const PRO_ALIAS = 'deepseek/deepseek-v4-pro';
const VISION = 'google/gemini-2.5-flash';

/** Catalog id → preferred live gateway ids (Flash-0731 only; Pro is disabled). */
export const CATALOG_LIVE_ALIASES: Record<string, readonly string[]> = {
	[FLASH]: [FLASH],
	[PRO]: [FLASH],
	'deepseek/deepseek-v4-pro-0813-free': [FLASH],
	'deepseek/deepseek-v4-pro-0813': [FLASH],
	[PRO_ALIAS]: [FLASH],
	'deepseek/deepseek-v4-flash': [FLASH],
	'qwen/qwen3.7-flash': [FLASH],
	'openai/gpt-5.6-luna': [FLASH],
	'google/gemini-2.0-flash-lite-001': [FLASH, VISION],
	'google/gemini-2.5-flash': [VISION, 'google/gemini-3.5-flash', FLASH],
	'zhipu/glm-4-flash': [FLASH],
	'qwen/qwen3.7-plus': [FLASH],
	'deepseek/deepseek-chat': [FLASH],
	'moonshotai/kimi-k2.5': [FLASH],
	'poolside/laguna-s-2.1': [FLASH],
	'mistralai/codestral-2501': [FLASH],
	'moonshotai/kimi-k2.6': [FLASH],
	'zai/glm-5.2': [FLASH],
	'mistralai/mistral-large-2411': [FLASH],
	'x-ai/grok-2-mini': [FLASH],
	'deepseek/deepseek-r1': [FLASH],
	'nvidia/nemotron-3-ultra': [FLASH],
	'openai/gpt-4o-mini': [FLASH],
	'google/gemini-1.5-pro': [VISION, FLASH],
	'anthropic/claude-3.7-sonnet': [FLASH],
	'qwen/qwen3.8-max': [FLASH],
	'openai/gpt-4o': [FLASH],
	'anthropic/claude-3-opus': [FLASH],
	'x-ai/grok-2': [FLASH],
	'openai/o1': [FLASH],
	'anthropic/claude-3.7-sonnet:thinking': [FLASH],
	'deepseek/deepseek-v3.2': [FLASH],
};

/** Expand a catalog / intent preference list with live aliases (deduped, order preserved). */
export function expandCatalogPreferences(preferences: readonly string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const id of preferences) {
		const remapped = /deepseek-v4-pro/i.test(id) ? FLASH : id;
		const chain = [remapped, ...(CATALOG_LIVE_ALIASES[remapped] ?? CATALOG_LIVE_ALIASES[id] ?? [])];
		for (const c of chain) {
			const live = /deepseek-v4-pro/i.test(c) ? FLASH : c;
			const key = live.toLowerCase();
			if (!seen.has(key)) {
				seen.add(key);
				out.push(live);
			}
		}
	}
	return out;
}
