/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CancellationToken, languages, type TextDocument, type Disposable as VscodeDisposable } from 'vscode';
import { Singularity } from '../../../platform/inlineCompletions/common/api';
import { ILanguageContextProviderService, ProviderTarget } from '../../../platform/languageContextProvider/common/languageContextProviderService';
import { ContextItem, ContextKind, KnownSources, SnippetContext, TraitContext } from '../../../platform/languageServer/common/languageContextService';
import { filterMap } from '../../../util/common/arrays';
import { AsyncIterableObject } from '../../../util/vs/base/common/async';
import { Disposable, toDisposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';

export class LanguageContextProviderService extends Disposable implements ILanguageContextProviderService {
	_serviceBrand: undefined;

	private providers: { provider: Singularity.ContextProvider<Singularity.SupportedContextItem>; targets: ProviderTarget[] }[] = [];

	public registerContextProvider<T extends Singularity.SupportedContextItem>(provider: Singularity.ContextProvider<T>, targets: ProviderTarget[]): VscodeDisposable {
		if (targets.length === 0) {
			throw new Error('At least one ProviderTarget must be specified when registering a context provider.');
		}

		this.providers.push({ provider, targets });
		return toDisposable(() => {
			const index = this.providers.findIndex(p => p.provider === provider);
			if (index > -1) {
				this.providers.splice(index, 1);
			}
		});
	}

	public getAllProviders(target: ProviderTarget[]): readonly Singularity.ContextProvider<Singularity.SupportedContextItem>[] {
		return this.providers.filter(p => target.some(t => p.targets.includes(t))).map(p => p.provider);
	}

	public getContextProviders(doc: TextDocument, target: ProviderTarget): Singularity.ContextProvider<Singularity.SupportedContextItem>[] {
		return this.getAllProviders([target]).filter(provider => languages.match(provider.selector, doc));
	}

	public override dispose(): void {
		super.dispose();
		this.providers.length = 0;
	}

	public getContextItems(doc: TextDocument, request: Singularity.ResolveRequest, cancellationToken: CancellationToken): AsyncIterable<ContextItem> {
		const providers = this.getContextProviders(doc, request.source === KnownSources.nes ? ProviderTarget.NES : ProviderTarget.Completions);

		const items = new AsyncIterableObject<Singularity.SupportedContextItem>(async emitter => {
			async function runProvider(provider: Singularity.ContextProvider<Singularity.SupportedContextItem>) {
				const langCtx = provider.resolver.resolve(request, cancellationToken);
				if (typeof (langCtx as any)[Symbol.asyncIterator] === 'function') {
					for await (const context of langCtx as AsyncIterable<Singularity.SupportedContextItem>) {
						emitter.emitOne(context);
					}
					return;
				}
				const result = await langCtx;
				if (Array.isArray(result)) {
					for (const context of result) {
						emitter.emitOne(context);
					}
				} else if (typeof (result as any)[Symbol.asyncIterator] !== 'function') {
					// Only push if it's a single SupportedContextItem, not an AsyncIterable
					emitter.emitOne(result as Singularity.SupportedContextItem);
				}
			}

			await Promise.allSettled(providers.map(runProvider));
		});

		const contextItems = items.map(v => LanguageContextProviderService.convertSingularityContextItem(v));

		return contextItems;
	}

	private static convertSingularityContextItem(item: Singularity.SupportedContextItem): ContextItem {
		const isSnippet = item && typeof item === 'object' && (item as any).uri !== undefined;
		if (isSnippet) {
			const ctx = item as Singularity.CodeSnippet;
			return {
				kind: ContextKind.Snippet,
				priority: LanguageContextProviderService.convertImportanceToPriority(ctx.importance),
				uri: URI.parse(ctx.uri),
				value: ctx.value,
				additionalUris: ctx.additionalUris?.map(uri => URI.parse(uri)),
			} satisfies SnippetContext;
		} else {
			const ctx = item as Singularity.Trait;
			return {
				kind: ContextKind.Trait,
				priority: LanguageContextProviderService.convertImportanceToPriority(ctx.importance),
				name: ctx.name,
				value: ctx.value,
			} satisfies TraitContext;
		}
	}

	// importance is coined by the singularity extension and must be an integer in [0, 100], while priority is by the chat extension and spans [0, 1]
	private static convertImportanceToPriority(importance: number | undefined): number {
		if (importance === undefined || importance < 0) {
			return 0;
		}
		if (importance > 100) {
			return 1;
		}
		return importance / 100;
	}

	public getContextItemsOnTimeout(doc: TextDocument, request: Singularity.ResolveRequest): ContextItem[] {
		const providers = this.getContextProviders(doc, request.source === KnownSources.nes ? ProviderTarget.NES : ProviderTarget.Completions);

		const unprocessedResults = filterMap(providers, p => p.resolver.resolveOnTimeout?.(request));

		const singularityCtxItems = unprocessedResults.flat();

		const ctxItems = singularityCtxItems.map(v => LanguageContextProviderService.convertSingularityContextItem(v));

		return ctxItems;
	}

}
