/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Delayer } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { defaultButtonStyles, defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IMcpService, IMcpTool, IMcpWorkbenchService } from '../../mcp/common/mcpTypes.js';
import { startServerByFilter } from '../../mcp/common/mcpTypesUtils.js';
import { McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { IWorkbenchMcpManagementService } from '../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { IConnectorCatalogService } from '../common/connectorCatalogService.js';
import { ADD_CONNECTOR_COMMAND_ID, CONNECTOR_CATEGORIES, ConnectorCategoryId, IConnectorDefinition, formatAddedLabel, pickFeatured, pickPopular, pickRecentlyAdded, toConnectorDefinition } from '../common/connectors.js';
import { IConnectorCustomIcon, isParsedCustomMcpError, parseCustomMcpJson, preferNativeRemoteConfig, resolveCustomMcpLogoUrl, suggestConnectorId } from '../common/connectorsCustomMcp.js';
import { mcpServerIcon, mcpStarredIcon } from '../../mcp/browser/mcpServerIcons.js';
import { verifiedPublisherIcon } from '../../../services/extensionManagement/common/extensionsIcons.js';

const $ = DOM.$;

type HubView =
	| { readonly kind: 'catalog' }
	| { readonly kind: 'addCustom' }
	| { readonly kind: 'detail'; readonly connector: IConnectorDefinition }
	| { readonly kind: 'success'; readonly connector: IConnectorDefinition; readonly toolCount: number };

const CUSTOM_MCP_JSON_PLACEHOLDER = `{
  "type": "http",
  "url": "https://mcp.example.com/mcp"
}`;

export class ConnectorsHubWidget extends Disposable {

	readonly element: HTMLElement;
	private readonly headerEl: HTMLElement;
	private readonly bodyEl: HTMLElement;
	private readonly searchInput: InputBox;
	private readonly categoryBar: HTMLElement;
	private readonly contentDisposables = this._register(new DisposableStore());
	private readonly categoryDisposables = this._register(new DisposableStore());
	private readonly searchDelayer = this._register(new Delayer<void>(200));
	private readonly logoDelayer = this._register(new Delayer<void>(350));
	private view: HubView = { kind: 'catalog' };
	private activeCategory: ConnectorCategoryId = 'all';
	private loading = false;
	private loadError: string | undefined;
	private catalog: IConnectorDefinition[] = [];
	private technicalOpen = false;
	private catalogLoadGeneration = 0;
	private customName = '';
	private customJson = CUSTOM_MCP_JSON_PLACEHOLDER;
	private customLogo: IConnectorCustomIcon | undefined;
	private customLogoStatus = '';
	private customError = '';
	private customLogoEl: HTMLElement | undefined;
	private customLogoStatusEl: HTMLElement | undefined;
	private customSubmitting = false;

	constructor(
		@IConnectorCatalogService private readonly catalogService: IConnectorCatalogService,
		@IMcpWorkbenchService private readonly mcpWorkbenchService: IMcpWorkbenchService,
		@IWorkbenchMcpManagementService private readonly mcpManagementService: IWorkbenchMcpManagementService,
		@IMcpService private readonly mcpService: IMcpService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IThemeService private readonly themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super();
		this.element = $('.connectors-hub');
		this.headerEl = DOM.append(this.element, $('.connectors-hub-header'));
		this.bodyEl = DOM.append(this.element, $('.connectors-hub-body'));

		const titleRow = DOM.append(this.headerEl, $('.connectors-hub-title-row'));
		const titles = DOM.append(titleRow, $('.connectors-hub-titles'));
		DOM.append(titles, $('h1.connectors-hub-title', undefined, localize('connectors.title', "Connectors")));
		DOM.append(titles, $('p.connectors-hub-subtitle', undefined, localize('connectors.subtitle', "Connect Singularity to the tools you already use.")));

		const addActions = DOM.append(titleRow, $('.connectors-hub-add-actions'));
		const addCustomButton = this._register(new Button(addActions, { ...defaultButtonStyles, title: localize('connectors.addCustom', "Add custom MCP") }));
		addCustomButton.label = localize('connectors.addCustom', "Add custom MCP");
		addCustomButton.element.classList.add('connectors-hub-add');
		this._register(addCustomButton.onDidClick(() => this.openAddCustom()));

		const addWizardButton = this._register(new Button(addActions, { ...defaultButtonStyles, secondary: true, title: localize('connectors.addWizard', "Add with wizard") }));
		addWizardButton.label = localize('connectors.addWizard', "Wizard");
		this._register(addWizardButton.onDidClick(() => this.commandService.executeCommand(ADD_CONNECTOR_COMMAND_ID)));

		const searchRow = DOM.append(this.headerEl, $('.connectors-hub-search-row'));
		this.searchInput = this._register(new InputBox(searchRow, contextViewService, {
			placeholder: localize('connectors.search', "Search connectors..."),
			inputBoxStyles: defaultInputBoxStyles,
		}));
		this._register(this.searchInput.onDidChange(() => {
			void this.searchDelayer.trigger(() => this.reloadCatalog());
		}));

		this.categoryBar = DOM.append(this.headerEl, $('.connectors-hub-categories'));
		this.renderCategories();

		this._register(this.catalogService.onDidChange(() => {
			if (this.view.kind === 'catalog') {
				void this.reloadCatalog(false);
			} else if (this.view.kind === 'detail') {
				const updated = this.catalogService.getById(this.view.connector.id);
				if (updated) {
					this.view = { kind: 'detail', connector: updated };
					this.renderBody();
				}
			}
		}));
	}

	layout(_dimension: DOM.Dimension): void {
		// CSS grid handles layout; hook kept for EditorPane.
	}

	focusSearch(): void {
		this.searchInput.focus();
	}

	async render(): Promise<void> {
		await this.reloadCatalog();
	}

	private renderCategories(): void {
		this.categoryDisposables.clear();
		DOM.clearNode(this.categoryBar);
		for (const category of CONNECTOR_CATEGORIES) {
			const chip = DOM.append(this.categoryBar, $('button.connectors-hub-chip', {
				type: 'button',
				'aria-pressed': String(this.activeCategory === category.id),
			}, category.label));
			chip.classList.toggle('active', this.activeCategory === category.id);
			this.categoryDisposables.add(DOM.addDisposableListener(chip, DOM.EventType.CLICK, () => {
				this.activeCategory = category.id;
				this.renderCategories();
				void this.reloadCatalog();
			}));
		}
	}

	private async reloadCatalog(showLoading = true): Promise<void> {
		const generation = ++this.catalogLoadGeneration;
		if (showLoading && !this.catalog.length) {
			this.loading = true;
			this.loadError = undefined;
			if (this.view.kind === 'catalog') {
				this.renderBody();
			}
		}
		try {
			const page = await this.catalogService.query({
				text: this.searchInput.value.trim() || undefined,
				category: this.activeCategory,
			}, CancellationToken.None);
			if (generation !== this.catalogLoadGeneration) {
				return;
			}
			this.catalog = [...page.items];
			this.loading = false;
			this.loadError = undefined;
			if (this.view.kind === 'catalog') {
				this.renderBody();
			}
			void this.fillCatalogInBackground(page, generation);
		} catch (error) {
			if (generation !== this.catalogLoadGeneration) {
				return;
			}
			this.loadError = error instanceof Error ? error.message : String(error);
			this.loading = false;
			if (this.view.kind === 'catalog') {
				this.renderBody();
			}
		}
	}

	private async fillCatalogInBackground(page: Awaited<ReturnType<IConnectorCatalogService['query']>>, generation: number): Promise<void> {
		let current = page;
		while (current.hasMore) {
			if (generation !== this.catalogLoadGeneration) {
				return;
			}
			current = await current.getNextPage(CancellationToken.None);
			if (generation !== this.catalogLoadGeneration) {
				return;
			}
			// Browse sync replaces the whole catalog as pages arrive.
			this.catalog = [...current.items];
			if (this.view.kind === 'catalog') {
				this.renderBody();
			}
		}
	}

	private renderBody(): void {
		this.contentDisposables.clear();
		DOM.clearNode(this.bodyEl);
		const browsing = this.view.kind === 'catalog';
		this.headerEl.classList.toggle('connectors-hub-header-compact', !browsing);
		if (this.view.kind === 'detail') {
			this.renderDetail(this.view.connector);
			return;
		}
		if (this.view.kind === 'success') {
			this.renderSuccess(this.view.connector, this.view.toolCount);
			return;
		}
		if (this.view.kind === 'addCustom') {
			this.renderAddCustom();
			return;
		}
		this.renderCatalog();
	}

	private renderCatalog(): void {
		if (this.loading && !this.catalog.length) {
			const grid = DOM.append(this.bodyEl, $('.connectors-hub-grid'));
			for (let i = 0; i < 8; i++) {
				DOM.append(grid, $('.connectors-hub-card.skeleton'));
			}
			return;
		}

		if (this.loadError) {
			DOM.append(this.bodyEl, $('.connectors-hub-empty', undefined, this.loadError));
			return;
		}

		const query = this.searchInput.value.trim();
		const installed = this.catalogService.getInstalled();
		if (query) {
			if (!this.catalog.length) {
				this.renderNoResults();
				return;
			}
			const visible = this.catalog.slice(0, 48);
			this.renderSection(
				localize('connectors.results', "Results"),
				this.catalog.length > visible.length
					? localize('connectors.resultsHintLimited', "Showing {0} of {1} matches — refine your search", visible.length, this.catalog.length)
					: localize('connectors.resultsHint', "Connectors matching your search"),
				visible,
			);
			return;
		}

		if (!installed.length) {
			const empty = DOM.append(this.bodyEl, $('.connectors-hub-empty'));
			DOM.append(empty, $('h2', undefined, localize('connectors.emptyTitle', "No connectors connected yet.")));
			DOM.append(empty, $('p', undefined, localize('connectors.emptyBody', "Connect your first tool to give Singularity access to your development environment.")));
			const browse = this.contentDisposables.add(new Button(empty, defaultButtonStyles));
			browse.label = localize('connectors.browse', "Browse Connectors");
			this.contentDisposables.add(browse.onDidClick(() => this.searchInput.focus()));
			const addCustom = this.contentDisposables.add(new Button(empty, { ...defaultButtonStyles, secondary: true }));
			addCustom.label = localize('connectors.addCustom', "Add custom MCP");
			this.contentDisposables.add(addCustom.onDidClick(() => this.openAddCustom()));
		} else {
			this.renderSection(localize('connectors.mine', "My Connectors"), localize('connectors.mineHint', "Tools connected to this workspace"), installed);
		}

		this.renderSection(localize('connectors.featured', "Featured"), localize('connectors.featuredHint', "Popular tools teams connect first"), pickFeatured(this.catalog));
		this.renderSection(localize('connectors.popular', "Popular"), localize('connectors.popularHint', "What the community is installing"), pickPopular(this.catalog));
		this.renderSection(localize('connectors.recent', "Recently added"), localize('connectors.recentHint', "New arrivals from the catalog"), pickRecentlyAdded(this.catalog));

		const request = DOM.append(this.bodyEl, $('.connectors-hub-request'));
		DOM.append(request, $('span', undefined, localize('connectors.requestPrompt', "Can't find what you need?")));
		const customBtn = this.contentDisposables.add(new Button(request, { ...defaultButtonStyles, secondary: true }));
		customBtn.label = localize('connectors.addCustom', "Add custom MCP");
		this.contentDisposables.add(customBtn.onDidClick(() => this.openAddCustom()));
		const requestBtn = this.contentDisposables.add(new Button(request, { ...defaultButtonStyles, secondary: true }));
		requestBtn.label = localize('connectors.request', "Request a Connector");
		this.contentDisposables.add(requestBtn.onDidClick(() => this.requestConnector()));
	}

	private openAddCustom(): void {
		this.view = { kind: 'addCustom' };
		this.customError = '';
		this.customSubmitting = false;
		this.renderBody();
		void this.refreshCustomLogo();
	}

	private renderAddCustom(): void {
		const back = this.contentDisposables.add(new Button(this.bodyEl, { ...defaultButtonStyles, secondary: true }));
		back.label = localize('connectors.back', "Back to catalog");
		this.contentDisposables.add(back.onDidClick(() => {
			this.view = { kind: 'catalog' };
			this.renderBody();
		}));

		const form = DOM.append(this.bodyEl, $('.connectors-hub-custom'));
		DOM.append(form, $('h2', undefined, localize('connectors.customTitle', "Add custom MCP")));
		DOM.append(form, $('p.connectors-hub-custom-hint', undefined, localize('connectors.customHint', "Give it a name, paste the MCP JSON, and Singularity will pull the logo from the server or its host.")));

		const identity = DOM.append(form, $('.connectors-hub-custom-identity'));
		this.customLogoEl = DOM.append(identity, $('.connectors-hub-custom-logo'));
		this.renderCustomLogo(this.customLogoEl);
		const identityFields = DOM.append(identity, $('.connectors-hub-custom-identity-fields'));
		DOM.append(identityFields, $('label.connectors-hub-field-label', undefined, localize('connectors.customName', "Name of MCP")));
		const nameInput = DOM.append(identityFields, $('input.connectors-hub-field-input', {
			type: 'text',
			placeholder: localize('connectors.customNamePh', "e.g. Notion, Acme Deploy"),
			value: this.customName,
		})) as HTMLInputElement;
		this.contentDisposables.add(DOM.addDisposableListener(nameInput, DOM.EventType.INPUT, () => {
			this.customName = nameInput.value;
			void this.logoDelayer.trigger(() => this.refreshCustomLogo());
		}));
		this.customLogoStatusEl = DOM.append(identityFields, $('p.connectors-hub-field-meta'));
		this.customLogoStatusEl.textContent = this.customLogoStatus || localize('connectors.customLogoWaiting', "Logo appears automatically from the MCP host or registry.");

		DOM.append(form, $('label.connectors-hub-field-label', undefined, localize('connectors.customJson', "MCP JSON")));
		const jsonArea = DOM.append(form, $('textarea.connectors-hub-json', {
			spellcheck: 'false',
			placeholder: CUSTOM_MCP_JSON_PLACEHOLDER,
		})) as HTMLTextAreaElement;
		jsonArea.value = this.customJson;
		this.contentDisposables.add(DOM.addDisposableListener(jsonArea, DOM.EventType.INPUT, () => {
			this.customJson = jsonArea.value;
			this.customError = '';
			void this.logoDelayer.trigger(() => this.refreshCustomLogo());
		}));

		if (this.customError) {
			DOM.append(form, $('p.connectors-hub-custom-error', undefined, this.customError));
		}

		const actions = DOM.append(form, $('.connectors-hub-custom-actions'));
		const connectBtn = this.contentDisposables.add(new Button(actions, {
			...defaultButtonStyles,
			disabled: this.customSubmitting,
		}));
		connectBtn.label = this.customSubmitting
			? localize('connectors.connecting', "Connecting…")
			: localize('connectors.customConnect', "Connect MCP");
		this.contentDisposables.add(connectBtn.onDidClick(() => void this.submitCustomMcp()));
	}

	private renderCustomLogo(parent: HTMLElement): void {
		DOM.clearNode(parent);
		const iconUrl = isDark(this.themeService.getColorTheme().type)
			? this.customLogo?.dark
			: this.customLogo?.light ?? this.customLogo?.dark;
		if (iconUrl) {
			DOM.append(parent, $('img', { src: iconUrl, alt: '' }));
		} else {
			parent.appendChild(renderIcon(mcpServerIcon));
		}
	}

	private async refreshCustomLogo(): Promise<void> {
		if (this.view.kind !== 'addCustom') {
			return;
		}
		const parsed = parseCustomMcpJson(this.customJson);
		const name = this.customName.trim() || (!isParsedCustomMcpError(parsed) ? parsed.name : undefined);
		let galleryIcon: { dark?: string; light?: string } | undefined;
		if (name) {
			try {
				const pager = await this.mcpWorkbenchService.queryGallery({ text: name }, CancellationToken.None);
				const match = pager.firstPage.items.find(item =>
					item.name.toLowerCase() === name.toLowerCase()
					|| item.label.toLowerCase() === name.toLowerCase()
					|| item.name.toLowerCase().includes(name.toLowerCase())
					|| item.label.toLowerCase().includes(name.toLowerCase())
				) ?? pager.firstPage.items[0];
				galleryIcon = match?.icon;
			} catch {
				// Registry lookup is best-effort for logos.
			}
		}

		const logo = isParsedCustomMcpError(parsed)
			? resolveCustomMcpLogoUrl({ name, galleryIcon })
			: resolveCustomMcpLogoUrl({
				name,
				config: parsed.config,
				logoHint: parsed.logoHint,
				galleryIcon,
			});

		this.customLogo = logo;
		this.customLogoStatus = logo
			? localize('connectors.customLogoReady', "Logo fetched from the MCP.")
			: localize('connectors.customLogoFallback', "No logo found yet — a default icon will be used until the server provides one.");
		if (this.customLogoEl) {
			this.renderCustomLogo(this.customLogoEl);
		}
		if (this.customLogoStatusEl) {
			this.customLogoStatusEl.textContent = this.customLogoStatus;
		}
	}

	private async submitCustomMcp(): Promise<void> {
		const parsed = parseCustomMcpJson(this.customJson);
		if (isParsedCustomMcpError(parsed)) {
			this.customError = parsed.error;
			this.renderBody();
			return;
		}

		const displayName = this.customName.trim() || parsed.name?.trim();
		if (!displayName) {
			this.customError = localize('connectors.customNameRequired', "Enter a name for this MCP.");
			this.renderBody();
			return;
		}

		const id = suggestConnectorId(parsed.name?.trim() || displayName);
		this.customSubmitting = true;
		this.customError = '';
		this.renderBody();

		try {
			const config = preferNativeRemoteConfig(parsed.config);
			const can = this.mcpManagementService.canInstall({ name: id, config, inputs: parsed.inputs });
			if (can !== true) {
				throw new Error(typeof can.value === 'string' ? can.value : String(can.value));
			}
			await this.mcpManagementService.install({ name: id, config, inputs: parsed.inputs });
			if (this.customLogo) {
				this.catalogService.setCustomIcon(id, this.customLogo);
			}

			try {
				await startServerByFilter(this.mcpService, server => {
					const label = server.definition.label;
					return label === id || label === displayName || label.toLowerCase() === id.toLowerCase();
				}, 15_000);
			} catch {
				// Installed successfully; start may wait on OAuth / first trust prompt.
			}

			const live = this.mcpService.servers.get().find(server => {
				const label = server.definition.label;
				return label === id || label === displayName || label.toLowerCase() === id.toLowerCase();
			});
			const liveIcon = live?.serverMetadata.get()?.icons?.getUrl(64);
			if (liveIcon) {
				this.catalogService.setCustomIcon(id, {
					dark: liveIcon.dark.toString(true),
					light: (liveIcon.light ?? liveIcon.dark).toString(true),
				});
			}

			await this.mcpWorkbenchService.queryLocal();
			const installed = this.catalogService.getInstalled().find(item => item.name === id || item.label === displayName || item.name.toLowerCase() === id.toLowerCase())
				?? this.mcpWorkbenchService.local.map(toConnectorDefinition).find(item => item.name === id || item.name.toLowerCase() === id.toLowerCase());
			if (installed) {
				const withIcon = (this.customLogo || this.catalogService.getCustomIcon(id)) && !installed.icon
					? {
						...installed,
						icon: {
							dark: (this.customLogo ?? this.catalogService.getCustomIcon(id)!).dark,
							light: (this.customLogo ?? this.catalogService.getCustomIcon(id)!).light
								?? (this.customLogo ?? this.catalogService.getCustomIcon(id)!).dark,
						},
					}
					: installed;
				this.view = { kind: 'success', connector: withIcon, toolCount: this.toolsFor(withIcon).length };
			} else {
				this.notificationService.info(localize('connectors.customConnected', "{0} connected.", displayName));
				this.view = { kind: 'catalog' };
				await this.reloadCatalog(false);
			}
			this.customName = '';
			this.customJson = CUSTOM_MCP_JSON_PLACEHOLDER;
			this.customLogo = undefined;
		} catch (error) {
			this.customError = error instanceof Error ? error.message : String(error);
			this.notificationService.error(this.customError);
		} finally {
			this.customSubmitting = false;
			this.renderBody();
		}
	}

	private renderNoResults(): void {
		const empty = DOM.append(this.bodyEl, $('.connectors-hub-empty'));
		DOM.append(empty, $('h2', undefined, localize('connectors.noneTitle', "No connectors found.")));
		const requestBtn = this.contentDisposables.add(new Button(empty, defaultButtonStyles));
		requestBtn.label = localize('connectors.request', "Request a Connector");
		this.contentDisposables.add(requestBtn.onDidClick(() => this.requestConnector()));
	}

	private renderSection(title: string, hint: string, items: readonly IConnectorDefinition[]): void {
		if (!items.length) {
			return;
		}
		const section = DOM.append(this.bodyEl, $('.connectors-hub-section'));
		const heading = DOM.append(section, $('.connectors-hub-section-header'));
		const left = DOM.append(heading, $('div'));
		DOM.append(left, $('h2', undefined, title));
		DOM.append(left, $('p', undefined, hint));
		const grid = DOM.append(section, $('.connectors-hub-grid'));
		for (const connector of items) {
			this.renderCard(grid, connector);
		}
	}

	private renderCard(parent: HTMLElement, connector: IConnectorDefinition): void {
		const card = DOM.append(parent, $('.connectors-hub-card', { role: 'button', tabIndex: '0' }));
		const header = DOM.append(card, $('.connectors-hub-card-header'));
		this.renderIcon(header, connector);
		const identity = DOM.append(header, $('.connectors-hub-card-identity'));
		const title = DOM.append(identity, $('.connectors-hub-card-title'));
		DOM.append(title, $('span', undefined, connector.label));
		if (connector.verified) {
			title.appendChild(renderIcon(verifiedPublisherIcon));
		}
		DOM.append(identity, $('div.connectors-hub-card-publisher', undefined, connector.publisher ?? connector.name));
		DOM.append(card, $('p.connectors-hub-card-description', undefined, connector.description || localize('connectors.noDescription', "No description yet.")));
		const footer = DOM.append(card, $('.connectors-hub-card-footer'));
		const meta = DOM.append(footer, $('.connectors-hub-card-meta'));
		if (connector.stars) {
			const stars = DOM.append(meta, $('span.connectors-hub-stars'));
			stars.appendChild(renderIcon(mcpStarredIcon));
			DOM.append(stars, $('span', undefined, this.formatStars(connector.stars)));
		}
		const added = formatAddedLabel(connector.addedAt);
		if (added) {
			DOM.append(meta, $('span.connectors-hub-added', undefined, added));
		}
		const action = this.contentDisposables.add(new Button(footer, {
			...defaultButtonStyles,
			secondary: connector.connected,
			disabled: connector.connecting,
		}));
		action.label = connector.connecting
			? localize('connectors.connecting', "Connecting…")
			: connector.connected
				? localize('connectors.connected', "Connected")
				: localize('connectors.connect', "Connect");
		this.contentDisposables.add(action.onDidClick(e => {
			e?.stopPropagation();
			if (connector.connected) {
				this.openDetail(connector);
			} else {
				void this.connect(connector);
			}
		}));

		const open = () => this.openDetail(connector);
		this.contentDisposables.add(DOM.addDisposableListener(card, DOM.EventType.CLICK, open));
		this.contentDisposables.add(DOM.addDisposableListener(card, DOM.EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				e.preventDefault();
				open();
			}
		}));
	}

	private renderIcon(parent: HTMLElement, connector: IConnectorDefinition): void {
		const wrap = DOM.append(parent, $('.connectors-hub-icon'));
		const iconUrl = isDark(this.themeService.getColorTheme().type) ? connector.icon?.dark : connector.icon?.light ?? connector.icon?.dark;
		if (iconUrl) {
			DOM.append(wrap, $('img', { src: iconUrl, alt: '' }));
		} else {
			wrap.appendChild(renderIcon(mcpServerIcon));
		}
	}

	private openDetail(connector: IConnectorDefinition): void {
		this.view = { kind: 'detail', connector };
		this.technicalOpen = false;
		this.renderBody();
	}

	private renderDetail(connector: IConnectorDefinition): void {
		const back = this.contentDisposables.add(new Button(this.bodyEl, { ...defaultButtonStyles, secondary: true }));
		back.label = localize('connectors.back', "Back to catalog");
		this.contentDisposables.add(back.onDidClick(() => {
			this.view = { kind: 'catalog' };
			this.renderBody();
		}));

		const hero = DOM.append(this.bodyEl, $('.connectors-hub-detail-hero'));
		this.renderIcon(hero, connector);
		const heroText = DOM.append(hero, $('.connectors-hub-detail-copy'));
		const title = DOM.append(heroText, $('.connectors-hub-card-title'));
		DOM.append(title, $('h1', undefined, connector.label));
		if (connector.verified) {
			title.appendChild(renderIcon(verifiedPublisherIcon));
		}
		DOM.append(heroText, $('p', undefined, connector.publisher ? `@${connector.publisher}` : connector.name));
		const connectBtn = this.contentDisposables.add(new Button(hero, {
			...defaultButtonStyles,
			secondary: connector.connected,
		}));
		connectBtn.label = connector.connected
			? localize('connectors.disconnect', "Disconnect")
			: localize('connectors.connect', "Connect");
		this.contentDisposables.add(connectBtn.onDidClick(() => {
			if (connector.connected) {
				void this.disconnect(connector);
			} else {
				void this.connect(connector);
			}
		}));

		this.renderDetailSection(localize('connectors.overview', "Overview"), connector.description || localize('connectors.noDescription', "No description yet."));
		this.renderDetailSection(localize('connectors.capabilities', "Capabilities"), this.capabilityList(connector));

		const tools = this.toolsFor(connector);
		this.renderDetailSection(
			localize('connectors.tools', "Tools"),
			tools.length
				? tools.map(tool => tool.definition.name).join('\n')
				: localize('connectors.toolsEmpty', "Tools appear after this connector is connected.")
		);

		this.renderDetailSection(
			localize('connectors.permissions', "Permissions"),
			tools.length
				? this.permissionSummary(tools)
				: localize('connectors.permissionsHint', "Singularity will only use the access you grant during connect.")
		);

		this.renderDetailSection(
			localize('connectors.authentication', "Authentication"),
			this.authLabel(connector)
		);

		this.renderDetailSection(
			localize('connectors.security', "Security"),
			localize('connectors.securityBody', "Credentials are stored in the local secret vault. They are never shown in this window, logged, or sent to the model.")
		);

		const tech = DOM.append(this.bodyEl, $('.connectors-hub-tech'));
		const toggle = DOM.append(tech, $('button.connectors-hub-tech-toggle', { type: 'button' }, localize('connectors.tech', "Technical details")));
		this.contentDisposables.add(DOM.addDisposableListener(toggle, DOM.EventType.CLICK, () => {
			this.technicalOpen = !this.technicalOpen;
			this.renderBody();
		}));
		if (this.technicalOpen) {
			DOM.append(tech, $('pre', undefined, this.technicalDetails(connector)));
		}
	}

	private renderSuccess(connector: IConnectorDefinition, toolCount: number): void {
		const panel = DOM.append(this.bodyEl, $('.connectors-hub-empty.success'));
		DOM.append(panel, $('h2', undefined, localize('connectors.successTitle', "{0} connected", connector.label)));
		DOM.append(panel, $('p', undefined, localize('connectors.successBody', "Singularity can now use this connector. {0} tools available.", toolCount)));
		const actions = DOM.append(panel, $('.connectors-hub-success-actions'));
		const viewTools = this.contentDisposables.add(new Button(actions, defaultButtonStyles));
		viewTools.label = localize('connectors.viewTools', "View Tools");
		this.contentDisposables.add(viewTools.onDidClick(() => this.openDetail(connector)));
		const done = this.contentDisposables.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		done.label = localize('connectors.done', "Done");
		this.contentDisposables.add(done.onDidClick(() => {
			this.view = { kind: 'catalog' };
			void this.reloadCatalog(false);
		}));
	}

	private renderDetailSection(title: string, body: string): void {
		const section = DOM.append(this.bodyEl, $('.connectors-hub-detail-section'));
		DOM.append(section, $('h3', undefined, title));
		DOM.append(section, $('p', undefined, body));
	}

	private async connect(connector: IConnectorDefinition): Promise<void> {
		try {
			const can = this.mcpWorkbenchService.canInstall(connector.server);
			if (can !== true) {
				this.notificationService.notify({ severity: Severity.Error, message: can.value });
				return;
			}
			const installed = await this.mcpWorkbenchService.install(connector.server);
			await startServerByFilter(this.mcpService, server => server.definition.label === installed.name);
			const updated = toConnectorDefinition(installed);
			this.view = { kind: 'success', connector: updated, toolCount: this.toolsFor(updated).length };
			this.renderBody();
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private async disconnect(connector: IConnectorDefinition): Promise<void> {
		try {
			await this.mcpWorkbenchService.uninstall(connector.server);
			this.view = { kind: 'catalog' };
			await this.reloadCatalog(false);
		} catch (error) {
			this.notificationService.error(error instanceof Error ? error.message : String(error));
		}
	}

	private async requestConnector(): Promise<void> {
		const name = await this.quickInputService.input({
			prompt: localize('connectors.requestName', "Connector name"),
			placeHolder: localize('connectors.requestNamePh', "e.g. Acme Deploy"),
		});
		if (!name) {
			return;
		}
		const website = await this.quickInputService.input({
			prompt: localize('connectors.requestSite', "Website"),
			placeHolder: 'https://',
		});
		const useCase = await this.quickInputService.input({
			prompt: localize('connectors.requestUse', "What would you use it for?"),
		});
		this.catalogService.addRequest({ name, website, useCase });
		this.notificationService.info(localize('connectors.requestSaved', "Request saved for admin review."));
	}

	private toolsFor(connector: IConnectorDefinition) {
		const servers = this.mcpService.servers.get();
		const server = servers.find(item => item.definition.label === connector.name || item.definition.label === connector.label || item.definition.id.includes(connector.name));
		return server?.tools.get() ?? [];
	}

	private capabilityList(connector: IConnectorDefinition): string {
		const fromTopics = connector.topics.slice(0, 8);
		if (fromTopics.length) {
			return fromTopics.join('\n');
		}
		return localize('connectors.capabilitiesFallback', "{0} integration for Singularity.", connector.label);
	}

	private permissionSummary(tools: readonly IMcpTool[]): string {
		const reads = tools.filter(tool => tool.definition.annotations?.readOnlyHint).length;
		const writes = tools.length - reads;
		return localize('connectors.permissionCounts', "Read tools: {0}\nWrite / execute tools: {1}", reads, writes);
	}

	private authLabel(connector: IConnectorDefinition): string {
		switch (connector.authMethod) {
			case 'oauth': return localize('connectors.auth.oauth', "OAuth 2.0");
			case 'token': return localize('connectors.auth.token', "API key or access token");
			case 'stdio': return localize('connectors.auth.stdio', "Local process (self-hosted)");
			default: return localize('connectors.auth.none', "No additional authentication");
		}
	}

	private technicalDetails(connector: IConnectorDefinition): string {
		const config = connector.server.config;
		const lines = [
			`id: ${connector.id}`,
			`version: ${connector.version ?? 'n/a'}`,
			`category: ${connector.category}`,
		];
		if (config?.type === McpServerType.REMOTE) {
			lines.push(`transport: ${config.type}`, `url: ${config.url}`);
		} else if (config?.type === McpServerType.LOCAL) {
			lines.push(`transport: stdio`, `command: ${config.command}`);
		}
		return lines.join('\n');
	}

	private formatStars(stars: number): string {
		if (stars >= 1000) {
			return `${Math.round(stars / 100) / 10}K`;
		}
		return String(stars);
	}
}
