/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Plan / todo document model.
 *
 * Formats:
 * 1. Cursor YAML frontmatter (`plan.md` / `*.plan.md`)
 * 2. Agent-mode workspace `todo.md` (H1 + ++Goal:++ + ## Checklist with `- [ ]` / `- [x]`)
 */

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** How the source file is serialized. */
export type PlanDocumentFormat = 'frontmatter' | 'todoMd' | 'legacy';

export interface IPlanTodo {
	readonly id: string;
	readonly content: string;
	readonly status: PlanTodoStatus;
}

export interface IPlanDocument {
	readonly name: string;
	readonly overview: string;
	readonly todos: readonly IPlanTodo[];
	readonly isProject: boolean;
	readonly body: string;
	/** True when the source had a YAML frontmatter block. */
	readonly hasFrontmatter: boolean;
	/** Serialization format for round-trips. */
	readonly format: PlanDocumentFormat;
}

export const PLAN_EDITOR_ID = 'singularity.plan.editor';
export const PLAN_EDITOR_INPUT_ID = 'workbench.input.plan';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;
const HEADING_RE = /^#{1,2}\s+(.+)$/m;
const H1_RE = /^#\s+(.+)$/m;
const GOAL_RE = /^\+\+Goal:\+\+\s*(.+)$/im;
const CHECKBOX_RE = /^(\s*)-\s+\[([ xX~\-])\]\s+(.*)$/;

const VALID_STATUSES = new Set<PlanTodoStatus>(['pending', 'in_progress', 'completed', 'cancelled']);

export function isPlanResource(resource: { path: string; fsPath?: string } | undefined | null): boolean {
	if (!resource) {
		return false;
	}
	const path = (resource.path || resource.fsPath || '').replace(/\\/g, '/');
	const base = path.split('/').pop() ?? '';
	return base === 'plan.md' || base === 'todo.md' || base.endsWith('.plan.md');
}

export function isTodoMdResource(resource: { path: string; fsPath?: string } | undefined | null): boolean {
	if (!resource) {
		return false;
	}
	const path = (resource.path || resource.fsPath || '').replace(/\\/g, '/');
	const base = path.split('/').pop() ?? '';
	return base === 'todo.md';
}

export function parsePlanDocument(text: string): IPlanDocument {
	const match = text.match(FRONTMATTER_RE);
	if (match) {
		const yaml = match[1] ?? '';
		const body = (match[2] ?? '').replace(/^\r?\n/, '');
		const name = readScalar(yaml, 'name') ?? synthesizeName(body) ?? 'Plan';
		const overview = readScalar(yaml, 'overview') ?? '';
		const isProject = readBoolean(yaml, 'isProject') ?? false;
		const todos = parseYamlTodos(yaml);

		return {
			name,
			overview,
			todos,
			isProject,
			body,
			hasFrontmatter: true,
			format: 'frontmatter',
		};
	}

	if (looksLikeTodoMd(text)) {
		return parseTodoMd(text);
	}

	return parseLegacyPlan(text);
}

export function serializePlanDocument(doc: IPlanDocument): string {
	if (doc.format === 'todoMd') {
		return serializeTodoMd(doc);
	}
	return serializeFrontmatter(doc);
}

/** Patch todos (and optionally name/overview) while preserving body, format, and other fields. */
export function updatePlanTodos(doc: IPlanDocument, todos: readonly IPlanTodo[], extras?: Partial<Pick<IPlanDocument, 'name' | 'overview' | 'isProject'>>): IPlanDocument {
	return {
		name: extras?.name ?? doc.name,
		overview: extras?.overview ?? doc.overview,
		isProject: extras?.isProject ?? doc.isProject,
		todos: todos.map(t => ({ id: t.id, content: t.content, status: normalizeStatus(t.status) })),
		body: doc.body,
		hasFrontmatter: doc.format === 'frontmatter',
		format: doc.format === 'legacy' ? 'frontmatter' : doc.format,
	};
}

export function planTodoProgress(todos: readonly IPlanTodo[]): { completed: number; total: number; label: string } {
	const active = todos.filter(t => t.status !== 'cancelled');
	const completed = active.filter(t => t.status === 'completed').length;
	const total = active.length;
	return { completed, total, label: `${completed}/${total}` };
}

// --- chat todo mapping ------------------------------------------------------

export type ChatTodoStatus = 'not-started' | 'in-progress' | 'completed';

export interface IChatTodoLike {
	id: number;
	title: string;
	status: ChatTodoStatus;
	/** Stable string id from plan frontmatter when present. */
	stringId?: string;
	content?: string;
}

export function planStatusToChat(status: PlanTodoStatus): ChatTodoStatus | undefined {
	switch (status) {
		case 'pending':
			return 'not-started';
		case 'in_progress':
			return 'in-progress';
		case 'completed':
			return 'completed';
		case 'cancelled':
			return undefined;
	}
}

export function chatStatusToPlan(status: ChatTodoStatus): PlanTodoStatus {
	switch (status) {
		case 'not-started':
			return 'pending';
		case 'in-progress':
			return 'in_progress';
		case 'completed':
			return 'completed';
	}
}

export function planTodosToChatTodos(todos: readonly IPlanTodo[]): IChatTodoLike[] {
	const result: IChatTodoLike[] = [];
	let numericId = 1;
	for (const todo of todos) {
		const chatStatus = planStatusToChat(todo.status);
		if (!chatStatus) {
			continue;
		}
		result.push({
			id: numericId++,
			title: todo.content,
			content: todo.content,
			status: chatStatus,
			stringId: todo.id,
		});
	}
	return result;
}

export function chatTodosToPlanTodos(todos: readonly IChatTodoLike[]): IPlanTodo[] {
	return todos.map((todo, index) => ({
		id: todo.stringId || `todo-${todo.id || index + 1}`,
		content: todo.content || todo.title,
		status: chatStatusToPlan(todo.status),
	}));
}

export function stringIdToNumericId(stringId: string): number {
	let hash = 0;
	for (let i = 0; i < stringId.length; i++) {
		hash = ((hash << 5) - hash + stringId.charCodeAt(i)) | 0;
	}
	const positive = Math.abs(hash);
	return positive === 0 ? 1 : positive;
}

export function slugifyTodoId(content: string, used: Set<string>): string {
	let base = content
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
	if (!base) {
		base = 'todo';
	}
	let id = base;
	let n = 2;
	while (used.has(id)) {
		id = `${base}-${n++}`;
	}
	used.add(id);
	return id;
}

// --- todo.md ----------------------------------------------------------------

function looksLikeTodoMd(text: string): boolean {
	if (/^##\s+(Checklist|Tasks)\b/im.test(text)) {
		return true;
	}
	if (GOAL_RE.test(text)) {
		return true;
	}
	// At least one markdown task checkbox
	return /^(\s*)-\s+\[[ xX~\-]\]\s+/m.test(text);
}

function parseTodoMd(text: string): IPlanDocument {
	const name = (text.match(H1_RE)?.[1] ?? synthesizeName(text) ?? 'Todo').trim();
	const overview = (text.match(GOAL_RE)?.[1] ?? '').trim();
	const { todos, body } = extractChecklist(text, name, overview);

	return {
		name,
		overview,
		todos,
		isProject: false,
		body,
		hasFrontmatter: false,
		format: 'todoMd',
	};
}

function extractChecklist(text: string, name: string, overview: string): { todos: IPlanTodo[]; body: string } {
	const lines = text.split(/\r?\n/);
	const todos: IPlanTodo[] = [];
	const bodyLines: string[] = [];
	const usedIds = new Set<string>();
	let inChecklist = false;
	let checklistStarted = false;
	let sawChecklistHeading = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		// Skip the primary H1 title line (re-emitted on serialize)
		if (!checklistStarted && /^#\s+/.test(line) && line.replace(/^#\s+/, '').trim() === name) {
			continue;
		}
		// Skip Goal line (re-emitted on serialize)
		if (!checklistStarted && GOAL_RE.test(line)) {
			continue;
		}

		if (/^##\s+(Checklist|Tasks)\b/i.test(line)) {
			inChecklist = true;
			checklistStarted = true;
			sawChecklistHeading = true;
			continue;
		}

		if (inChecklist) {
			// Next ## section ends the checklist
			if (/^##\s+/.test(line) && !/^##\s+(Checklist|Tasks)\b/i.test(line)) {
				inChecklist = false;
				bodyLines.push(line);
				continue;
			}

			const checkbox = line.match(CHECKBOX_RE);
			if (checkbox) {
				const indent = checkbox[1]!.length;
				const mark = checkbox[2]!;
				const content = checkbox[3]!.trim();
				// Collect nested non-checkbox continuation lines into content
				let fullContent = content;
				let j = i + 1;
				while (j < lines.length) {
					const next = lines[j]!;
					if (CHECKBOX_RE.test(next) || /^##\s+/.test(next) || /^#\s+/.test(next)) {
						break;
					}
					// Nested bullet / indented detail under this item
					if (/^\s+\S/.test(next) || next.trim() === '') {
						if (next.trim() !== '') {
							fullContent += '\n' + next.trim();
						}
						j++;
						continue;
					}
					break;
				}
				i = j - 1;
				todos.push({
					id: slugifyTodoId(content, usedIds),
					content: fullContent,
					status: checkboxMarkToStatus(mark),
				});
				// indent unused but kept for potential future nesting UI
				void indent;
				continue;
			}

			// Non-checkbox lines inside checklist (rare) — skip blanks, else leave for body after checklist
			if (line.trim() === '') {
				continue;
			}
			continue;
		}

		// Also treat orphan checkbox lists (no ## Checklist heading) as todos when at start
		if (!sawChecklistHeading) {
			const checkbox = line.match(CHECKBOX_RE);
			if (checkbox && checkbox[1]!.length === 0) {
				checklistStarted = true;
				const content = checkbox[3]!.trim();
				todos.push({
					id: slugifyTodoId(content, usedIds),
					content,
					status: checkboxMarkToStatus(checkbox[2]!),
				});
				continue;
			}
		}

		bodyLines.push(line);
	}

	// Trim leading/trailing blank lines in body
	while (bodyLines.length > 0 && bodyLines[0]!.trim() === '') {
		bodyLines.shift();
	}
	while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === '') {
		bodyLines.pop();
	}

	return { todos, body: bodyLines.join('\n') };
}

