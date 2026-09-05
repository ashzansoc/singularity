/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { InlineCompletionItemProvider } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';

export interface ISingularityInlineCompletionItemProviderService {
	readonly _serviceBrand: undefined;

	getOrCreateInstantiationService(): IInstantiationService;
	getOrCreateProvider(): InlineCompletionItemProvider;
}

export const ISingularityInlineCompletionItemProviderService = createServiceIdentifier<ISingularityInlineCompletionItemProviderService>('ISingularityInlineCompletionItemProviderService');

export class NullSingularityInlineCompletionItemProviderService implements ISingularityInlineCompletionItemProviderService {
	readonly _serviceBrand: undefined;

	getOrCreateInstantiationService(): IInstantiationService {
		throw new Error('Not implemented');
	}
	getOrCreateProvider(): InlineCompletionItemProvider {
		throw new Error('Not implemented');
	}
}
