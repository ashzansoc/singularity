/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IPlanTodoSyncService } from '../plan/planTodoSyncService.js';
import type { ExecutionGraphSnapshot, ExecutionRunRequest, ExecutionRunResponse } from '../../../../../platform/agentHost/node/execution/executionTypes.js';

export const IExecutionEngineService = createDecorator<IExecutionEngineService>('executionEngineService');

export interface IExecutionEngineService {
	readonly _serviceBrand: undefined;

	readonly onDidUpdateGraph: Event<ExecutionGraphSnapshot>;

	configure(opts: { enabled?: boolean; autoPlanThreshold?: 'low' | 'medium' | 'high'; maxConcurrentAgents?: number }): void;
	isEnabled(): boolean;
	shouldUseEngine(goal: string): Promise<boolean>;
	run(request: ExecutionRunRequest): Promise<ExecutionRunResponse>;
	resume(executionId: string): Promise<ExecutionRunResponse>;
	getGraph(executionId: string): ExecutionGraphSnapshot | undefined;
	getActiveExecution(sessionId: string): string | undefined;
	updateGraph(snapshot: ExecutionGraphSnapshot): void;
	projectTodoMd(sessionResource: URI, markdown: string): Promise<void>;
}

export class ExecutionEngineService extends Disposable implements IExecutionEngineService {
	declare readonly _serviceBrand: undefined;

	private readonly graphs = new Map<string, ExecutionGraphSnapshot>();
	private readonly sessionToExecution = new Map<string, string>();

	private readonly _onDidUpdateGraph = this._register(new Emitter<ExecutionGraphSnapshot>());
	readonly onDidUpdateGraph = this._onDidUpdateGraph.event;

	private _enabled = false;
	private _maxConcurrentAgents = 8;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IPlanTodoSyncService private readonly planTodoSyncService: IPlanTodoSyncService,
	) {
		super();
	}

	configure(opts: { enabled?: boolean; autoPlanThreshold?: 'low' | 'medium' | 'high'; maxConcurrentAgents?: number }): void {
		if (opts.enabled !== undefined) this._enabled = opts.enabled;
		if (opts.maxConcurrentAgents) this._maxConcurrentAgents = opts.maxConcurrentAgents;
	}

	isEnabled(): boolean {
		return this._enabled;
	}

	async shouldUseEngine(goal: string): Promise<boolean> {
		if (!this._enabled) return false;
		try {
			return Boolean(await this.commandService.executeCommand<boolean>('singularity.execution.shouldUseEngine', goal));
		} catch {
			return goal.trim().length > 80;
		}
	}

	async run(request: ExecutionRunRequest): Promise<ExecutionRunResponse> {
		try {
			const result = await this.commandService.executeCommand<ExecutionRunResponse>('singularity.execution.run', {
				...request,
				maxConcurrentAgents: request.maxConcurrentAgents ?? this._maxConcurrentAgents,
			});
			if (result?.executionId) {
				this.sessionToExecution.set(request.sessionId, result.executionId);
			}
			return result ?? { ok: false, executionId: request.executionId ?? '', summary: 'Execution returned no result' };
		} catch (err) {
			return { ok: false, executionId: request.executionId ?? '', summary: `Execution failed: ${String(err)}` };
		}
	}

	async resume(executionId: string): Promise<ExecutionRunResponse> {
		try {
			const result = await this.commandService.executeCommand<ExecutionRunResponse>('singularity.execution.resume', executionId);
			return result ?? { ok: false, executionId, summary: 'Resume returned no result' };
		} catch (err) {
			return { ok: false, executionId, summary: `Resume failed: ${String(err)}` };
		}
	}

	getGraph(executionId: string): ExecutionGraphSnapshot | undefined {
		return this.graphs.get(executionId);
	}

	getActiveExecution(sessionId: string): string | undefined {
		return this.sessionToExecution.get(sessionId);
	}

	updateGraph(snapshot: ExecutionGraphSnapshot): void {
		this.graphs.set(snapshot.executionId, snapshot);
		this._onDidUpdateGraph.fire(snapshot);
	}

	async projectTodoMd(sessionResource: URI, markdown: string): Promise<void> {
		await this.planTodoSyncService.projectExecutionTodo(sessionResource, markdown);
	}
}
