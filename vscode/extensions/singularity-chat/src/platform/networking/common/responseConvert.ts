/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from '../../../util/vs/base/common/assert';
import { IResponseDelta, ResponsePart, ResponsePartKind } from './fetch';

/**
 * Converts a ResponsePart to an IResponseDelta.
 * For non-content parts, the text is set to an empty string.
 * @param part The ResponsePart to convert
 */
export const toResponseDelta = (part: ResponsePart): IResponseDelta => {
	switch (part.kind) {
		case ResponsePartKind.ContentDelta:
			return { text: part.delta };
		case ResponsePartKind.Content:
			return { text: part.content, logprobs: part.logProbs };
		case ResponsePartKind.Annotation:
			return {
				text: '',
				codeVulnAnnotations: part.codeVulnAnnotations,
				ipCitations: part.ipCitations,
				singularityReferences: part.singularityReferences
			};
		case ResponsePartKind.Confirmation:
			return {
				text: '',
				singularityConfirmation: part,
			};
		case ResponsePartKind.Error:
			return {
				text: '',
				singularityErrors: [part.error]
			};
		case ResponsePartKind.ToolCallDelta:
			return {
				text: '',
				singularityToolCalls: [{
					name: part.name,
					arguments: part.delta,
					id: part.partId
				}]
			};
		case ResponsePartKind.ToolCall:
			return {
				text: '',
				singularityToolCalls: [{
					name: part.name,
					arguments: part.arguments,
					id: part.id
				}]
			};
		case ResponsePartKind.ThinkingDelta:
			return { text: '' };
		case ResponsePartKind.Thinking:
			return { text: '' }; // todo@karthiknadig/@connor4312: do we still need this back-compat with responses API?
		default:
			assertNever(part);
	}
};

const staticContentUUID = '8444605d-6c67-42c5-bbcb-a04b83f9f76e';


/**
 * Converts an IResponseDelta to a ResponsePart.
 * For non-content deltas, the text is ignored.
 * @param delta The IResponseDelta to convert
 */
export function* fromResponseDelta(delta: IResponseDelta): Iterable<ResponsePart> {
	if (delta.text && delta.text.length > 0) {
		yield {
			kind: ResponsePartKind.ContentDelta,
			partId: staticContentUUID,
			delta: delta.text
		};
	}
	if (delta.codeVulnAnnotations?.length || delta.ipCitations?.length || delta.singularityReferences?.length) {
		yield {
			kind: ResponsePartKind.Annotation,
			codeVulnAnnotations: delta.codeVulnAnnotations,
			ipCitations: delta.ipCitations,
			singularityReferences: delta.singularityReferences
		};
	}
	if (delta.singularityErrors && delta.singularityErrors.length > 0) {
		yield {
			kind: ResponsePartKind.Error,
			error: delta.singularityErrors[0]
		};
	}
	if (delta.singularityToolCalls && delta.singularityToolCalls.length > 0) {
		for (const toolCall of delta.singularityToolCalls) {
			yield {
				kind: ResponsePartKind.ToolCall,
				partId: toolCall.id,
				name: toolCall.name,
				arguments: toolCall.arguments,
				id: toolCall.id
			};
		}
	}
	if (delta.thinking) {
		yield {
			kind: ResponsePartKind.ThinkingDelta,
			partId: '', // Unknown, must be set by caller if needed
			delta: delta.thinking
		};
	}
	if (delta.singularityConfirmation) {
		yield {
			kind: ResponsePartKind.Confirmation,
			title: delta.singularityConfirmation.title,
			message: delta.singularityConfirmation.message,
			confirmation: delta.singularityConfirmation.confirmation
		};
	}
}
