/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, TextDocument, Disposable as VscodeDisposable } from 'vscode';
import { Singularity } from '../../../platform/inlineCompletions/common/api';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ContextItem } from '../../languageServer/common/languageContextService';
import { ILanguageContextProviderService, ProviderTarget } from './languageContextProviderService';

export class NullLanguageContextProviderService implements ILanguageContextProviderService {
	_serviceBrand: undefined;

	registerContextProvider<T extends Singularity.SupportedContextItem>(provider: Singularity.ContextProvider<T>, targets: ProviderTarget[]): VscodeDisposable {
		return Disposable.None;
	}

	getAllProviders(): readonly Singularity.ContextProvider<Singularity.SupportedContextItem>[] {
		return [];
	}

	getContextProviders(doc: TextDocument): Singularity.ContextProvider<Singularity.SupportedContextItem>[] {
		return [];
	}

	getContextItems(doc: TextDocument, request: Singularity.ResolveRequest, cancellationToken: CancellationToken): AsyncIterable<ContextItem> {
		return {
			[Symbol.asyncIterator]: async function* () {
				// No context items to provide
			}
		};
	}

	getContextItemsOnTimeout(doc: TextDocument, request: Singularity.ResolveRequest): ContextItem[] {
		return [];
	}
}
