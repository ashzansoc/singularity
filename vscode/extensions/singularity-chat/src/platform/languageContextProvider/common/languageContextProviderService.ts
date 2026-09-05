/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, Disposable, TextDocument } from 'vscode';
import { Singularity } from '../../../platform/inlineCompletions/common/api';
import { createServiceIdentifier } from '../../../util/common/services';
import { ContextItem } from '../../languageServer/common/languageContextService';

export enum ProviderTarget {
	NES = 'nes',
	Completions = 'completions',
}

export const ILanguageContextProviderService = createServiceIdentifier<ILanguageContextProviderService>('ILanguageContextProviderService');

export interface ILanguageContextProviderService {
	readonly _serviceBrand: undefined;

	registerContextProvider<T extends Singularity.SupportedContextItem>(provider: Singularity.ContextProvider<T>, targets: ProviderTarget[]): Disposable;

	getAllProviders(target: ProviderTarget[]): readonly Singularity.ContextProvider<Singularity.SupportedContextItem>[];

	getContextProviders(doc: TextDocument, target: ProviderTarget): Singularity.ContextProvider<Singularity.SupportedContextItem>[];

	getContextItems(doc: TextDocument, request: Singularity.ResolveRequest, cancellationToken: CancellationToken): AsyncIterable<ContextItem>;

	getContextItemsOnTimeout(doc: TextDocument, request: Singularity.ResolveRequest): ContextItem[];
}
