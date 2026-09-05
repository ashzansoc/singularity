/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../common/contributions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { IExecutionEngineService } from '../../common/execution/executionEngineService.js';
import { ChatConfiguration } from '../../common/constants.js';
import { URI } from '../../../../../base/common/uri.js';
import type { ExecutionGraphSnapshot } from '../../../../../platform/agentHost/node/execution/executionTypes.js';

class ExecutionGraphContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.executionGraph';

	private readonly taskStatus = new Map<string, Map<string, string>>();

	constructor(
		@IExecutionEngineService private readonly executionEngineService: IExecutionEngineService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.syncConfig();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ChatConfiguration.ExecutionEnabled)
				|| e.affectsConfiguration(ChatConfiguration.ExecutionMaxConcurrentAgents)
				|| e.affectsConfiguration(ChatConfiguration.ExecutionAutoPlanThreshold)) {
				this.syncConfig();
			}
		}));
		this._register(this.executionEngineService.onDidUpdateGraph(snapshot => {
			void snapshot;
		}));
		this._register(CommandsRegistry.registerCommand('singularity.execution.reportEvent', (_accessor, event: {
			executionId: string;
			kind: string;
			taskId?: string;
			message: string;
			payload?: Record<string, unknown>;
		}) => {
			this.handleExecutionEvent(event);
		}));
		this._register(CommandsRegistry.registerCommand('singularity.execution.projectTodo', async (_accessor, sessionId: string, markdown: string) => {
			await this.executionEngineService.projectTodoMd(URI.parse(sessionId), markdown);
		}));
	}

	private handleExecutionEvent(event: {
		executionId: string;
		kind: string;
		taskId?: string;
		message: string;
		payload?: Record<string, unknown>;
	}): void {
		if (!event?.executionId) {
			return;
		}
		let statuses = this.taskStatus.get(event.executionId);
		if (!statuses) {
			statuses = new Map();
			this.taskStatus.set(event.executionId, statuses);
		}
		if (event.taskId) {
			if (event.kind === 'TaskStarted') {
				statuses.set(event.taskId, 'running');
			} else if (event.kind === 'TaskCompleted') {
				statuses.set(event.taskId, 'completed');
			} else if (event.kind === 'TaskFailed') {
				statuses.set(event.taskId, 'failed');
			} else if (event.kind === 'TaskReady') {
				statuses.set(event.taskId, 'ready');
			} else if (event.kind === 'TaskBlocked') {
				statuses.set(event.taskId, 'blocked');
			}
		}

		const batches = this.buildBatches(statuses);
		const existing = this.executionEngineService.getGraph(event.executionId);
		const snapshot: ExecutionGraphSnapshot = {
			executionId: event.executionId,
			objective: existing?.objective ?? event.message,
			status: event.kind === 'ExecutionCompleted' ? 'completed'
				: event.kind === 'ExecutionFailed' ? 'failed'
					: existing?.status ?? 'running',
			batches,
			criticalPathLength: existing?.criticalPathLength ?? batches.length,
		};
		this.executionEngineService.updateGraph(snapshot);
	}

	private buildBatches(statuses: Map<string, string>): ExecutionGraphSnapshot['batches'] {
		const running = [...statuses.entries()].filter(([, s]) => s === 'running').map(([id]) => ({ id, title: id, status: 'running' }));
		const ready = [...statuses.entries()].filter(([, s]) => s === 'ready').map(([id]) => ({ id, title: id, status: 'ready' }));
		const completed = [...statuses.entries()].filter(([, s]) => s === 'completed').map(([id]) => ({ id, title: id, status: 'completed' }));
		const batches: ExecutionGraphSnapshot['batches'] = [];
		if (running.length) batches.push(running);
		if (ready.length) batches.push(ready);
		if (completed.length) batches.push(completed);
		return batches;
	}

	private syncConfig(): void {
		this.executionEngineService.configure({
			enabled: this.configurationService.getValue<boolean>(ChatConfiguration.ExecutionEnabled) ?? false,
			maxConcurrentAgents: this.configurationService.getValue<number>(ChatConfiguration.ExecutionMaxConcurrentAgents) ?? 8,
			autoPlanThreshold: this.configurationService.getValue<'low' | 'medium' | 'high'>(ChatConfiguration.ExecutionAutoPlanThreshold) ?? 'low',
		});
	}
}

registerWorkbenchContribution2(ExecutionGraphContribution.ID, ExecutionGraphContribution, WorkbenchPhase.AfterRestored);

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'singularityExecution',
	title: localize('singularityExecution', "Singularity Execution"),
	properties: {
		[ChatConfiguration.ExecutionEnabled]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize('executionEnabled', "When enabled, **Multi-agent** runs dependency-aware parallel subagents (setup → backend/frontend workers → integrate). When disabled, Agent uses the standard single-agent flow."),
		},
		[ChatConfiguration.ExecutionMaxConcurrentAgents]: {
			type: 'number',
			default: 8,
			minimum: 1,
			maximum: 25,
			description: localize('executionMaxConcurrent', "Maximum parallel subagent tasks per execution batch."),
		},
		[ChatConfiguration.ExecutionAutoPlanThreshold]: {
			type: 'string',
			enum: ['low', 'medium', 'high'],
			default: 'low',
			description: localize('executionAutoPlanThreshold', "Minimum complexity lane before the execution engine takes over from single-agent flow."),
		},
		[ChatConfiguration.ExecutionRiskParallelization]: {
			type: 'string',
			enum: ['conservative', 'balanced', 'aggressive'],
			default: 'balanced',
			description: localize('executionRiskParallelization', "How aggressively to parallelize tasks when risk signals are present."),
		},
	},
});

export function registerExecutionGraphContribution(accessor: ServicesAccessor): void {
	accessor.get(IInstantiationService);
}