function checkboxMarkToStatus(mark: string): PlanTodoStatus {
	const m = mark.toLowerCase();
	if (m === 'x') {
		return 'completed';
	}
	if (m === '-' || m === '~') {
		return 'in_progress';
	}
	return 'pending';
}

function statusToCheckboxMark(status: PlanTodoStatus): string {
	switch (status) {
		case 'completed':
			return 'x';
		case 'in_progress':
			return '-';
		case 'cancelled':
			return ' ';
		case 'pending':
		default:
			return ' ';
	}
}

function serializeTodoMd(doc: IPlanDocument): string {
	const lines: string[] = [];
	lines.push(`# ${doc.name}`);
	lines.push('');
	if (doc.overview) {
		lines.push(`++Goal:++ ${doc.overview}`);
		lines.push('');
	}
	lines.push('## Checklist');
	for (const todo of doc.todos) {
		if (todo.status === 'cancelled') {
			continue;
		}
		const mark = statusToCheckboxMark(todo.status);
		const [first, ...rest] = todo.content.split(/\r?\n/);
		lines.push(`- [${mark}] ${first ?? todo.id}`);
		for (const detail of rest) {
			if (detail.trim()) {
				lines.push(`  - ${detail.trim()}`);
			}
		}
	}
	const body = doc.body.replace(/^\r?\n/, '').trimEnd();
	if (body) {
		lines.push('');
		lines.push(body);
	}
	lines.push('');
	return lines.join('\n');
}

