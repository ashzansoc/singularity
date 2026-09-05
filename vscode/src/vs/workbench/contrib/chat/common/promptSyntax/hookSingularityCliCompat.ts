/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HOOKS_BY_TARGET, HookType } from './hookTypes.js';
import { Target } from './promptTypes.js';

const SINGULARITY_CLI_HOOK_TYPE_MAP: Record<string, HookType> = HOOKS_BY_TARGET[Target.Singularity];

/**
 * Cached inverse mapping from HookType to Singularity CLI hook type name.
 * Lazily computed on first access.
 */
let _hookTypeToSingularityCliName: Map<HookType, string> | undefined;

function getHookTypeToSingularityCliNameMap(): Map<HookType, string> {
	if (!_hookTypeToSingularityCliName) {
		_hookTypeToSingularityCliName = new Map();
		for (const [singularityCliName, hookType] of Object.entries(SINGULARITY_CLI_HOOK_TYPE_MAP)) {
			_hookTypeToSingularityCliName.set(hookType, singularityCliName);
		}
	}
	return _hookTypeToSingularityCliName;
}

/**
 * Resolves a Singularity CLI hook type name to our abstract HookType.
 */
export function resolveSingularityCliHookType(name: string): HookType | undefined {
	return (SINGULARITY_CLI_HOOK_TYPE_MAP as Record<string, HookType>)[name];
}

/**
 * Gets the Singularity CLI hook type name for a given abstract HookType.
 * Returns undefined if the hook type is not supported in Singularity CLI.
 */
export function getSingularityCliHookTypeName(hookType: HookType): string | undefined {
	return getHookTypeToSingularityCliNameMap().get(hookType);
}
