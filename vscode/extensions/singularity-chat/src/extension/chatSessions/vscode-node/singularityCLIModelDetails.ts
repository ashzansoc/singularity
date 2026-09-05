/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatSessionMetadataStore } from '../common/chatSessionMetadataStore';
import { ISingularityCLIModels, matchesSingularityCLIModel } from '../singularitycli/node/singularityCli';
import { ISingularityCLISession } from '../singularitycli/node/singularitycliSession';
import { formatModelDetails } from '../../../platform/chat/common/chatModelDetails';

export interface SingularityCLIModelDetails {
	readonly result: vscode.ChatResult;
	readonly responseModelId: string | undefined;
}

/**
 * Builds the chat result details for the model that produced the latest CLI response.
 */
export async function getSingularityCLIModelDetails(session: ISingularityCLISession, requestModel: { model: string; reasoningEffort?: string } | undefined, singularityCLIModels: ISingularityCLIModels, logService: ILogService, enabled: boolean, creditsUsed?: number): Promise<SingularityCLIModelDetails> {
	if (!enabled) {
		return { result: {}, responseModelId: undefined };
	}

	const models = await singularityCLIModels.getModels().catch(ex => {
		logService.error(ex, 'Failed to get models');
		return [];
	});
	const selectedModelId = await session.getSelectedModelId().catch(ex => {
		logService.error(ex, 'Failed to get selected model');
		return undefined;
	});
	const responseModelId = session.getLastResponseModelId();
	const modelInfo = [responseModelId, selectedModelId, requestModel?.model]
		.map(modelId => modelId ? models.find(model => matchesSingularityCLIModel(model, modelId)) : undefined)
		.find(modelInfo => !!modelInfo);

	let details: string | undefined;
	if (modelInfo) {
		details = formatModelDetails(modelInfo.name, modelInfo.multiplier, creditsUsed);
	}

	return {
		result: details ? { details } : {},
		responseModelId,
	};
}

/**
 * Persists the concrete response model id and credits used so rebuilt history can recover details for auto-mode requests.
 */
export async function persistSingularityCLIResponseModelId(sessionId: string, requestId: string, responseModelId: string | undefined, isUsingAutoModel: boolean, chatSessionMetadataStore: IChatSessionMetadataStore, logService: ILogService, creditsUsed?: number): Promise<void> {
	if (!responseModelId && creditsUsed === undefined) {
		return;
	}
	try {
		await chatSessionMetadataStore.updateRequestDetails(sessionId, [{ vscodeRequestId: requestId, responseModelId, creditsUsed, isUsingAutoModel }]);
	} catch (ex) {
		logService.error(ex, 'Failed to persist response model id');
	}
}
