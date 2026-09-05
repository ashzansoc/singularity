/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Attachment, SendOptions } from '@github/copilot/sdk';

export interface ISingularityCLIPendingRequestContext {
	readonly prompt: string;
	readonly attachments: Attachment[];
	readonly source?: SendOptions['source'];
}

const pendingRequestContextBySessionId = new Map<string, ISingularityCLIPendingRequestContext>();

export function setPendingSingularityCLIRequestContext(sessionId: string, context: ISingularityCLIPendingRequestContext): void {
	pendingRequestContextBySessionId.set(sessionId, context);
}

export function takePendingSingularityCLIRequestContext(sessionId: string): ISingularityCLIPendingRequestContext | undefined {
	const context = pendingRequestContextBySessionId.get(sessionId);
	if (context) {
		pendingRequestContextBySessionId.delete(sessionId);
	}
	return context;
}

export function clearPendingSingularityCLIRequestContext(sessionId: string): void {
	pendingRequestContextBySessionId.delete(sessionId);
}
