/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { IJSONSchema, IJSONSchemaMap } from '../../../../../../base/common/jsonSchema.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import {
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolResult,
	ToolDataSource,
	IToolInvocationPreparationContext,
	IPreparedToolInvocation,
	ToolInvocationPresentation
} from '../languageModelToolsService.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { IChatTodo, IChatTodoListService } from '../chatTodoListService.js';
import { localize } from '../../../../../../nls.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../../base/common/uri.js';
import { stringIdToNumericId } from '../../plan/planDocument.js';
import { sanitizeTodoListWrite } from '../todoListSanitize.js';

export const ManageTodoListToolToolId = 'manage_todo_list';

export function createManageTodoListToolData(): IToolData {
	const inputSchema: IJSONSchema & { properties: IJSONSchemaMap } = {
		type: 'object',
		properties: {
			todoList: {
				type: 'array',
				description: 'Complete array of all todo items. Must include ALL items - both existing and new.',
				items: {
					type: 'object',
					properties: {
						id: {
							type: ['number', 'string'],
							description: 'Unique identifier for the todo. Prefer stable string ids (e.g. fetch-catalog) that match plan.md frontmatter; sequential numbers are also accepted.'
						},
						title: {
							type: 'string',
							description: 'Concise action-oriented todo label (3-7 words). Displayed in UI. Alias of content.'
						},
						content: {
							type: 'string',
							description: 'Todo description. Prefer this over title when writing Cursor-style plan frontmatter todos.'
						},
						status: {
							type: 'string',
							enum: ['not-started', 'in-progress', 'completed', 'pending', 'in_progress'],
							description: 'not-started/pending: Not begun | in-progress/in_progress: Currently working (max 1) | completed: Fully finished with no blockers'
						},
					},
					required: ['id', 'status']
				}
			}
		},
		required: ['todoList']
	};

	return {
		id: ManageTodoListToolToolId,
		toolReferenceName: 'todo',
		legacyToolReferenceFullNames: ['todos'],
		canBeReferencedInPrompt: true,
		icon: ThemeIcon.fromId(Codicon.checklist.id),
		displayName: localize('tool.manageTodoList.displayName', 'Manage and track todo items for task planning'),
		userDescription: localize('tool.manageTodoList.userDescription', 'Manage and track todo items for task planning'),
		modelDescription: 'Manage a structured todo list to track progress and plan tasks throughout your coding session. Use this tool VERY frequently to ensure task visibility and proper planning.\n\nWhen to use this tool:\n- Complex multi-step work requiring planning and tracking\n- When user provides multiple tasks or requests (numbered/comma-separated)\n- After receiving new instructions that require multiple steps\n- BEFORE starting work on any todo (mark as in-progress)\n- IMMEDIATELY after completing each todo (mark completed individually)\n- When breaking down larger tasks into smaller actionable steps\n- To give users visibility into your progress and planning\n\nWhen NOT to use:\n- Single, trivial tasks that can be completed in one step\n- Purely conversational/informational requests\n- When just reading files or performing simple searches\n\nCRITICAL workflow:\n1. Create the list with ALL items as not-started except optionally ONE in-progress — NEVER create items as completed\n2. Mark ONE todo as in-progress before starting work\n3. Complete the work for that specific todo\n4. Mark ONLY that todo as completed (at most one new completion per write)\n5. Move to next todo and repeat\n\nTodo states:\n- not-started: Todo not yet begun\n- in-progress: Currently working (limit ONE at a time)\n- completed: Finished successfully with concrete evidence of work done\n\nIMPORTANT: Never mark a brand-new list (or many items) completed in one call. Do not batch completions. Writing todo.md with all `- [x]` on create is forbidden.',
		source: ToolDataSource.Internal,
		inputSchema: inputSchema
	};
}

export const ManageTodoListToolData: IToolData = createManageTodoListToolData();

interface IManageTodoListToolInputParams {
	operation?: 'write' | 'read'; // Optional, defaults to 'write'
	todoList: Array<{
		id: number | string;
		title?: string;
		content?: string;
		status: string;
	}>;
	// used for todo read only
	chatSessionResource?: string;
}

