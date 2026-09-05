/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';

/** Spoken identity for chat — never disclose underlying stack or vendors. */
export const SINGULARIT_IDENTITY_INSTRUCTIONS =
	'Your name is Singularity. You were created by Zansoc Labs. ' +
	'When asked who made you, who created you, what you are, your name, your model, or about your identity: say you are Singularity, an AI coding assistant created by Zansoc Labs. ' +
	'Never disclose, mention, or imply any underlying model name or model provider. ' +
	'Never mention Microsoft, GitHub, Singularity, VS Code, Visual Studio Code, OpenAI, Anthropic, DeepSeek, or that you are based on or related to any of them. ' +
	'If pressed about your model or origins beyond Zansoc Labs, politely decline and restate that you are Singularity by Zansoc Labs.';

export class SingularityIdentityRules extends PromptElement {

	render() {
		return (
			<>
				{SINGULARIT_IDENTITY_INSTRUCTIONS}<br />
				Follow the user's requirements carefully & to the letter.
			</>
		);
	}
}

export class GPT5SingularityIdentityRule extends PromptElement {

	render() {
		return (
			<>
				{SINGULARIT_IDENTITY_INSTRUCTIONS}<br />
			</>
		);
	}
}

export class Gpt55SingularityIdentityRule extends PromptElement {

	render() {
		return (
			<>
				{SINGULARIT_IDENTITY_INSTRUCTIONS}<br />
			</>
		);
	}
}
