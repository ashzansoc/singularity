/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IAgentHostService, type IAgentHostExecutionTaskRequest, type IAgentHostExecutionTaskResult } from '../../../../../platform/agentHost/common/agentService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../common/contributions.js';

class ExecutionAgentHostContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.executionAgentHost';

	constructor(
		@IAgentHostService private readonly agentHostService: IAgentHostService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(CommandsRegistry.registerCommand('singularity.agentHost.executeTask', async (_accessor, request: IAgentHostExecutionTaskRequest) => {
			try {
				return await this.agentHostService.executeExecutionTask(request);
			} catch (err) {
				this.logService.error('[ExecutionAgentHost] executeTask failed', err);
				const taskId = request?.task?.id ?? 'unknown';
				return {
					taskId,
					ok: false,
					error: String(err),
					failureClass: 'provider_error',
				} satisfies IAgentHostExecutionTaskResult;
			}
		}));
	}
}

registerWorkbenchContribution2(ExecutionAgentHostContribution.ID, ExecutionAgentHostContribution, WorkbenchPhase.AfterRestored);

export function registerExecutionAgentHostCommand(accessor: ServicesAccessor): void {
	void accessor;
}
