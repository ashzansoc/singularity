/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import {
	chatTodosToPlanTodos,
	isPlanResource,
	parsePlanDocument,
	planTodosToChatTodos,
	serializePlanDocument,
	updatePlanTodos,
} from '../../../common/plan/planDocument.js';

suite('planDocument', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses Cursor-style frontmatter with todos', () => {
		const text = `---
name: Agency Design Skills
overview: "Wire design-lane agents into Spec generation"
todos:
  - id: fetch-catalog
    content: Add fetch script + vendor skills
    status: completed
  - id: skill-modules
    content: Implement agencySkill.ts
    status: in_progress
  - id: tests
    content: Add unit tests
    status: pending
isProject: false
---

# Agency Design Skills

## Decisions locked
- **Scope:** Design lane only
`;
		const doc = parsePlanDocument(text);
		assert.strictEqual(doc.hasFrontmatter, true);
		assert.strictEqual(doc.name, 'Agency Design Skills');
		assert.strictEqual(doc.overview, 'Wire design-lane agents into Spec generation');
		assert.strictEqual(doc.isProject, false);
		assert.strictEqual(doc.todos.length, 3);
		assert.deepStrictEqual(doc.todos[0], {
			id: 'fetch-catalog',
			content: 'Add fetch script + vendor skills',
			status: 'completed',
		});
		assert.strictEqual(doc.todos[1]!.status, 'in_progress');
		assert.strictEqual(doc.todos[2]!.status, 'pending');
		assert.ok(doc.body.includes('## Decisions locked'));
	});

	test('round-trips serialize → parse', () => {
		const original = parsePlanDocument(`---
name: Round Trip
overview: Check serialization
todos:
  - id: a
    content: First
    status: pending
  - id: b
    content: Second with: colon
    status: completed
isProject: true
---

## Body

Hello
`);
		const serialized = serializePlanDocument(original);
		const again = parsePlanDocument(serialized);
		assert.strictEqual(again.name, original.name);
		assert.strictEqual(again.overview, original.overview);
		assert.strictEqual(again.isProject, true);
		assert.deepStrictEqual([...again.todos], [...original.todos]);
		assert.ok(again.body.includes('## Body'));
		assert.ok(again.body.includes('Hello'));
	});

	test('legacy plain markdown synthesizes name from heading', () => {
		const doc = parsePlanDocument(`## Plan: Click-edit stock

Do the thing.

**Steps**
1. First
`);
		assert.strictEqual(doc.hasFrontmatter, false);
		assert.strictEqual(doc.name, 'Click-edit stock');
		assert.strictEqual(doc.todos.length, 0);
		assert.ok(doc.body.includes('Do the thing'));
	});

	test('empty todos array', () => {
		const doc = parsePlanDocument(`---
name: Empty
overview: none
todos: []
isProject: false
---

Body only
`);
		assert.strictEqual(doc.todos.length, 0);
		assert.ok(doc.body.includes('Body only'));
	});

	test('updatePlanTodos preserves body', () => {
		const doc = parsePlanDocument(`---
name: X
overview: Y
todos:
  - id: a
    content: A
    status: pending
isProject: false
---

Keep me
`);
		const updated = updatePlanTodos(doc, [
			{ id: 'a', content: 'A done', status: 'completed' },
			{ id: 'b', content: 'B', status: 'pending' },
		]);
		assert.strictEqual(updated.body.includes('Keep me'), true);
		assert.strictEqual(updated.todos.length, 2);
		assert.strictEqual(updated.todos[0]!.status, 'completed');
	});

	test('maps plan todos to chat todos and back', () => {
		const planTodos = [
			{ id: 'fetch-catalog', content: 'Fetch', status: 'completed' as const },
			{ id: 'cancelled-one', content: 'Skip', status: 'cancelled' as const },
			{ id: 'work', content: 'Work', status: 'in_progress' as const },
		];
		const chat = planTodosToChatTodos(planTodos);
		assert.strictEqual(chat.length, 2);
		assert.strictEqual(chat[0]!.status, 'completed');
		assert.strictEqual(chat[0]!.stringId, 'fetch-catalog');
		assert.strictEqual(chat[1]!.status, 'in-progress');

		const back = chatTodosToPlanTodos(chat);
		assert.strictEqual(back[0]!.id, 'fetch-catalog');
		assert.strictEqual(back[0]!.status, 'completed');
		assert.strictEqual(back[1]!.status, 'in_progress');
	});

	test('isPlanResource matches plan.md, *.plan.md, and todo.md', () => {
		assert.strictEqual(isPlanResource({ path: '/memories/session/plan.md' }), true);
		assert.strictEqual(isPlanResource({ path: '/ws/.cursor/plans/foo.plan.md' }), true);
		assert.strictEqual(isPlanResource({ path: '/ws/todo.md' }), true);
		assert.strictEqual(isPlanResource({ path: '/ws/readme.md' }), false);
		assert.strictEqual(isPlanResource({ path: '/ws/myplan.md' }), false);
	});

	test('parses agent-mode todo.md Goal + Checklist', () => {
		const text = `# RoboHello - Hello World Page

++Goal:++ Create a single 'index.html' file that renders a robotics-themed hello world landing page.

## Checklist
- [x] Create todo.md plan
- [ ] Build index.html with:
  - Navigation (sticky header)
  - Hero section with custom SVG
- [ ] Verify page in browser

## Notes
Keep the design-spec in sync.
`;
		const doc = parsePlanDocument(text);
		assert.strictEqual(doc.format, 'todoMd');
		assert.strictEqual(doc.name, 'RoboHello - Hello World Page');
		assert.ok(doc.overview.includes('index.html'));
		assert.strictEqual(doc.todos.length, 3);
		assert.strictEqual(doc.todos[0]!.status, 'completed');
		assert.strictEqual(doc.todos[0]!.content, 'Create todo.md plan');
		assert.strictEqual(doc.todos[1]!.status, 'pending');
		assert.ok(doc.todos[1]!.content.includes('Build index.html'));
		assert.ok(doc.todos[1]!.content.includes('Navigation'));
		assert.strictEqual(doc.todos[2]!.content, 'Verify page in browser');
		assert.ok(doc.body.includes('## Notes'));
	});

	test('round-trips todo.md serialize → parse', () => {
		const original = parsePlanDocument(`# Demo Todo

++Goal:++ Ship the feature

## Checklist
- [x] Done item
- [-] Active item
- [ ] Next item
`);
		const serialized = serializePlanDocument(original);
		const again = parsePlanDocument(serialized);
		assert.strictEqual(again.format, 'todoMd');
		assert.strictEqual(again.name, 'Demo Todo');
		assert.strictEqual(again.overview, 'Ship the feature');
		assert.strictEqual(again.todos.length, 3);
		assert.strictEqual(again.todos[0]!.status, 'completed');
		assert.strictEqual(again.todos[1]!.status, 'in_progress');
		assert.strictEqual(again.todos[2]!.status, 'pending');
	});

	test('updatePlanTodos preserves todoMd format', () => {
		const doc = parsePlanDocument(`# X

++Goal:++ Y

## Checklist
- [ ] A
`);
		const updated = updatePlanTodos(doc, [
			{ id: 'a', content: 'A', status: 'completed' },
		]);
		assert.strictEqual(updated.format, 'todoMd');
		const text = serializePlanDocument(updated);
		assert.ok(text.includes('# X'));
		assert.ok(text.includes('++Goal:++ Y'));
		assert.ok(text.includes('- [x] A'));
		assert.ok(!text.startsWith('---'));
	});
});
