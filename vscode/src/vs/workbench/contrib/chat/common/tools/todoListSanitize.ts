/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatTodo } from './chatTodoListService.js';

export interface ITodoListSanitizeResult {
	todos: IChatTodo[];
	warnings: string[];
	/** True when any status was coerced away from the model's request. */
	changed: boolean;
}

/**
 * Prevents the common agent failure mode of creating a plan and immediately
 * marking every item completed (or batch-completing many items in one write).
 *
 * Rules:
 * - On create (empty existing list): no item may be `completed`; at most one `in-progress`.
 * - On update: at most one newly completed item per write; at most one `in-progress`.
 * - Jumping from zero completed → all completed in one write (list size ≥ 3) is treated as create abuse.
 */
export function sanitizeTodoListWrite(
	existing: readonly IChatTodo[],
	incoming: readonly IChatTodo[],
	options?: { maxNewCompletionsPerWrite?: number },
): ITodoListSanitizeResult {
	const maxNewCompletions = options?.maxNewCompletionsPerWrite ?? 1;
	const warnings: string[] = [];
	const todos = incoming.map(t => ({ ...t }));

	if (todos.length === 0) {
		return { todos, warnings, changed: false };
	}

	const existingByKey = new Map<string, IChatTodo>();
	for (const todo of existing) {
		existingByKey.set(todoKey(todo), todo);
		if (todo.stringId) {
			existingByKey.set(`s:${todo.stringId}`, todo);
		}
		existingByKey.set(`id:${todo.id}`, todo);
	}

	const findExisting = (todo: IChatTodo): IChatTodo | undefined =>
		existingByKey.get(todoKey(todo))
		?? (todo.stringId ? existingByKey.get(`s:${todo.stringId}`) : undefined)
		?? existingByKey.get(`id:${todo.id}`);

	const isCreate = existing.length === 0;
	const existingCompleted = existing.filter(t => t.status === 'completed').length;
	const incomingCompleted = todos.filter(t => t.status === 'completed').length;
	const bulkCompleteOnFreshList = !isCreate
		&& existingCompleted === 0
		&& incomingCompleted === todos.length
		&& todos.length >= 3;

	let changed = false;

	if (isCreate || bulkCompleteOnFreshList) {
		let completedDemoted = 0;
		for (const todo of todos) {
			if (todo.status === 'completed') {
				todo.status = 'not-started';
				completedDemoted++;
				changed = true;
			}
		}
		if (completedDemoted > 0) {
			warnings.push(
				`Corrected ${completedDemoted} todo(s) that were marked completed when creating/updating the list. New items must start as not-started (or one in-progress); mark completed only after finishing the work.`,
			);
		}
	} else {
		let newCompletions = 0;
		for (const todo of todos) {
			if (todo.status !== 'completed') {
				continue;
			}
			const prev = findExisting(todo);
			const wasCompleted = prev?.status === 'completed';
			if (wasCompleted) {
				continue;
			}
			newCompletions++;
			if (newCompletions > maxNewCompletions) {
				todo.status = prev?.status === 'in-progress' ? 'in-progress' : 'not-started';
				changed = true;
			}
		}
		if (newCompletions > maxNewCompletions) {
			warnings.push(
				`Only ${maxNewCompletions} todo may be marked completed per update (attempted ${newCompletions}). Finish and check off tasks one at a time.`,
			);
		}
	}

	// Enforce at most one in-progress
	let sawInProgress = false;
	let demotedInProgress = 0;
	for (const todo of todos) {
		if (todo.status !== 'in-progress') {
			continue;
		}
		if (!sawInProgress) {
			sawInProgress = true;
			continue;
		}
		todo.status = 'not-started';
		demotedInProgress++;
		changed = true;
	}
	if (demotedInProgress > 0) {
		warnings.push('Only one todo may be in-progress at a time; extra in-progress items were reset to not-started.');
	}

	return { todos, warnings, changed };
}

function todoKey(todo: IChatTodo): string {
	const title = (todo.content || todo.title || '').trim().toLowerCase();
	return `t:${title}`;
}
