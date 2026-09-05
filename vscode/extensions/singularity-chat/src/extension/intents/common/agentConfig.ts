/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { shouldSkipAuxiliaryTokenRouterLlm } from '../../byok/vscode-node/tokenRouterRpmGate';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ServicesAccessor } from '../../../util/vs/platform/instantiation/common/instantiation';

/** First stop on 1 req/min TokenRouter (~16+ minutes). */
export const TOKENROUTER_BETA_TOOL_CALL_CAP = 16;
/** After the user clicks Continue — never 50–200 hour-long loops. */
export const TOKENROUTER_BETA_TOOL_CALL_HARD_CAP = 24;
/** Wall-clock abort so a prompt cannot run for hours behind RPM waits. */
export const TOKENROUTER_BETA_MAX_LOOP_MS = 25 * 60_000;

export function capAgentToolCallIterations(n: number): number {
	if (!shouldSkipAuxiliaryTokenRouterLlm()) {
		return n;
	}
	return Math.min(Math.max(1, n), TOKENROUTER_BETA_TOOL_CALL_HARD_CAP);
}

export function getAgentMaxRequests(accessor: ServicesAccessor,): number {
	const configurationService = accessor.get(IConfigurationService);
	const configured = configurationService.getNonExtensionConfig<number>('chat.agent.maxRequests');
	const fallback = configured ?? 50;
	if (shouldSkipAuxiliaryTokenRouterLlm()) {
		return Math.min(fallback, TOKENROUTER_BETA_TOOL_CALL_CAP);
	}
	return fallback;
}
