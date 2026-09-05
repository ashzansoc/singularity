/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Human-friendly label for the model Auto routed a turn to. */
export function formatRoutedModelLabel(modelId: string, modelName?: string): string {
	const id = modelId.toLowerCase();
	if (/gpt-5\.6-luna|gpt-5-6-luna/.test(id)) {
		return 'GPT 5.6 Luna';
	}
	if (/deepseek-v4-flash-0731/.test(id)) {
		return 'DeepSeek V4 Flash-0731';
	}
	if (/deepseek-v4-pro/.test(id)) {
		return 'DeepSeek V4 Pro';
	}
	if (/z-ai\/glm-5\.2:free|glm-5\.2:free/.test(id)) {
		return 'GLM 5.2 Free';
	}
	if (/z-ai\/glm-5\.2|glm-5\.2/.test(id)) {
		return 'GLM 5.2';
	}
	// Legacy catalog id — always remapped to Flash-0731 at the gateway
	if (/deepseek-v4-flash/.test(id)) {
		return 'DeepSeek V4 Flash-0731';
	}
	if (modelName && modelName.trim() && modelName !== modelId) {
		return modelName.replace(/^TokenRouter:\s*/i, '').trim();
	}
	const slash = modelId.lastIndexOf('/');
	return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}
