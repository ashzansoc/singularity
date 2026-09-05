/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IChatTodo } from '../../../common/tools/chatTodoListService.js';
import { sanitizeTodoListWrite } from '../../../common/tools/todoListSanitize.js';

suite('sanitizeTodoListWrite', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function todo(id: number, title: string, status: IChatTodo['status']): IChatTodo {
		return { id, title, content: title, status };
	}

	test('create: demotes all completed items to not-started', () => {
		const result = sanitizeTodoListWrite([], [
			todo(1, 'Scaffold app', 'completed'),
			todo(2, 'Build pages', 'completed'),
			todo(3, 'Verify build', 'completed'),
		]);
		assert.strictEqual(result.changed, true);
		assert.deepStrictEqual(result.todos.map(t => t.status), ['not-started', 'not-started', 'not-started']);
		assert.ok(result.warnings.some(w => /completed/i.test(w)));
	});

	test('create: allows one in-progress and demotes extras', () => {
		const result = sanitizeTodoListWrite([], [
			todo(1, 'Scaffold app', 'in-progress'),
			todo(2, 'Build pages', 'in-progress'),
			todo(3, 'Verify build', 'not-started'),
		]);
		assert.strictEqual(result.changed, true);
		assert.deepStrictEqual(result.todos.map(t => t.status), ['in-progress', 'not-started', 'not-started']);
	});

	test('update: allows at most one new completion per write', () => {
		const existing = [
			todo(1, 'Scaffold app', 'in-progress'),
			todo(2, 'Build pages', 'not-started'),
			todo(3, 'Verify build', 'not-started'),
		];
		const result = sanitizeTodoListWrite(existing, [
			todo(1, 'Scaffold app', 'completed'),
			todo(2, 'Build pages', 'completed'),
			todo(3, 'Verify build', 'completed'),
		]);
		assert.strictEqual(result.changed, true);
		assert.strictEqual(result.todos[0]!.status, 'completed');
		assert.strictEqual(result.todos[1]!.status, 'not-started');
		assert.strictEqual(result.todos[2]!.status, 'not-started');
	});

	test('update: preserves already-completed items', () => {
		const existing = [
			todo(1, 'Scaffold app', 'completed'),
			todo(2, 'Build pages', 'in-progress'),
			todo(3, 'Verify build', 'not-started'),
		];
		const result = sanitizeTodoListWrite(existing, [
			todo(1, 'Scaffold app', 'completed'),
			todo(2, 'Build pages', 'completed'),
			todo(3, 'Verify build', 'in-progress'),
		]);
		assert.strictEqual(result.changed, false);
		assert.deepStrictEqual(result.todos.map(t => t.status), ['completed', 'completed', 'in-progress']);
	});

	test('bulk complete on fresh list is demoted', () => {
		const existing = [
			todo(1, 'A', 'not-started'),
			todo(2, 'B', 'not-started'),
			todo(3, 'C', 'not-started'),
		];
		const result = sanitizeTodoListWrite(existing, [
			todo(1, 'A', 'completed'),
			todo(2, 'B', 'completed'),
			todo(3, 'C', 'completed'),
		]);
		assert.strictEqual(result.changed, true);
		assert.deepStrictEqual(result.todos.map(t => t.status), ['not-started', 'not-started', 'not-started']);
	});
});
