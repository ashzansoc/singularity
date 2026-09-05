/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IChatWidgetService } from '../chat.js';
import { IPlanTodo, PLAN_EDITOR_ID, parsePlanDocument, serializePlanDocument, updatePlanTodos } from '../../common/plan/planDocument.js';
import { IPlanTodoSyncService } from '../../common/plan/planTodoSyncService.js';
import { ChatPlanDocumentRenderer } from '../widget/chatContentParts/chatPlanDocumentRenderer.js';
import { PlanEditorInput } from './planEditorInput.js';

export class PlanEditor extends EditorPane {

	static readonly ID = PLAN_EDITOR_ID;

	private container!: HTMLElement;
	private readonly _renderer = this._register(new MutableDisposable<ChatPlanDocumentRenderer>());
	private readonly _fileWatch = this._register(new MutableDisposable<DisposableStore>());
	private readonly _rendererEvents = this._register(new MutableDisposable<DisposableStore>());
	private _resource: URI | undefined;
	private _writing = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IFileService private readonly fileService: IFileService,
		@IPlanTodoSyncService private readonly planTodoSyncService: IPlanTodoSyncService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
	) {
		super(PlanEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, dom.$('.plan-editor'));
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof PlanEditorInput) || token.isCancellationRequested) {
			return;
		}
		this._resource = input.resource;
		this.bindToActiveChatSession(input.resource);
		this.watchInput(input.resource);
		await this.reload();
	}

	override clearInput(): void {
		this._fileWatch.clear();
		this._rendererEvents.clear();
		this._renderer.clear();
		dom.clearNode(this.container);
		this._resource = undefined;
		super.clearInput();
	}

	override layout(dimension: dom.Dimension): void {
		this._renderer.value?.layout(dimension.height);
	}

	private bindToActiveChatSession(resource: URI): void {
		let session = this.chatWidgetService.lastFocusedWidget?.viewModel?.sessionResource;
		if (!session) {
			for (const widget of this.chatWidgetService.getAllWidgets()) {
				if (widget.viewModel?.sessionResource) {
					session = widget.viewModel.sessionResource;
					break;
				}
			}
		}
		if (session) {
			void this.planTodoSyncService.syncPlanFileToChatTodos(session, resource);
		}
	}

	private watchInput(resource: URI): void {
		const store = new DisposableStore();
		this._fileWatch.value = store;
		store.add(this.fileService.onDidFilesChange(e => {
			if (this._writing) {
				return;
			}
			if (e.affects(resource)) {
				void this.reload();
			}
		}));
		store.add(this.textFileService.files.onDidSave(e => {
			if (this._writing) {
				return;
			}
			if (e.model.resource.toString() === resource.toString()) {
				void this.reload();
			}
		}));
	}

	private async reload(): Promise<void> {
		if (!this._resource) {
			return;
		}
		let text: string;
		try {
			text = (await this.textFileService.read(this._resource)).value;
		} catch {
			text = localize('planEditor.missing', '# Plan\n\nPlan file could not be read.');
		}
		const doc = parsePlanDocument(text);
		dom.clearNode(this.container);
		const renderer = this.instantiationService.createInstance(ChatPlanDocumentRenderer, doc, {
			interactiveTodos: true,
			scrollableBody: true,
		});
		this._renderer.value = renderer;
		this.container.appendChild(renderer.domNode);

		const events = new DisposableStore();
		this._rendererEvents.value = events;
		events.add(renderer.onDidChangeTodos(todos => void this.onTodosChanged(todos)));
		this.layout(this.getDimension() ?? new dom.Dimension(800, 600));
	}

	private async onTodosChanged(todos: readonly IPlanTodo[]): Promise<void> {
		if (!this._resource || !this._renderer.value) {
			return;
		}
		const updated = updatePlanTodos(this._renderer.value.document, todos);
		const text = serializePlanDocument(updated);
		this._writing = true;
		try {
			await this.textFileService.write(this._resource, text);
			this.planTodoSyncService.notifyPlanFileChanged(this._resource, updated);
		} finally {
			this._writing = false;
		}
	}

	private getDimension(): dom.Dimension | undefined {
		const rect = this.container?.getBoundingClientRect();
		if (!rect) {
			return undefined;
		}
		return new dom.Dimension(rect.width, rect.height);
	}
}
