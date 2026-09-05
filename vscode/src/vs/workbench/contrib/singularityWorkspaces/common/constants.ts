/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SingularityWorkspaces = {
	PlanContainerId: 'workbench.view.extension.singularityPlan',
	PlanViewId: 'singularity.plan.view',

	RepositoryContainerId: 'workbench.view.extension.singularityRepository',
	RepositoryViewId: 'singularity.repository.view',

	TestingContainerId: 'workbench.view.extension.singularityTesting',
	TestingViewId: 'singularity.testing.view',

	DocsContainerId: 'workbench.view.extension.singularityDocs',
	DocsViewId: 'singularity.docs.view',

	ArchitectContainerId: 'workbench.view.extension.singularityArchitect',
	ArchitectViewId: 'singularity.architect.view',
} as const;

export const SingularityWorkspaceCommands = {
	OpenPlanChat: 'singularity.workspaces.openPlanChat',
	OpenDebugChat: 'singularity.workspaces.openDebugChat',
	OpenReviewChat: 'singularity.workspaces.openReviewChat',
	OpenAgentChat: 'singularity.workspaces.openAgentChat',
	OpenSearch: 'singularity.workspaces.openSearch',
	OpenTesting: 'singularity.workspaces.openTesting',
} as const;