// --- frontmatter / legacy ---------------------------------------------------

function serializeFrontmatter(doc: IPlanDocument): string {
	const lines: string[] = ['---'];
	lines.push(`name: ${yamlQuote(doc.name)}`);
	if (doc.overview) {
		lines.push(`overview: ${yamlQuote(doc.overview)}`);
	}
	if (doc.todos.length === 0) {
		lines.push('todos: []');
	} else {
		lines.push('todos:');
		for (const todo of doc.todos) {
			lines.push(`  - id: ${yamlQuote(todo.id)}`);
			lines.push(`    content: ${yamlQuote(todo.content)}`);
			lines.push(`    status: ${todo.status}`);
		}
	}
	lines.push(`isProject: ${doc.isProject ? 'true' : 'false'}`);
	lines.push('---');
	lines.push('');
	const body = doc.body.replace(/^\r?\n/, '');
	return body.length > 0 ? `${lines.join('\n')}${body.endsWith('\n') ? body : `${body}\n`}` : `${lines.join('\n')}\n`;
}

function parseLegacyPlan(text: string): IPlanDocument {
	const name = synthesizeName(text) ?? 'Plan';
	return {
		name,
		overview: '',
		todos: [],
		isProject: false,
		body: text,
		hasFrontmatter: false,
		format: 'legacy',
	};
}

