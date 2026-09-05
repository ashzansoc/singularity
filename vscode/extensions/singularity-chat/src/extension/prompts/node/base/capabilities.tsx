/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement } from '@vscode/prompt-tsx';
import { ChatLocation } from '../../../../platform/chat/common/commonTypes';
import { ICommandService } from '../../../commands/node/commandService';
import { agentsToCommands } from '../../../common/constants';

export interface CapabilitiesProps extends BasePromptElementProps {
	location: ChatLocation;
}

export interface CapabilitiesState {
	commandDescriptions: string;
}

export class Capabilities extends PromptElement<CapabilitiesProps, CapabilitiesState> {

	constructor(
		props: CapabilitiesProps,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(props);
	}

	private getIntentDescription(id: string) {
		const intent = this.commandService.getCommand(id, this.props.location)?.intent;
		return !intent || intent.isListedCapability === false ? undefined : intent.description;
	}

	override async prepare() {

		const seen = new Set<string>();

		const commandDescriptions = Object.entries(agentsToCommands).reduce((prev, [agent, commands]) => {
			const intent = this.getIntentDescription(agent);
			if (intent && seen.has(intent)) {
				return prev;
			}
			if (intent) {
				seen.has(intent);
				prev += `\n* ${intent}`;
			}
			for (const command of Object.values(commands)) {
				const commandDescription = this.getIntentDescription(command);
				if (commandDescription) {
					prev += `\n* ${commandDescription}`;
				}
			}
			return prev;
		}, '');

		return {
			commandDescriptions,
		};
	}

	render(state: CapabilitiesState) {
		return (
			<>
				You can answer general programming questions and perform the following tasks: {state.commandDescriptions}
				<br />
			</>
		);
	}
}
