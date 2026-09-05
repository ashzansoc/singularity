/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { CHAT_CATEGORY, CHAT_OPEN_ACTION_ID } from '../../chat/browser/actions/chatActions.js';
import { SingularityWorkspaceCommands, SingularityWorkspaces } from '../common/constants.js';
import { singularityArchitectViewIcon, singularityDocsViewIcon, singularityPlanViewIcon, singularityRepositoryViewIcon, singularityTestingViewIcon } from './icons.js';
import { SingularityWorkspaceViewPane } from './singularityWorkspaceViewPane.js';
import { Testing } from '../../testing/common/constants.js';

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

function registerWorkspace(options: {
	containerId: string;
	viewId: string;
	title: ReturnType<typeof localize2>;
	mnemonicTitle: string;
	icon: typeof singularityPlanViewIcon;
	order: number;
	welcomeLines: string[];
}): void {
	const container = viewContainersRegistry.registerViewContainer({
		id: options.containerId,
		title: options.title,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [options.containerId, { mergeViewWithContainerWhenSingleView: true }]),
		icon: options.icon,
		order: options.order,
		hideIfEmpty: false,
		openCommandActionDescriptor: {
			id: options.containerId,
			mnemonicTitle: options.mnemonicTitle,
			order: options.order,
		},
	}, ViewContainerLocation.Sidebar);

	viewsRegistry.registerViews([{
		id: options.viewId,
		name: options.title,
		containerIcon: options.icon,
		ctorDescriptor: new SyncDescriptor(SingularityWorkspaceViewPane),
		canToggleVisibility: false,
		canMoveView: true,
		weight: 100,
	}], container);

	for (let i = 0; i < options.welcomeLines.length; i++) {
		viewsRegistry.registerViewWelcomeContent(options.viewId, {
			content: options.welcomeLines[i],
			order: i,
		});
	}
}

registerWorkspace({
	containerId: SingularityWorkspaces.PlanContainerId,
	viewId: SingularityWorkspaces.PlanViewId,
	title: localize2('singularity.plan', 'Plan'),
	mnemonicTitle: localize({ key: 'miSingularityPlan', comment: ['&& denotes a mnemonic'] }, "&&Plan"),
	icon: singularityPlanViewIcon,
	order: 7,
	welcomeLines: [
		localize('singularity.plan.welcome', "Design architecture, APIs, milestones, and folder structure before coding."),
		localize('singularity.plan.openChat', "[Open Plan in Chat](command:{0})", SingularityWorkspaceCommands.OpenPlanChat),
	],
});

registerWorkspace({
	containerId: SingularityWorkspaces.RepositoryContainerId,
	viewId: SingularityWorkspaces.RepositoryViewId,
	title: localize2('singularity.repository', 'Repository'),
	mnemonicTitle: localize({ key: 'miSingularityRepository', comment: ['&& denotes a mnemonic'] }, "&&Repository"),
	icon: singularityRepositoryViewIcon,
	order: 8,
	welcomeLines: [
		localize('singularity.repository.welcome', "Repository intelligence — search symbols, call hierarchy, and dependencies."),
		localize('singularity.repository.openSearch', "[Open Search](command:{0})", SingularityWorkspaceCommands.OpenSearch),
		localize('singularity.repository.openAsk', "[Ask Singularity about the codebase](command:{0})", SingularityWorkspaceCommands.OpenAgentChat),
	],
});

registerWorkspace({
	containerId: SingularityWorkspaces.TestingContainerId,
	viewId: SingularityWorkspaces.TestingViewId,
	title: localize2('singularity.testingWorkspace', 'Singularity Testing'),
	mnemonicTitle: localize({ key: 'miSingularityTesting', comment: ['&& denotes a mnemonic'] }, "Singularity T&&esting"),
	icon: singularityTestingViewIcon,
	order: 9,
	welcomeLines: [
		localize('singularity.testing.welcome', "Generate, repair, and improve tests. Use the Testing explorer for runs and coverage."),
		localize('singularity.testing.openExplorer', "[Open Test Explorer](command:{0})", SingularityWorkspaceCommands.OpenTesting),
		localize('singularity.testing.openAgent', "[Generate tests in Chat](command:{0})", SingularityWorkspaceCommands.OpenAgentChat),
	],
});

registerWorkspace({
	containerId: SingularityWorkspaces.DocsContainerId,
	viewId: SingularityWorkspaces.DocsViewId,
	title: localize2('singularity.docs', 'Documentation'),
	mnemonicTitle: localize({ key: 'miSingularityDocs', comment: ['&& denotes a mnemonic'] }, "&&Documentation"),
	icon: singularityDocsViewIcon,
	order: 10,
	welcomeLines: [
		localize('singularity.docs.welcome', "README, API docs, changelogs, and release notes."),
		localize('singularity.docs.openAgent', "[Draft docs in Chat](command:{0})", SingularityWorkspaceCommands.OpenAgentChat),
	],
});

registerWorkspace({
	containerId: SingularityWorkspaces.ArchitectContainerId,
	viewId: SingularityWorkspaces.ArchitectViewId,
	title: localize2('singularity.architect', 'Architect'),
	mnemonicTitle: localize({ key: 'miSingularityArchitect', comment: ['&& denotes a mnemonic'] }, "&&Architect"),
	icon: singularityArchitectViewIcon,
	order: 11,
	welcomeLines: [
		localize('singularity.architect.welcome', "High-level system design — microservices, event flows, schemas, and scaling."),
		localize('singularity.architect.openPlan', "[Open Plan in Chat](command:{0})", SingularityWorkspaceCommands.OpenPlanChat),
		localize('singularity.architect.openAgent', "[Design with Agent](command:{0})", SingularityWorkspaceCommands.OpenAgentChat),
	],
});

function registerOpenChatModeCommand(id: string, title: string, mode: string, query: string): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id,
				title: { value: title, original: title },
				category: CHAT_CATEGORY,
				f1: false,
				icon: Codicon.chatSparkle,
			});
		}
		override async run(accessor: ServicesAccessor): Promise<void> {
			await accessor.get(ICommandService).executeCommand(CHAT_OPEN_ACTION_ID, {
				mode,
				query,
				isPartialQuery: true,
			});
		}
	});
}

registerOpenChatModeCommand(SingularityWorkspaceCommands.OpenPlanChat, 'Open Plan in Chat', 'Plan', '');
registerOpenChatModeCommand(SingularityWorkspaceCommands.OpenDebugChat, 'Open Debug in Chat', 'Debug', '');
registerOpenChatModeCommand(SingularityWorkspaceCommands.OpenReviewChat, 'Open Review in Chat', 'Review', '');
registerOpenChatModeCommand(SingularityWorkspaceCommands.OpenAgentChat, 'Open Agent in Chat', 'agent', '');

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SingularityWorkspaceCommands.OpenSearch,
			title: localize2('singularity.openSearch', 'Open Search'),
			f1: false,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand('workbench.view.search');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SingularityWorkspaceCommands.OpenTesting,
			title: localize2('singularity.openTesting', 'Open Test Explorer'),
			f1: false,
		});
	}
	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand(Testing.ViewletId);
	}
});
