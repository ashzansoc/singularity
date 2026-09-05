/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatPlanDocument.css';
import * as dom from '../../../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { localize } from '../../../../../../nls.js';
import { IMarkdownRendererService } from '../../../../../../platform/markdown/browser/markdownRenderer.js';
import {
	IPlanDocument,
	IPlanTodo,
	PlanTodoStatus,
	planTodoProgress,
	updatePlanTodos,
} from '../../../common/plan/planDocument.js';

export interface IChatPlanDocumentRendererOptions {
	/** When true, clicking a todo cycles its status and fires onDidChangeTodos. */
	readonly interactiveTodos?: boolean;
	/** When true, wrap body in an internal scrollable. Default true for editor; false when parent scrolls. */
	readonly scrollableBody?: boolean;
}

/**
 * Shared Cursor-style plan chrome: header (name/overview/progress) + checklist + markdown body.
 * Frontmatter is never shown as raw YAML.
 */
export class ChatPlanDocumentRenderer extends Disposable {
	readonly domNode: HTMLElement;

	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event;

	private readonly _onDidChangeTodos = this._register(new Emitter<readonly IPlanTodo[]>());
	readonly onDidChangeTodos: Event<readonly IPlanTodo[]> = this._onDidChangeTodos.event;

	private readonly _headerEl: HTMLElement;
	private readonly _titleEl: HTMLElement;
	private readonly _overviewEl: HTMLElement;
	private readonly _progressEl: HTMLElement;
	private readonly _checklistEl: HTMLElement;
	private readonly _bodyEl: HTMLElement;
	private readonly _bodyScrollable: DomScrollableElement | undefined;
	private readonly _bodyContentDisposables = this._register(new MutableDisposable<DisposableStore>());
	private readonly _checklistDisposables = this._register(new MutableDisposable<DisposableStore>());

	private _doc: IPlanDocument;

	constructor(
		doc: IPlanDocument,
		private readonly _options: IChatPlanDocumentRendererOptions,
		@IMarkdownRendererService private readonly _markdownRendererService: IMarkdownRendererService,
	) {
		super();
		this._doc = doc;

		const elements = dom.h('.chat-plan-document@root', [
			dom.h('.chat-plan-document-header@header', [
				dom.h('.chat-plan-document-header-row', [
					dom.h('h1.chat-plan-document-title@title'),
					dom.h('span.chat-plan-document-progress@progress'),
				]),
				dom.h('p.chat-plan-document-overview@overview'),
			]),
			dom.h('ul.chat-plan-document-checklist@checklist'),
			dom.h('.chat-plan-document-body@body'),
		]);

		this.domNode = elements.root;
		this._headerEl = elements.header;
		this._titleEl = elements.title;
		this._overviewEl = elements.overview;
		this._progressEl = elements.progress;
		this._checklistEl = elements.checklist;
		this._bodyEl = elements.body;

		if (this._options.scrollableBody !== false) {
			const parent = this._bodyEl.parentElement!;
			const next = this._bodyEl.nextSibling;
			this._bodyScrollable = this._register(new DomScrollableElement(this._bodyEl, {
				vertical: ScrollbarVisibility.Auto,
				horizontal: ScrollbarVisibility.Hidden,
				consumeMouseWheelIfScrollbarIsNeeded: true,
			}));
			this._bodyScrollable.getDomNode().classList.add('chat-plan-document-body-scrollable');
			parent.insertBefore(this._bodyScrollable.getDomNode(), next);
		}

		this.renderAll();
	}

	get document(): IPlanDocument {
		return this._doc;
	}

	setDocument(doc: IPlanDocument): void {
		this._doc = doc;
		this.renderAll();
		this._onDidChangeHeight.fire();
	}

	layout(height?: number): void {
		if (height !== undefined && this._bodyScrollable) {
			this._bodyScrollable.getDomNode().style.maxHeight = `${Math.max(120, height - this._headerEl.offsetHeight - this._checklistEl.offsetHeight - 32)}px`;
		}
		this._bodyScrollable?.scanDomNode();
	}

	private renderAll(): void {
		this.renderHeader();
		this.renderChecklist();
		this.renderBody();
	}

	private renderHeader(): void {
		this._titleEl.textContent = this._doc.name || localize('chat.planDocument.untitled', 'Plan');
		const overview = this._doc.overview.trim();
		this._overviewEl.textContent = overview;
		this._overviewEl.style.display = overview ? '' : 'none';

		const { completed, total, label } = planTodoProgress(this._doc.todos);
		if (total === 0) {
			this._progressEl.style.display = 'none';
			this._progressEl.textContent = '';
		} else {
			this._progressEl.style.display = '';
			this._progressEl.textContent = localize('chat.planDocument.progress', '{0} done', label);
			this._progressEl.setAttribute('aria-label', localize('chat.planDocument.progressAria', '{0} of {1} todos completed', completed, total));
		}
	}

