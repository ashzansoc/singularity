/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import type { AgentTaskResult } from '../../../../../platform/agentHost/node/execution/executionTypes.js';
import { ILanguageModelToolsService } from '../../common/tools/languageModelToolsService.js';
import { executionOwnedPathsRegistry } from '../../common/execution/executionOwnedPathsRegistry.js';
import { ExtensionHostTaskExecutor, type ExtensionHostExecutionTaskRequest } from './extensionHostTaskExecutor.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../common/contributions.js';

class ExecutionExtensionHostContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.executionExtensionHost';

	private readonly executor: ExtensionHostTaskExecutor;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILanguageModelToolsService languageModelToolsService: ILanguageModelToolsService,
	) {
		super();
		this.executor = new ExtensionHostTaskExecutor({
			logService: this.logService,
			instantiationService,
			languageModelToolsService,
		});

		this._register(CommandsRegistry.registerCommand('singularity.execution.executeTaskViaRunSubagent', async (_accessor, request: ExtensionHostExecutionTaskRequest) => {
			try {
				return await this.executor.executeTask(request);
			} catch (err) {
				this.logService.error('[ExecutionExtensionHost] executeTaskViaRunSubagent failed', err);
				const taskId = request?.task?.id ?? 'unknown';
				return {
					taskId,
					ok: false,
					error: String(err),
					failureClass: 'provider_error',
				} satisfies AgentTaskResult;
			}
		}));

		this._register(CommandsRegistry.registerCommand('singularity.execution.isPathOwned', (_accessor, parentSessionResource: string, filePath: string) => {
			return executionOwnedPathsRegistry.isPathOwnedByChild(parentSessionResource, filePath);
		}));

		this._register(CommandsRegistry.registerCommand('singularity.execution.clearOwnedPaths', (_accessor, parentSessionResource: string) => {
			executionOwnedPathsRegistry.clear(parentSessionResource);
		}));
	}
}

registerWorkbenchContribution2(ExecutionExtensionHostContribution.ID, ExecutionExtensionHostContribution, WorkbenchPhase.AfterRestored);
