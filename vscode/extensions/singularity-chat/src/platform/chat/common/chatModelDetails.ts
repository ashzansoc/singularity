/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * Structured model info for building display details.
 * Lookups store this so consumers can format with per-turn credits at render time.
 */
export interface ModelDetailsInfo {
	readonly name: string;
	readonly multiplier: number | undefined;
}

/**
 * Formats usage details for the chat response footer.
 * Singularity never includes the concrete model name.
 */
export function formatModelDetails(_modelName: string, multiplier: number | undefined, creditsUsed: number | undefined): string {
	if (creditsUsed !== undefined) {
		return formatCreditsOnly(creditsUsed);
	}
	return multiplier !== undefined ? l10n.t('{0}x', multiplier) : '';
}

function formatCreditsOnly(creditsUsed: number): string {
	const formatted = creditsUsed % 1 === 0 ? creditsUsed.toString() : creditsUsed.toFixed(1);
	return creditsUsed === 1
		? l10n.t('{0} credit', formatted)
		: l10n.t('{0} credits', formatted);
}

/**
 * Formats model details with credit usage for display.
 * Returns a localized string like "5 credits" or "1 credit" (no model name).
 */
export function formatModelDetailsWithCredits(_modelName: string, creditsUsed: number): string {
	return formatCreditsOnly(creditsUsed);
}

/**
 * Formats model details with a multiplier suffix for display.
 * Returns "2x" when multiplier is defined, otherwise empty (no model name).
 */
export function formatModelDetailsWithMultiplier(_modelName: string, multiplier: number | undefined): string {
	return multiplier !== undefined ? l10n.t('{0}x', multiplier) : '';
}

/**
 * Formats usage details for Auto mode. Credits/multiplier only — never the routed model.
 */
export function formatAutoModeDetails(creditsUsed: number | undefined, multiplier: number | undefined): string {
	return formatModelDetails('', multiplier, creditsUsed);
}
