/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewContainersRegistry, IViewsRegistry, IViewDescriptorService, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { McpCommandIds } from '../../mcp/common/mcpCommandIds.js';
import { ConnectorCatalogService, IConnectorCatalogService } from '../common/connectorCatalogService.js';
import { ADD_CONNECTOR_COMMAND_ID, CONNECTORS_VIEW_CONTAINER_ID, CONNECTORS_VIEW_ID, OPEN_CONNECTORS_HUB_COMMAND_ID, decideConnectorsActivity } from '../common/connectors.js';
import { ConnectorsHubEditor } from './connectorsHubEditor.js';
import { ConnectorsHubEditorInput } from './connectorsHubEditorInput.js';
import { ConnectorsChatContribution } from './connectorsChatTools.js';

registerSingleton(IConnectorCatalogService, ConnectorCatalogService, InstantiationType.Delayed);

const connectorsViewIcon = registerIcon('connectors-view-icon', Codicon.plug, localize('connectorsViewIcon', 'View icon of the Connectors hub.'));

class ConnectorsViewPane extends ViewPane {
	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	override shouldShowWelcome(): boolean {
		return true;
	}
}

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const connectorsContainer = viewContainersRegistry.registerViewContainer({
	id: CONNECTORS_VIEW_CONTAINER_ID,
	title: localize2('connectors', "Connectors"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [CONNECTORS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: connectorsViewIcon,
	order: 5,
	hideIfEmpty: false,
	alwaysUseContainerInfo: true,
	openCommandActionDescriptor: {
		id: CONNECTORS_VIEW_CONTAINER_ID,
		mnemonicTitle: localize({ key: 'miViewConnectors', comment: ['&& denotes a mnemonic'] }, "&&Connectors"),
		order: 5,
	},
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: CONNECTORS_VIEW_ID,
	name: localize2('connectors', "Connectors"),
	containerIcon: connectorsViewIcon,
	ctorDescriptor: new SyncDescriptor(ConnectorsViewPane),
	canToggleVisibility: false,
	canMoveView: false,
	weight: 100,
}], connectorsContainer);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViewWelcomeContent(CONNECTORS_VIEW_ID, {
	content: localize('connectors.sidebarWelcome', "Opening the Connectors hub…"),
});

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		ConnectorsHubEditor,
		ConnectorsHubEditor.ID,
		localize('connectorsHubEditor', "Connectors")
	),
	[new SyncDescriptor(ConnectorsHubEditorInput)]
);

class ConnectorsHubEditorInputSerializer implements IEditorSerializer {
	canSerialize(_editor: EditorInput): boolean {
		return true;
	}
	serialize(_editor: EditorInput): string {
		return '';
	}
	deserialize(instantiationService: IInstantiationService, _serializedEditor: string): EditorInput {
		return instantiationService.createInstance(ConnectorsHubEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ConnectorsHubEditorInput.ID, ConnectorsHubEditorInputSerializer);

registerAction2(class OpenConnectorsHubAction extends Action2 {
	constructor() {
		super({
			id: OPEN_CONNECTORS_HUB_COMMAND_ID,
			title: localize2('connectors.openHub', "Open Connectors"),
			f1: true,
			category: localize2('connectors.category', "Connectors"),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(accessor.get(IInstantiationService).createInstance(ConnectorsHubEditorInput), { pinned: true });
	}
});

registerAction2(class AddConnectorAction extends Action2 {
	constructor() {
		super({
			id: ADD_CONNECTOR_COMMAND_ID,
			title: localize2('connectors.add', "Add Connector"),
			f1: true,
			category: localize2('connectors.category', "Connectors"),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand(McpCommandIds.AddConfiguration);
	}
});

class ConnectorsActivityContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.connectorsActivity';

	private lastNonConnectorsId: string | undefined = 'workbench.view.explorer';
	private restoring = false;

	constructor(
		@IPaneCompositePartService paneCompositeService: IPaneCompositePartService,
		@ICommandService commandService: ICommandService,
	) {
		super();
		this._register(paneCompositeService.onDidPaneCompositeOpen(({ composite, viewContainerLocation }) => {
			if (viewContainerLocation !== ViewContainerLocation.Sidebar) {
				return;
			}
			const decision = decideConnectorsActivity(composite.getId(), this.lastNonConnectorsId);
			this.lastNonConnectorsId = decision.lastNonConnectorsId ?? this.lastNonConnectorsId;
			if (!decision.openHub || this.restoring) {
				return;
			}
			this.restoring = true;
			void (async () => {
				try {
					await commandService.executeCommand(OPEN_CONNECTORS_HUB_COMMAND_ID);
					await paneCompositeService.openPaneComposite(decision.restoreId, ViewContainerLocation.Sidebar);
				} finally {
					this.restoring = false;
				}
			})();
		}));
	}
}

registerWorkbenchContribution2(ConnectorsActivityContribution.ID, ConnectorsActivityContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(ConnectorsChatContribution.ID, ConnectorsChatContribution, WorkbenchPhase.AfterRestored);

class ConnectorsCatalogPrefetchContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.connectorsCatalogPrefetch';

	constructor(
		@IConnectorCatalogService catalogService: IConnectorCatalogService,
	) {
		super();
		// Warm the default browse page so the first hub open paints from cache.
		void catalogService.query().catch(() => { /* ignore prefetch failures */ });
	}
}

registerWorkbenchContribution2(ConnectorsCatalogPrefetchContribution.ID, ConnectorsCatalogPrefetchContribution, WorkbenchPhase.Eventually);
