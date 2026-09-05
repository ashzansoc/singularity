/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import {
	chatTodosToPlanTodos,
	parsePlanDocument,
	planTodosToChatTodos,
	serializePlanDocument,
} from '../../../common/plan/planDocument.js';
import { IChatTodo, IChatTodoListService } from '../../../common/tools/chatTodoListService.js';
import { PlanTodoSyncService } from '../../../common/plan/planTodoSyncService.js';
import { Event } from '../../../../../../base/common/event.js';
import { ITextFileService } from '../../../../../services/textfile/common/textfiles.js';
import { TestContextService } from '../../../../../test/common/workbenchTestServices.js';
import { testWorkspace } from '../../../../../../platform/workspace/test/common/testWorkspace.js';

suite('PlanTodoSyncService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('syncPlanToChatTodos maps frontmatter todos into chat list', () => {
		const session = URI.parse('test://session/1');
		let stored: IChatTodo[] = [];
		const todoService: IChatTodoListService = {
			_serviceBrand: undefined,
			onDidUpdateTodos: Event.None,
			getTodos: () => stored,
			setTodos: (_s, todos) => { stored = todos; },
			migrateTodos: () => { },
		};
		const workspace = new TestContextService(testWorkspace(URI.file('/ws')));
		const sync = new PlanTodoSyncService(todoService, {} as ITextFileService, new NullLogService(), workspace);
		const doc = parsePlanDocument(`---
name: Demo
overview: Demo overview
todos:
  - id: one
    content: First
    status: completed
  - id: two
    content: Second
    status: pending
isProject: false
---

Body
`);
		sync.syncPlanToChatTodos(session, doc);
		assert.strictEqual(stored.length, 2);
		assert.strictEqual(stored[0]!.stringId, 'one');
		assert.strictEqual(stored[0]!.status, 'completed');
		assert.strictEqual(stored[1]!.status, 'not-started');
		assert.deepStrictEqual(chatTodosToPlanTodos(stored).map(t => t.id), ['one', 'two']);
		assert.strictEqual(planTodosToChatTodos(doc.todos).length, 2);
		assert.ok(serializePlanDocument(doc).includes('name: Demo'));
	});
});
