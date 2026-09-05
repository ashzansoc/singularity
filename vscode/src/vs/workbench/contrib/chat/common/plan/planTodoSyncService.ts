/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import {
	IChatTodo,
	IChatTodoListService,
} from '../tools/chatTodoListService.js';
import { sanitizeTodoListWrite } from '../tools/todoListSanitize.js';
import {
	IPlanDocument,
	IPlanTodo,
	chatTodosToPlanTodos,
	isPlanResource,
	parsePlanDocument,
	planTodosToChatTodos,
	serializePlanDocument,
	updatePlanTodos,
} from './planDocument.js';

export const IPlanTodoSyncService = createDecorator<IPlanTodoSyncService>('planTodoSyncService');

export interface IPlanTodoSyncService {
	readonly _serviceBrand: undefined;

	/** Fired when a session's bound plan URI changes. */
	readonly onDidChangePlanUri: Event<URI /* session */>;

	bindPlanUri(sessionResource: URI, planUri: URI): void;
	getPlanUri(sessionResource: URI): URI | undefined;

	/** Apply plan document todos into the chat todo list for a session. */
	syncPlanToChatTodos(sessionResource: URI, doc: IPlanDocument): void;

	/** Called after the plan editor (or other writer) updates a plan file. */
	notifyPlanFileChanged(planUri: URI, doc: IPlanDocument): void;

	/** After manage_todo_list writes session todos, patch the bound plan/todo file. */
	syncChatTodosToPlanFile(sessionResource: URI, todos: readonly IChatTodo[]): Promise<void>;

	/** Load plan file and push todos into the session list. */
	syncPlanFileToChatTodos(sessionResource: URI, planUri: URI): Promise<void>;

	/** Write execution-engine todo.md projection (canonical state is ExecutionStore). */
	projectExecutionTodo(sessionResource: URI, markdown: string): Promise<void>;
}

export class PlanTodoSyncService extends Disposable implements IPlanTodoSyncService {
	declare readonly _serviceBrand: undefined;

	private readonly _sessionToPlan = new Map<string, URI>();
	private readonly _planToSession = new Map<string, URI>();
	private _syncing = false;

	private readonly _onDidChangePlanUri = this._register(new Emitter<URI>());
	readonly onDidChangePlanUri = this._onDidChangePlanUri.event;

	constructor(
		@IChatTodoListService private readonly chatTodoListService: IChatTodoListService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();

		this._register(this.chatTodoListService.onDidUpdateTodos(sessionResource => {
			if (this._syncing) {
				return;
			}
			void this.syncChatTodosToPlanFile(sessionResource, this.chatTodoListService.getTodos(sessionResource));
		}));
	}

	bindPlanUri(sessionResource: URI, planUri: URI): void {
		const sessionKey = sessionResource.toString();
		const planKey = planUri.toString();
		const previous = this._sessionToPlan.get(sessionKey);
		if (previous) {
			this._planToSession.delete(previous.toString());
		}
		this._sessionToPlan.set(sessionKey, planUri);
		this._planToSession.set(planKey, sessionResource);
		this._onDidChangePlanUri.fire(sessionResource);
	}

	getPlanUri(sessionResource: URI): URI | undefined {
		return this._sessionToPlan.get(sessionResource.toString()) ?? this.guessWorkspaceTodoUri();
	}

	syncPlanToChatTodos(sessionResource: URI, doc: IPlanDocument): void {
		const existing = this.chatTodoListService.getTodos(sessionResource);
		const incoming = planTodosToChatTodos(doc.todos) as IChatTodo[];
		const sanitized = sanitizeTodoListWrite(existing, incoming);
		if (sanitized.warnings.length) {
			this.logService.warn('[PlanTodoSync]', sanitized.warnings.join(' '));
		}
		this._syncing = true;
		try {
			this.chatTodoListService.setTodos(sessionResource, sanitized.todos);
		} finally {
			this._syncing = false;
		}
		// Keep todo.md checkboxes aligned without rewriting the whole document format.
		if (sanitized.changed) {
			void this.demoteFalseCompletedCheckboxesInPlanFile(sessionResource);
		}
	}

