/**
 * Durable permanent Repo Map — persists symbol/file graph across sessions.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ContextGraph } from '../interfaces/index.js';
import type { GraphEdge, GraphNode } from '../graph/types.js';
import { estimateTokens, sha256 } from '../hash.js';
import { renderRepoMapSummary } from './repoMapSummary.js';

export interface DurableRepoMapSnapshot {
	version: number;
	workspaceId: string;
	updatedAt: number;
	nodes: GraphNode[];
	edges: GraphEdge[];
	fileHashes: Record<string, string>;
}

export interface DurableRepoMapOptions {
	workspaceId: string;
	dir?: string;
	filename?: string;
	graph: ContextGraph;
}

export class DurableRepoMap {
	private readonly workspaceId: string;
	private readonly filePath: string | undefined;
	private readonly graph: ContextGraph;
	private fileHashes = new Map<string, string>();

	constructor(options: DurableRepoMapOptions) {
		this.workspaceId = options.workspaceId;
		this.graph = options.graph;
		if (options.dir) {
			mkdirSync(options.dir, { recursive: true });
			const slug = sha256(options.workspaceId).slice(0, 16);
			this.filePath = join(
				options.dir,
				options.filename ?? `singularity-repomap-${slug}.json`,
			);
			this.load();
		}
	}

	getFileHash(uri: string): string | undefined {
		return this.fileHashes.get(uri);
	}

	setFileHash(uri: string, hash: string): void {
		this.fileHashes.set(uri, hash);
	}

	/** Resolve relative import specifiers to file URIs already in the graph. */
	resolveImportEdges(): number {
		let added = 0;
		const files = this.graph.listNodes('file');
		const byPath = new Map<string, GraphNode>();
		for (const f of files) {
			const uri = String(f.meta?.uri ?? f.label);
			byPath.set(uri, f);
			byPath.set(uri.replace(/^file:\/\//, ''), f);
			const base = uri.split('/').pop()?.replace(/\.(tsx?|jsx?|py)$/, '');
			if (base) {
				byPath.set(base, f);
			}
		}

		for (const f of files) {
			const fileId = f.id;
			for (const n of this.graph.neighbors(fileId, 'imports')) {
				const from = String(n.meta?.from ?? '');
				if (!from) {
					continue;
				}
				const candidates = [
					from,
					`${from}.ts`,
					`${from}.tsx`,
					`${from}.js`,
					`${from}/index.ts`,
					from.replace(/^\.\//, ''),
				];
				const parentUri = String(f.meta?.uri ?? f.label);
				const parentDir = parentUri.includes('/')
					? parentUri.slice(0, parentUri.lastIndexOf('/'))
					: '';
				for (const c of candidates) {
					const abs = c.startsWith('.')
						? normalizePath(`${parentDir}/${c}`)
						: c;
					const target =
						byPath.get(abs) ||
						byPath.get(abs.replace(/\.(tsx?|jsx?)$/, '')) ||
						byPath.get(c.replace(/^\.\//, '').replace(/\.(tsx?|jsx?)$/, ''));
					if (target && target.id !== fileId) {
						const eid = `e:depends:${fileId}->${target.id}`;
						this.graph.addEdge({
							id: eid,
							from: fileId,
							to: target.id,
							kind: 'depends_on',
							weight: 1,
						});
						added++;
						break;
					}
				}
			}
		}
		return added;
	}

	/** Compact Aider-style map for the repository IR block. */
	renderSummary(maxTokens = 3_000): string {
		return renderRepoMapSummary(this.graph, { maxTokens, workspaceId: this.workspaceId });
	}

	/** Upsert a synthetic repository summary node into the graph. */
	upsertSummaryNode(maxTokens = 3_000): string {
		const text = this.renderSummary(maxTokens);
		const id = `repository:map:${this.workspaceId}`;
		this.graph.upsertNode({
			id,
			kind: 'repository',
			label: 'repo-map',
			content: text,
			hash: sha256(text),
			version: 1,
			tokenCount: estimateTokens(text),
			dependencies: [],
			lastModified: Date.now(),
			meta: { workspaceId: this.workspaceId, kind: 'repo-map' },
		});
		return id;
	}

	persist(): void {
		if (!this.filePath) {
			return;
		}
		const snap: DurableRepoMapSnapshot = {
			version: 1,
			workspaceId: this.workspaceId,
			updatedAt: Date.now(),
			nodes: this.graph.listNodes().filter((n) =>
				['repository', 'folder', 'file', 'function', 'class', 'interface', 'symbol', 'import', 'export'].includes(
					n.kind,
				),
			),
			edges: this.graph.snapshot().edges,
			fileHashes: Object.fromEntries(this.fileHashes),
		};
		mkdirSync(dirname(this.filePath), { recursive: true });
		writeFileSync(this.filePath, JSON.stringify(snap), 'utf8');
	}

	load(): void {
		if (!this.filePath || !existsSync(this.filePath)) {
			return;
		}
		try {
			const raw = readFileSync(this.filePath, 'utf8');
			const snap = JSON.parse(raw) as DurableRepoMapSnapshot;
			if (snap.workspaceId && snap.workspaceId !== this.workspaceId) {
				return;
			}
			for (const n of snap.nodes ?? []) {
				this.graph.upsertNode(n);
			}
			for (const e of snap.edges ?? []) {
				this.graph.addEdge(e);
			}
			this.fileHashes = new Map(Object.entries(snap.fileHashes ?? {}));
		} catch {
			// corrupt → start empty
		}
	}

	stats(): { files: number; symbols: number; edges: number } {
		const files = this.graph.listNodes('file').length;
		const symbols = this.graph
			.listNodes()
			.filter((n) => ['function', 'class', 'interface', 'symbol'].includes(n.kind)).length;
		const edges = this.graph.snapshot().edges.length;
		return { files, symbols, edges };
	}
}

function normalizePath(p: string): string {
	const parts = p.replace(/\\/g, '/').split('/');
	const out: string[] = [];
	for (const part of parts) {
		if (part === '..') {
			out.pop();
		} else if (part && part !== '.') {
			out.push(part);
		}
	}
	return out.join('/');
}
