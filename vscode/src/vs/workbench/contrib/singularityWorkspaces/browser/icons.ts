/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

export const singularityPlanViewIcon = registerIcon('singularity-plan-view-icon', Codicon.tasklist, localize('singularityPlanViewIcon', 'View icon of the Singularity Plan workspace.'));
export const singularityRepositoryViewIcon = registerIcon('singularity-repository-view-icon', Codicon.search, localize('singularityRepositoryViewIcon', 'View icon of the Singularity Repository workspace.'));
export const singularityTestingViewIcon = registerIcon('singularity-testing-view-icon', Codicon.beaker, localize('singularityTestingViewIcon', 'View icon of the Singularity Testing workspace.'));
export const singularityDocsViewIcon = registerIcon('singularity-docs-view-icon', Codicon.book, localize('singularityDocsViewIcon', 'View icon of the Singularity Documentation workspace.'));
export const singularityArchitectViewIcon = registerIcon('singularity-architect-view-icon', Codicon.typeHierarchySub, localize('singularityArchitectViewIcon', 'View icon of the Singularity Architect workspace.'));
