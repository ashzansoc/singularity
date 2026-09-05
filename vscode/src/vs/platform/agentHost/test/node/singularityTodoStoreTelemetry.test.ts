/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getSingularityTodoStoreOperationData } from '../../node/singularity/singularityTodoStoreTelemetry.js';

suite('singularityTodoStoreTelemetry', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies SQL operation and target', () => {
		const query = (value: string): Record<string, unknown> => ({ query: value });
		assert.deepStrictEqual({
			readTodos: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM todos')),
			writeTodoDeps: getSingularityTodoStoreOperationData('sql', query('DELETE FROM todo_deps WHERE todo_id = 1')),
			readBoth: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM todos JOIN todo_deps ON todo_deps.todo_id = todos.id')),
			mixedBoth: getSingularityTodoStoreOperationData('sql', query('INSERT INTO todos SELECT * FROM todo_deps')),
			readTodosWhileWritingElsewhere: getSingularityTodoStoreOperationData('sql', query('INSERT INTO archive SELECT * FROM todos')),
			writeTodosWhileReadingElsewhere: getSingularityTodoStoreOperationData('sql', query('INSERT INTO todos SELECT * FROM archive')),
			quotedAndQualified: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM main."todos", [todo_deps]')),
			derivedTableAlias: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM (SELECT * FROM files) AS todos')),
			tableNameInLiteral: getSingularityTodoStoreOperationData('sql', query('SELECT \'todos\', \'todo_deps\'')),
			tableNameInInsertedLiteral: getSingularityTodoStoreOperationData('sql', query('INSERT INTO files(name) VALUES (\'todos\')')),
			verbInLiteral: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM todos WHERE title = \'update todo_deps\'')),
			namesInComments: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM files -- JOIN todos\n/* UPDATE todo_deps */')),
			unclassified: getSingularityTodoStoreOperationData('sql', query('PRAGMA table_info(todos)')),
			unrelatedSql: getSingularityTodoStoreOperationData('sql', query('SELECT * FROM files')),
			unrelatedTool: getSingularityTodoStoreOperationData('bash', { command: 'echo todos' }),
		}, {
			readTodos: {
				operation: 'read',
				target: 'todos',
			},
			writeTodoDeps: {
				operation: 'write',
				target: 'todo_deps',
			},
			readBoth: {
				operation: 'read',
				target: 'both',
			},
			mixedBoth: {
				operation: 'mixed',
				target: 'both',
			},
			readTodosWhileWritingElsewhere: {
				operation: 'read',
				target: 'todos',
			},
			writeTodosWhileReadingElsewhere: {
				operation: 'write',
				target: 'todos',
			},
			quotedAndQualified: {
				operation: 'read',
				target: 'both',
			},
			derivedTableAlias: undefined,
			tableNameInLiteral: undefined,
			tableNameInInsertedLiteral: undefined,
			verbInLiteral: {
				operation: 'read',
				target: 'todos',
			},
			namesInComments: undefined,
			unclassified: undefined,
			unrelatedSql: undefined,
			unrelatedTool: undefined,
		});
	});
});