export class ManageTodoListTool extends Disposable implements IToolImpl {

	constructor(
		@IChatTodoListService private readonly chatTodoListService: IChatTodoListService,
		@ILogService private readonly logService: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async invoke(invocation: IToolInvocation, _countTokens: any, _progress: any, _token: CancellationToken): Promise<IToolResult> {
		const args = invocation.parameters as IManageTodoListToolInputParams;
		let chatSessionResource = invocation.context?.sessionResource;
		if (!chatSessionResource && args.operation === 'read' && args.chatSessionResource) {
			try {
				chatSessionResource = URI.parse(args.chatSessionResource);
			} catch (error) {
				this.logService.error('ManageTodoListTool: Invalid chatSessionResource URI', error);
			}
		}
		if (!chatSessionResource) {
			return {
				content: [{
					kind: 'text',
					value: 'Error: No session resource available'
				}]
			};
		}

		this.logService.debug(`ManageTodoListTool: Invoking with options ${JSON.stringify(args)}`);

		try {
			if (args.operation === 'read') {
				return this.handleReadOperation(chatSessionResource);
			} else {
				return this.handleWriteOperation(args, chatSessionResource);
			}

		} catch (error) {
			const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
			return {
				content: [{
					kind: 'text',
					value: errorMessage
				}]
			};
		}
	}

	async prepareToolInvocation(context: IToolInvocationPreparationContext, _token: CancellationToken): Promise<IPreparedToolInvocation | undefined> {
		const args = context.parameters as IManageTodoListToolInputParams;
		const chatSessionResource = context.chatSessionResource;
		if (!chatSessionResource) {
			return undefined;
		}

		const currentTodoItems = this.chatTodoListService.getTodos(chatSessionResource);
		let message: string | undefined;

		if (args.operation === 'read') {
			message = localize('todo.readOperation', "Read todo list");
		} else if (args.todoList) {
			message = this.generatePastTenseMessage(currentTodoItems, args.todoList);
		}

		const items = args.todoList ?? currentTodoItems;
		const todoList = items.map(todo => {
			const normalized = 'title' in todo && typeof (todo as IChatTodo).id === 'number'
				? todo as IChatTodo
				: this.normalizeTodo(todo as IManageTodoListToolInputParams['todoList'][number], 0);
			const status = normalized.status === 'completed' || normalized.status === 'in-progress' || normalized.status === 'not-started'
				? normalized.status
				: 'not-started' as const;
			return {
				id: normalized.stringId || normalized.id.toString(),
				title: normalized.content || normalized.title || '',
				status,
			};
		});

		const invocationLabel = message?.replace(/^(Starting|Completed): /i, '') ?? localize('todo.updatingList', "Updating todo list");
		const invocationMessage = new MarkdownString(invocationLabel);

		return {
			invocationMessage,
			presentation: items.length ? undefined : ToolInvocationPresentation.Hidden,
			pastTenseMessage: new MarkdownString(message ?? localize('todo.updatedList', "Updated todo list")),
			toolSpecificData: {
				kind: 'todoList',
				todoList: todoList
			}
		};
	}

	private generatePastTenseMessage(currentTodos: IChatTodo[], newTodos: IManageTodoListToolInputParams['todoList']): string {
		const normalizedNew = newTodos.map(t => this.normalizeTodo(t, 0));
		// If no current todos and we're adding new ones, this is creating new ones.
		// When both lists are empty (a no-op write), fall through to the default
		// "Updated todo list" message rather than showing "Created 0 todos".
		if (currentTodos.length === 0 && normalizedNew.length > 0) {
			return normalizedNew.length === 1
				? localize('todo.created.single', "Created 1 todo")
				: localize('todo.created.multiple', "Created {0} todos", normalizedNew.length);
		}

		// Create map for easier comparison
		const currentTodoMap = new Map(currentTodos.map(todo => [todo.id, todo]));

		// Check for newly started todos (marked as in-progress) - highest priority
		const startedTodos = normalizedNew.filter(newTodo => {
			const currentTodo = currentTodoMap.get(newTodo.id);
			return currentTodo && currentTodo.status !== 'in-progress' && newTodo.status === 'in-progress';
		});

		if (startedTodos.length > 0) {
			const startedTodo = startedTodos[0]!; // Should only be one in-progress at a time
			const totalTodos = normalizedNew.length;
			const currentPosition = normalizedNew.findIndex(todo => todo.id === startedTodo.id) + 1;
			return localize('todo.starting', "Starting: *{0}* ({1}/{2})", startedTodo.title, currentPosition, totalTodos);
		}

		// Check for newly completed todos
		const completedTodos = normalizedNew.filter(newTodo => {
			const currentTodo = currentTodoMap.get(newTodo.id);
			return currentTodo && currentTodo.status !== 'completed' && newTodo.status === 'completed';
		});

		if (completedTodos.length > 0) {
			const completedTodo = completedTodos[0]!; // Get the first completed todo for the message
			const totalTodos = normalizedNew.length;
			const currentPosition = normalizedNew.findIndex(todo => todo.id === completedTodo.id) + 1;
			return localize('todo.completed', "Completed: *{0}* ({1}/{2})", completedTodo.title, currentPosition, totalTodos);
		}

		// Check for new todos added
		const addedTodos = normalizedNew.filter(newTodo => !currentTodoMap.has(newTodo.id));
		if (addedTodos.length > 0) {
			return addedTodos.length === 1
				? localize('todo.added.single', "Added 1 todo")
				: localize('todo.added.multiple', "Added {0} todos", addedTodos.length);
		}

		// Default message for other updates
		return localize('todo.updated', "Updated todo list");
	}

	private handleRead(todoItems: IChatTodo[], sessionResource: URI): string {
		if (todoItems.length === 0) {
			return 'No todo list found.';
		}

		const markdownTaskList = this.formatTodoListAsMarkdownTaskList(todoItems);
		return `# Todo List\n\n${markdownTaskList}`;
	}

	private handleReadOperation(chatSessionResource: URI): IToolResult {
		const todoItems = this.chatTodoListService.getTodos(chatSessionResource);
		const readResult = this.handleRead(todoItems, chatSessionResource);
		const statusCounts = this.calculateStatusCounts(todoItems);

		this.telemetryService.publicLog2<TodoListToolInvokedEvent, TodoListToolInvokedClassification>(
			'todoListToolInvoked',
			{
				operation: 'read',
				notStartedCount: statusCounts.notStartedCount,
				inProgressCount: statusCounts.inProgressCount,
				completedCount: statusCounts.completedCount
			}
		);

		return {
			content: [{
				kind: 'text',
				value: readResult
			}]
		};
	}

	private handleWriteOperation(args: IManageTodoListToolInputParams, chatSessionResource: URI): IToolResult {
		if (!args.todoList) {
			return {
				content: [{
					kind: 'text',
					value: 'Error: todoList is required for write operation'
				}]
			};
		}

		const normalized: IChatTodo[] = args.todoList.map((parsedTodo, index) => this.normalizeTodo(parsedTodo, index));

		const existingTodos = this.chatTodoListService.getTodos(chatSessionResource);
		const sanitized = sanitizeTodoListWrite(existingTodos, normalized);
		const todoList = sanitized.todos;
		const changes = this.calculateTodoChanges(existingTodos, todoList);

		this.chatTodoListService.setTodos(chatSessionResource, todoList);
		const statusCounts = this.calculateStatusCounts(todoList);

		// Build warnings
		const warnings: string[] = [...sanitized.warnings];
		if (todoList.length < 3) {
			warnings.push('Warning: Small todo list (<3 items). This task might not need a todo list.');
		}
		else if (todoList.length > 10) {
			warnings.push('Warning: Large todo list (>10 items). Consider keeping the list focused and actionable.');
		}

		if (changes > 3) {
			warnings.push('Warning: Did you mean to update so many todos at the same time? Consider working on them one by one.');
		}

		this.telemetryService.publicLog2<TodoListToolInvokedEvent, TodoListToolInvokedClassification>(
			'todoListToolInvoked',
			{
				operation: 'write',
				notStartedCount: statusCounts.notStartedCount,
				inProgressCount: statusCounts.inProgressCount,
				completedCount: statusCounts.completedCount
			}
		);

		if (sanitized.changed) {
			this.logService.warn(`ManageTodoListTool: sanitized todo write for ${chatSessionResource.toString()}: ${sanitized.warnings.join(' ')}`);
		}

		return {
			content: [{
				kind: 'text',
				value: `Successfully wrote todo list${warnings.length ? '\n\n' + warnings.join('\n') : ''}`
			}],
			toolMetadata: {
				warnings: warnings
			}
		};
	}

	private calculateStatusCounts(todos: IChatTodo[]): { notStartedCount: number; inProgressCount: number; completedCount: number } {
		const notStartedCount = todos.filter(todo => todo.status === 'not-started').length;
		const inProgressCount = todos.filter(todo => todo.status === 'in-progress').length;
		const completedCount = todos.filter(todo => todo.status === 'completed').length;
		return { notStartedCount, inProgressCount, completedCount };
	}

	private formatTodoListAsMarkdownTaskList(todoList: IChatTodo[]): string {
		if (todoList.length === 0) {
			return '';
		}

		return todoList.map(todo => {
			let checkbox: string;
			switch (todo.status) {
				case 'completed':
					checkbox = '[x]';
					break;
				case 'in-progress':
					checkbox = '[-]';
					break;
				case 'not-started':
				default:
					checkbox = '[ ]';
					break;
			}

			const lines = [`- ${checkbox} ${todo.content || todo.title}`];

			return lines.join('\n');
		}).join('\n');
	}

	private calculateTodoChanges(oldList: IChatTodo[], newList: IChatTodo[]): number {
		// Assume arrays are equivalent in order; compare index-by-index
		let modified = 0;
		const minLen = Math.min(oldList.length, newList.length);
		for (let i = 0; i < minLen; i++) {
			const o = oldList[i]!;
			const n = newList[i]!;
			if (o.title !== n.title || o.status !== n.status || o.content !== n.content || o.stringId !== n.stringId) {
				modified++;
			}
		}

		const added = Math.max(0, newList.length - oldList.length);
		const removed = Math.max(0, oldList.length - newList.length);
		const totalChanges = added + removed + modified;
		return totalChanges;
	}

	private normalizeTodo(parsedTodo: IManageTodoListToolInputParams['todoList'][number], index: number): IChatTodo {
		const stringId = typeof parsedTodo.id === 'string' ? parsedTodo.id : undefined;
		const numericId = typeof parsedTodo.id === 'number' ? parsedTodo.id : stringIdToNumericId(stringId || `todo-${index + 1}`);
		const label = (parsedTodo.content || parsedTodo.title || stringId || `Todo ${index + 1}`).trim();
		const raw = (parsedTodo.status || 'pending').toLowerCase().replace(/-/g, '_');
		let status: IChatTodo['status'] = 'not-started';
		if (raw === 'completed') {
			status = 'completed';
		} else if (raw === 'in_progress') {
			status = 'in-progress';
		}
		return {
			id: numericId,
			title: label,
			content: parsedTodo.content || label,
			status,
			...(stringId ? { stringId } : {}),
		};
	}
}

type TodoListToolInvokedEvent = {
	operation: 'read' | 'write';
	notStartedCount: number;
	inProgressCount: number;
	completedCount: number;
};

type TodoListToolInvokedClassification = {
	operation: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The operation performed on the todo list (read or write).' };
	notStartedCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of tasks with not-started status.' };
	inProgressCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of tasks with in-progress status.' };
	completedCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of tasks with completed status.' };
	owner: 'bhavyaus';
	comment: 'Provides insight into the usage of the todo list tool including detailed task status distribution.';
};
