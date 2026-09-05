/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Tracks owned paths for active executions so parent agents cannot implement child tasks. */
export class ExecutionOwnedPathsRegistry {
	private readonly _byParentSession = new Map<string, Set<string>>();

	register(parentSessionKey: string, ownedPaths: readonly string[]): void {
		const normalized = new Set(ownedPaths.map(normalizeOwnedPath).filter(Boolean));
		if (normalized.size === 0) {
			return;
		}
		const existing = this._byParentSession.get(parentSessionKey);
		if (existing) {
			for (const p of normalized) {
				existing.add(p);
			}
			return;
		}
		this._byParentSession.set(parentSessionKey, normalized);
	}

	clear(parentSessionKey: string): void {
		this._byParentSession.delete(parentSessionKey);
	}

	isPathOwnedByChild(parentSessionKey: string, filePath: string): boolean {
		const owned = this._byParentSession.get(parentSessionKey);
		if (!owned || owned.size === 0) {
			return false;
		}
		const normalized = normalizeOwnedPath(filePath);
		for (const prefix of owned) {
			if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
				return true;
			}
		}
		return false;
	}

	hasActiveExecution(parentSessionKey: string): boolean {
		const owned = this._byParentSession.get(parentSessionKey);
		return Boolean(owned && owned.size > 0);
	}
}

function normalizeOwnedPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export const executionOwnedPathsRegistry = new ExecutionOwnedPathsRegistry();
