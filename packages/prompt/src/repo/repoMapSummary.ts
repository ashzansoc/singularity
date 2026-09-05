/**
 * Compact Aider-style repository map for stable prompt prefixes.
 */

import type { ContextGraph } from '../interfaces/index.js';
import { estimateTokens } from '../hash.js';

export function renderRepoMapSummary(
	graph: ContextGraph,
	options: { maxTokens?: number; workspaceId?: string } = {},
): string {
	const maxTokens = options.maxTokens ?? 3_000;
	const files = graph.listNodes('file').sort((a, b) => a.label.localeCompare(b.label));
	const lines: string[] = [
		`Repository map${options.workspaceId ? ` (${options.workspaceId})` : ''}`,
		'│',
	];

	const tree = new Map<string, string[]>();
	for (const f of files) {
		const uri = String(f.meta?.uri ?? f.label);
		const parts = uri.replace(/^file:\/\//, '').split('/');
		const fileName = parts.pop() ?? uri;
		const dir = parts.slice(-3).join('/') || '.';
		const bucket = tree.get(dir) ?? [];
		const symbols = graph
			.neighbors(f.id, 'contains')
			.filter((n) => ['function', 'class', 'interface', 'symbol'].includes(n.kind))
			.slice(0, 12)
			.map((n) => `${n.kind[0]}${n.kind === 'interface' ? 'i' : ''}:${n.label}`)
			.join(', ');
		bucket.push(symbols ? `${fileName}  (${symbols})` : fileName);
		tree.set(dir, bucket);
	}

	for (const [dir, entries] of [...tree.entries()].slice(0, 80)) {
		lines.push(`├── ${dir}/`);
		for (const e of entries.slice(0, 24)) {
			lines.push(`│   ├── ${e}`);
		}
		const draft = lines.join('\n');
		if (estimateTokens(draft) > maxTokens) {
			lines.push('│   └── …');
			break;
		}
	}

	lines.push('└── (end)');
	let text = lines.join('\n');
	while (estimateTokens(text) > maxTokens && lines.length > 4) {
		lines.splice(lines.length - 2, 1);
		text = lines.join('\n');
	}
	return text;
}