	private renderChecklist(): void {
		dom.clearNode(this._checklistEl);
		const store = new DisposableStore();
		this._checklistDisposables.value = store;

		const todos = this._doc.todos;
		if (todos.length === 0) {
			this._checklistEl.style.display = 'none';
			return;
		}
		this._checklistEl.style.display = '';
		this._checklistEl.setAttribute('role', 'list');

		for (const todo of todos) {
			const item = dom.append(this._checklistEl, dom.$('li.chat-plan-document-todo'));
			item.setAttribute('role', 'listitem');
			item.classList.add(`status-${todo.status}`);

			const icon = dom.append(item, dom.$('span.chat-plan-document-todo-icon'));
			icon.className = `chat-plan-document-todo-icon ${ThemeIcon.asClassName(this.statusIcon(todo.status))}`;
			icon.setAttribute('aria-hidden', 'true');
			icon.style.color = this.statusIconColor(todo.status);

			const label = dom.append(item, dom.$('span.chat-plan-document-todo-label'));
			label.textContent = todo.content || todo.id;

			const statusText = this.statusText(todo.status);
			item.setAttribute('aria-label', localize('chat.planDocument.todoAria', '{0}, {1}', todo.content || todo.id, statusText));

			if (this._options.interactiveTodos && todo.status !== 'cancelled') {
				item.classList.add('interactive');
				item.tabIndex = 0;
				item.setAttribute('role', 'button');
				const activate = () => this.cycleTodoStatus(todo.id);
				store.add(dom.addDisposableListener(item, 'click', activate));
				store.add(dom.addDisposableListener(item, 'keydown', e => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						activate();
					}
				}));
			}
		}
	}

	private renderBody(): void {
		dom.clearNode(this._bodyEl);
		const store = new DisposableStore();
		this._bodyContentDisposables.value = store;

		const body = this._doc.body.trim();
		if (!body) {
			this._bodyEl.style.display = 'none';
			this._bodyScrollable?.scanDomNode();
			return;
		}
		this._bodyEl.style.display = '';

		const rendered = store.add(this._markdownRendererService.render(
			new MarkdownString(body, { supportThemeIcons: true, isTrusted: { enabledCommands: [] } }),
			{
				asyncRenderCallback: () => {
					this._bodyScrollable?.scanDomNode();
					this._onDidChangeHeight.fire();
				},
			},
		));
		this._bodyEl.append(rendered.element);
		this._bodyScrollable?.scanDomNode();
	}

	private cycleTodoStatus(id: string): void {
		const nextStatus = (status: PlanTodoStatus): PlanTodoStatus => {
			switch (status) {
				case 'pending':
					return 'in_progress';
				case 'in_progress':
					return 'completed';
				case 'completed':
					return 'pending';
				case 'cancelled':
					return 'cancelled';
			}
		};
		const todos = this._doc.todos.map(t => t.id === id ? { ...t, status: nextStatus(t.status) } : t);
		this._doc = updatePlanTodos(this._doc, todos);
		this.renderHeader();
		this.renderChecklist();
		this._onDidChangeTodos.fire(this._doc.todos);
		this._onDidChangeHeight.fire();
	}

	private statusText(status: PlanTodoStatus): string {
		switch (status) {
			case 'completed':
				return localize('chat.planDocument.status.completed', 'completed');
			case 'in_progress':
				return localize('chat.planDocument.status.inProgress', 'in progress');
			case 'cancelled':
				return localize('chat.planDocument.status.cancelled', 'cancelled');
			case 'pending':
			default:
				return localize('chat.planDocument.status.pending', 'pending');
		}
	}

	private statusIcon(status: PlanTodoStatus): ThemeIcon {
		switch (status) {
			case 'completed':
				return Codicon.pass;
			case 'in_progress':
				return Codicon.record;
			case 'cancelled':
				return Codicon.circleSlash;
			case 'pending':
			default:
				return Codicon.circleOutline;
		}
	}

	private statusIconColor(status: PlanTodoStatus): string {
		switch (status) {
			case 'completed':
				return 'var(--vscode-charts-green)';
			case 'in_progress':
				return 'var(--vscode-charts-blue)';
			case 'cancelled':
				return 'var(--vscode-descriptionForeground)';
			case 'pending':
			default:
				return 'var(--vscode-foreground)';
		}
	}
}