	/**
	 * When the agent writes a fresh todo.md with every box checked, demote `- [x]` → `- [ ]`
	 * in place so the file matches the sanitized chat todo list.
	 */
	private async demoteFalseCompletedCheckboxesInPlanFile(sessionResource: URI): Promise<void> {
		const planUri = this.getPlanUri(sessionResource);
		if (!planUri || !isPlanResource(planUri)) {
			return;
		}
		if (this._syncing) {
			return;
		}
		this._syncing = true;
		try {
			let text: string;
			try {
				text = (await this.textFileService.read(planUri)).value;
			} catch {
				return;
			}
			const todos = this.chatTodoListService.getTodos(sessionResource);
			const completedTitles = new Set(
				todos.filter(t => t.status === 'completed').map(t => (t.content || t.title).trim().toLowerCase()),
			);
			// If chat list has no completed items after sanitize, clear all checked boxes.
			const patched = text.replace(/^(\s*- \[)([^\]])(\]\s+)(.*)$/gm, (full, open, mark, close, content: string) => {
				if (mark.toLowerCase() !== 'x') {
					return full;
				}
				const title = content.trim().toLowerCase();
				if (completedTitles.size === 0 || !completedTitles.has(title)) {
					return `${open} ${close}${content}`;
				}
				return full;
			});
			if (patched !== text) {
				await this.textFileService.write(planUri, patched);
			}
		} catch (err) {
			this.logService.warn('[PlanTodoSync] failed to demote false-completed checkboxes', planUri.toString(), err);
		} finally {
			this._syncing = false;
		}
	}

	notifyPlanFileChanged(planUri: URI, doc: IPlanDocument): void {
		const session = this._planToSession.get(planUri.toString());
		if (!session) {
			return;
		}
		this.syncPlanToChatTodos(session, doc);
	}

	async syncPlanFileToChatTodos(sessionResource: URI, planUri: URI): Promise<void> {
		this.bindPlanUri(sessionResource, planUri);
		try {
			const text = (await this.textFileService.read(planUri)).value;
			const doc = parsePlanDocument(text);
			this.syncPlanToChatTodos(sessionResource, doc);
		} catch (err) {
			this.logService.warn('[PlanTodoSync] failed to read plan for sync', planUri.toString(), err);
		}
	}

	async syncChatTodosToPlanFile(sessionResource: URI, todos: readonly IChatTodo[]): Promise<void> {
		const planUri = this.getPlanUri(sessionResource);
		if (!planUri || !isPlanResource(planUri)) {
			return;
		}
		if (this._syncing) {
			return;
		}
		this._syncing = true;
		try {
			let text: string;
			try {
				text = (await this.textFileService.read(planUri)).value;
			} catch {
				return;
			}
			const doc = parsePlanDocument(text);
			const planTodos: IPlanTodo[] = chatTodosToPlanTodos(todos);
			const chatIds = new Set(planTodos.map(t => t.id));
			for (const existing of doc.todos) {
				if (existing.status === 'cancelled' && !chatIds.has(existing.id)) {
					planTodos.push(existing);
				}
			}
			const updated = updatePlanTodos(doc, planTodos, {
				name: doc.name,
				overview: doc.overview,
			});
			const serialized = serializePlanDocument(updated);
			if (serialized !== text) {
				await this.textFileService.write(planUri, serialized);
			}
		} catch (err) {
			this.logService.warn('[PlanTodoSync] failed to write plan from chat todos', planUri.toString(), err);
		} finally {
			this._syncing = false;
		}
	}

	private guessWorkspaceTodoUri(): URI | undefined {
		const folder = this.workspaceContextService.getWorkspace().folders[0];
		if (!folder) {
			return undefined;
		}
		return URI.joinPath(folder.uri, 'todo.md');
	}

	async projectExecutionTodo(sessionResource: URI, markdown: string): Promise<void> {
		const planUri = this.getPlanUri(sessionResource) ?? this.guessWorkspaceTodoUri();
		if (!planUri) {
			return;
		}
		this.bindPlanUri(sessionResource, planUri);
		if (this._syncing) {
			return;
		}
		this._syncing = true;
		try {
			await this.textFileService.write(planUri, markdown);
			const doc = parsePlanDocument(markdown);
			this.syncPlanToChatTodos(sessionResource, doc);
		} catch (err) {
			this.logService.warn('[PlanTodoSync] failed to project execution todo', planUri.toString(), err);
		} finally {
			this._syncing = false;
		}
	}
}