function synthesizeName(body: string): string | undefined {
	const m = body.match(HEADING_RE);
	if (!m) {
		return undefined;
	}
	return m[1]!.trim().replace(/^Plan:\s*/i, '');
}

function normalizeStatus(status: string): PlanTodoStatus {
	const normalized = status.trim().toLowerCase().replace(/-/g, '_');
	if (normalized === 'not_started') {
		return 'pending';
	}
	if (VALID_STATUSES.has(normalized as PlanTodoStatus)) {
		return normalized as PlanTodoStatus;
	}
	return 'pending';
}

function yamlQuote(value: string): string {
	if (value === '') {
		return '""';
	}
	if (/[:#\[\]{},&*?|>!%@`]/.test(value) || /[\r\n]/.test(value) || value.startsWith(' ') || value.endsWith(' ') || value.includes('"') || value.includes("'")) {
		return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
	}
	return value;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		const inner = trimmed.slice(1, -1);
		if (trimmed.startsWith('"')) {
			return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
		}
		return inner;
	}
	return trimmed;
}

function readScalar(yaml: string, key: string): string | undefined {
	const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
	const m = yaml.match(re);
	if (!m) {
		return undefined;
	}
	const raw = m[1]!.trim();
	if (raw === '' || raw === '|' || raw === '>') {
		return undefined;
	}
	return unquote(raw);
}

function readBoolean(yaml: string, key: string): boolean | undefined {
	const value = readScalar(yaml, key);
	if (value === undefined) {
		return undefined;
	}
	if (value === 'true') {
		return true;
	}
	if (value === 'false') {
		return false;
	}
	return undefined;
}

function parseYamlTodos(yaml: string): IPlanTodo[] {
	const lines = yaml.split(/\r?\n/);
	const todos: IPlanTodo[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		if (/^todos:\s*\[\s*\]\s*$/.test(line)) {
			return [];
		}
		if (/^todos:\s*$/.test(line)) {
			i++;
			while (i < lines.length) {
				const itemLine = lines[i]!;
				const itemMatch = itemLine.match(/^\s*-\s+(?:id:\s*(.+)|(.+))$/);
				if (!itemMatch) {
					if (/^\S/.test(itemLine) && !/^\s/.test(itemLine)) {
						break;
					}
					if (itemLine.trim() === '') {
						i++;
						continue;
					}
					if (!/^\s/.test(itemLine)) {
						break;
					}
					i++;
					continue;
				}

				let id = '';
				let content = '';
				let status: PlanTodoStatus = 'pending';

				if (itemMatch[1] !== undefined) {
					id = unquote(itemMatch[1]);
				} else if (itemMatch[2] !== undefined) {
					content = unquote(itemMatch[2]);
					id = `todo-${todos.length + 1}`;
				}

				i++;
				while (i < lines.length) {
					const prop = lines[i]!;
					const propMatch = prop.match(/^\s{2,}(id|content|status):\s*(.*)$/);
					if (!propMatch) {
						break;
					}
					const propKey = propMatch[1]!;
					const propVal = unquote(propMatch[2] ?? '');
					if (propKey === 'id') {
						id = propVal;
					} else if (propKey === 'content') {
						content = propVal;
					} else if (propKey === 'status') {
						status = normalizeStatus(propVal);
					}
					i++;
				}

				if (!id) {
					id = `todo-${todos.length + 1}`;
				}
				todos.push({ id, content, status });
			}
			return todos;
		}
		i++;
	}
	return todos;
}
