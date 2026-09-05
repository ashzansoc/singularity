/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { linesDiffComputers } from '../../../../../../editor/common/diff/linesDiffComputers.js';

export type DiffSnippetLineKind = 'context' | 'added' | 'removed';

export interface DiffSnippetLine {
	readonly kind: DiffSnippetLineKind;
	/** 1-based line number shown in the gutter (original for removed/context, modified for added). */
	readonly lineNumber: number;
	readonly text: string;
}

export interface DiffSnippetPreview {
	readonly lines: DiffSnippetLine[];
	readonly added: number;
	readonly removed: number;
}

const DEFAULT_MAX_LINES = 12;
const DEFAULT_CONTEXT = 1;

/**
 * Builds a compact Cursor-style unified diff preview (few context lines +
 * first changed hunks) suitable for an inline chat card.
 */
export function computeDiffSnippetPreview(
	original: string,
	modified: string,
	options?: { maxLines?: number; contextLines?: number },
): DiffSnippetPreview {
	const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;
	const contextLines = options?.contextLines ?? DEFAULT_CONTEXT;
	const originalLines = splitLines(original);
	const modifiedLines = splitLines(modified);

	const diff = linesDiffComputers.getDefault().computeDiff(originalLines, modifiedLines, {
		ignoreTrimWhitespace: false,
		maxComputationTimeMs: 200,
		computeMoves: false,
	});

	let added = 0;
	let removed = 0;
	const lines: DiffSnippetLine[] = [];

	for (const change of diff.changes) {
		if (lines.length >= maxLines) {
			break;
		}

		const origStart = change.original.startLineNumber;
		const origEnd = change.original.endLineNumberExclusive;
		const modStart = change.modified.startLineNumber;
		const modEnd = change.modified.endLineNumberExclusive;

		const contextStart = Math.max(1, Math.min(origStart, modStart) - contextLines);
		// Prefer original-side context numbering for unchanged lead-in.
		for (let line = contextStart; line < origStart && lines.length < maxLines; line++) {
			lines.push({
				kind: 'context',
				lineNumber: line,
				text: originalLines[line - 1] ?? '',
			});
		}

		for (let line = origStart; line < origEnd && lines.length < maxLines; line++) {
			removed++;
			lines.push({
				kind: 'removed',
				lineNumber: line,
				text: originalLines[line - 1] ?? '',
			});
		}

		for (let line = modStart; line < modEnd && lines.length < maxLines; line++) {
			added++;
			lines.push({
				kind: 'added',
				lineNumber: line,
				text: modifiedLines[line - 1] ?? '',
			});
		}
	}

	// Counts from the full diff, not just the truncated preview.
	let totalAdded = 0;
	let totalRemoved = 0;
	for (const change of diff.changes) {
		totalAdded += Math.max(0, change.modified.endLineNumberExclusive - change.modified.startLineNumber);
		totalRemoved += Math.max(0, change.original.endLineNumberExclusive - change.original.startLineNumber);
	}

	return {
		lines,
		added: totalAdded || added,
		removed: totalRemoved || removed,
	};
}

function splitLines(text: string): string[] {
	if (text.length === 0) {
		return [];
	}
	const lines = text.split(/\r?\n/);
	// Trailing newline yields an empty final segment — drop it for line counts.
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}
