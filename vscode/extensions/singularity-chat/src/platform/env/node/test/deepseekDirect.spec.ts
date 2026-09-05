/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isDeepSeekCatalogModel, isDeepSeekDirectRoutingModel, isDeepSeekFlashCatalogModel, isDeepSeekDirectBaseUrl, mapDeepSeekOfficialModelId } from '../singularityBundledEnv';

describe('DeepSeek direct API mapping', () => {
	it('maps catalog ids to official Chat Completions names', () => {
		expect(mapDeepSeekOfficialModelId('deepseek/deepseek-v4-pro-0813')).toBe('deepseek-v4-pro');
		expect(mapDeepSeekOfficialModelId('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro');
		expect(mapDeepSeekOfficialModelId('deepseek/deepseek-v4-flash-0731')).toBe('deepseek-v4-flash');
		expect(mapDeepSeekOfficialModelId('deepseek/deepseek-v4-flash')).toBe('deepseek-v4-flash');
	});

	it('detects DeepSeek catalog models only', () => {
		expect(isDeepSeekCatalogModel('deepseek/deepseek-v4-pro-0813')).toBe(true);
		expect(isDeepSeekCatalogModel('google/gemini-2.5-flash')).toBe(false);
		expect(isDeepSeekCatalogModel('stepfun/step-3.5-flash')).toBe(false);
	});

	it('detects DeepSeek Flash for official API routing only', () => {
		expect(isDeepSeekFlashCatalogModel('deepseek/deepseek-v4-flash-0731')).toBe(true);
		expect(isDeepSeekFlashCatalogModel('deepseek/deepseek-v4-pro-0813-free')).toBe(false);
		expect(isDeepSeekFlashCatalogModel('google/gemini-2.5-flash')).toBe(false);
	});

	it('routes Pro and Flash to official API when direct credentials exist', () => {
		expect(isDeepSeekDirectRoutingModel('deepseek/deepseek-v4-pro-0813')).toBe(true);
		expect(isDeepSeekDirectRoutingModel('deepseek/deepseek-v4-flash-0731')).toBe(true);
		expect(isDeepSeekDirectRoutingModel('google/gemini-2.5-flash')).toBe(false);
	});

	it('detects official DeepSeek base URL', () => {
		expect(isDeepSeekDirectBaseUrl('https://api.deepseek.com')).toBe(true);
		expect(isDeepSeekDirectBaseUrl('https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1')).toBe(false);
	});
});
