/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../../../base/common/path.js';
import { IProcessEnvironment } from '../../../base/common/platform.js';

export function getSingularityHomePath(userHomePath: string, environment: IProcessEnvironment): string {
	return environment['SINGULARITY_HOME'] || join(userHomePath, '.singularity');
}

export function getSingularityRootPaths(userHomePath: string, environment: IProcessEnvironment): string[] {
	return [...new Set([
		getSingularityHomePath(userHomePath, environment),
		join(userHomePath, '.singularity'),
	])];
}
