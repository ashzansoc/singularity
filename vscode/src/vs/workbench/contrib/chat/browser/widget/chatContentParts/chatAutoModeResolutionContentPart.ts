/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { localize } from '../../../../../../nls.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IMarkdownRenderer } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import { IChatAutoModeResolutionPart } from '../../../common/chatService/chatService.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { ChatTreeItem } from '../../chat.js';
import { ChatCollapsibleContentPart } from './chatCollapsibleContentPart.js';
import { IChatContentPartRenderContext } from './chatContentParts.js';
import './media/chatAutoModeResolution.css';

/**
 * Collapsible Auto routing explainability: collapsed shows "Routed to <model>",
 * expanded shows classification label and confidence.
 */
export class ChatAutoModeResolutionContentPart extends ChatCollapsibleContentPart {

	constructor(
		private readonly content: IChatAutoModeResolutionPart,
		context: IChatContentPartRenderContext,
		private readonly chatContentMarkdownRenderer: IMarkdownRenderer,
		@IHoverService hoverService: IHoverService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		const title = localize('chat.autoModeResolution.title', "Routed to {0}", content.resolvedModelName || content.resolvedModel);
		super(title, context, undefined, hoverService, configurationService);
		this.icon = Codicon.check;
	}

	protected override initContent(): HTMLElement {
		const wrapper = $('.chat-auto-mode-resolution-content.chat-used-context-list');
		const body = $('.chat-auto-mode-resolution-body');

		const explanation = this.content.predictedLabel === 'fallback'
			? localize('chat.autoModeResolution.fallback', "Unable to resolve a preferred model; using a fallback.")
			: this.content.predictedLabel === 'needs_reasoning'
				? localize('chat.autoModeResolution.reasoning', "Classified as needing deeper reasoning.")
				: localize('chat.autoModeResolution.nonReasoning', "Classified as a non-reasoning turn.");

		const explanationEl = $('.chat-auto-mode-resolution-explanation');
		const renderedExplanation = this._register(this.chatContentMarkdownRenderer.render(new MarkdownString(explanation)));
		explanationEl.appendChild(renderedExplanation.element);
		body.appendChild(explanationEl);

		const detail = localize(
			'chat.autoModeResolution.detail',
			"`{0}` · Confidence {1}%",
			this.content.resolvedModel,
			(this.content.confidence * 100).toFixed(0),
		);
		const detailEl = $('.chat-auto-mode-resolution-detail');
		const renderedDetail = this._register(this.chatContentMarkdownRenderer.render(new MarkdownString(detail)));
		detailEl.appendChild(renderedDetail.element);
		body.appendChild(detailEl);

		wrapper.appendChild(body);
		return wrapper;
	}

	hasSameContent(other: IChatRendererContent, _followingContent: IChatRendererContent[], _element: ChatTreeItem): boolean {
		return other.kind === 'autoModeResolution'
			&& other.resolvedModel === this.content.resolvedModel
			&& other.resolvedModelName === this.content.resolvedModelName
			&& other.confidence === this.content.confidence
			&& other.predictedLabel === this.content.predictedLabel;
	}
}
