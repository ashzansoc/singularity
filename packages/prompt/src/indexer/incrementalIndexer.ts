/**
 * Level 1 — Incremental Repository Indexer
 */

import type { Embedder, FileChangeEvent, IncrementalIndexer, LanguageExtractor } from '../interfaces/index.js';
import { InMemoryContextGraph } from '../graph/contextGraph.js';
import type { ContextGraph } from '../interfaces/index.js';
import { estimateTokens, sha256 } from '../hash.js';
import { defaultExtractors, pickExtractor } from './extractors.js';
import {
	ensureTreeSitterReady,
	isTreeSitterReady,
	setAllowFallback,
	treeSitterExtractors,
} from './treeSitterExtractor.js';
import { DefaultHashEmbedder } from '../embed/hashEmbedder.js';

export interface IncrementalIndexerOptions {
	graph: ContextGraph;
	embedder?: Embedder;
	extractors?: LanguageExtractor[];
	repositoryId?: string;
	/** When false, skip structural/regex if Tree-sitter is unavailable. Default true. */
	allowFallback?: boolean;
}

export class DefaultIncrementalIndexer implements IncrementalIndexer {
	private readonly graph: ContextGraph;
	private readonly embedder: Embedder;
	private readonly extractors: LanguageExtractor[];
	private readonly dirty = new Set<string>();
	private readonly fileHashes = new Map<string, string>();
	private readonly repositoryId: string;
	private readonly allowFallback: boolean;
	private treeSitterReady = false;

	constructor(options: IncrementalIndexerOptions) {
		this.graph = options.graph;
		this.embedder = options.embedder ?? new DefaultHashEmbedder();
		// Tree-sitter extractors are PRIMARY; regex extractors only as pickExtractor fallbacks for unknown langs
		this.extractors = options.extractors ?? [...treeSitterExtractors(), ...defaultExtractors()];
		this.repositoryId = options.repositoryId ?? 'repo:default';
		this.allowFallback = options.allowFallback !== false;
		setAllowFallback(this.allowFallback);

		if (!this.graph.getNode(this.repositoryId)) {
			this.graph.upsertNode(
				InMemoryContextGraph.makeNode({
					id: this.repositoryId,
					kind: 'repository',
					label: 'repository',
				}),
			);
		}
	}

	/** Ensure Tree-sitter WASM grammars are loaded (PRIMARY parser). */
	async ensureReady(): Promise<boolean> {
		if (this.treeSitterReady && isTreeSitterReady()) {
			return true;
		}
		this.treeSitterReady = await ensureTreeSitterReady({
			allowFallback: this.allowFallback,
		});
		return this.treeSitterReady;
	}

	async indexFile(event: FileChangeEvent): Promise<void> {
		await this.ensureReady();

		if (event.removed) {
			this.removeFile(event.uri);
			return;
		}

		const contentHash = sha256(event.content);
		const prev = this.fileHashes.get(event.uri);
		if (prev === contentHash) {
			return;
		}

		const fileId = InMemoryContextGraph.fileId(event.uri);
		this.removeFileChildren(fileId);

		const embedding = await Promise.resolve(this.embedder.embed(event.content.slice(0, 8000)));
		const fileNode = InMemoryContextGraph.makeNode({
			id: fileId,
			kind: 'file',
			label: event.uri,
			content: event.content,
			hash: contentHash,
			version: event.version,
			embedding,
			tokenCount: estimateTokens(event.content),
			meta: { uri: event.uri, languageId: event.languageId },
		});
		this.graph.upsertNode(fileNode);
		this.graph.addEdge({
			id: `e:${this.repositoryId}->${fileId}`,
			from: this.repositoryId,
			to: fileId,
			kind: 'contains',
		});

		const extractor = pickExtractor(this.extractors, event.languageId);
		const extracted = extractor?.extract({
			uri: event.uri,
			content: event.content,
			languageId: event.languageId,
		});

		const deps: string[] = [];
		if (extracted) {
			for (const sym of extracted.symbols) {
				const sid = `${fileId}:${sym.kind}:${sym.name}:${sym.startLine ?? 0}`;
				const sn = InMemoryContextGraph.makeNode({
					id: sid,
					kind: sym.kind,
					label: sym.name,
					content: sym.content ?? sym.name,
					embedding: await Promise.resolve(
						this.embedder.embed(`${sym.name}\n${sym.content ?? ''}`),
					),
					meta: {
						uri: event.uri,
						startLine: sym.startLine,
						endLine: sym.endLine,
						parent: fileId,
					},
				});
				this.graph.upsertNode(sn);
				this.graph.addEdge({
					id: `e:${fileId}->${sid}`,
					from: fileId,
					to: sid,
					kind: 'contains',
				});
				deps.push(sid);
			}
			for (const imp of extracted.imports) {
				const iid = `${fileId}:import:${imp.name}:${imp.from}`;
				this.graph.upsertNode(
					InMemoryContextGraph.makeNode({
						id: iid,
						kind: 'import',
						label: `${imp.name} from ${imp.from}`,
						meta: { uri: event.uri, from: imp.from, name: imp.name },
					}),
				);
				this.graph.addEdge({
					id: `e:${fileId}->${iid}`,
					from: fileId,
					to: iid,
					kind: 'imports',
				});
			}
			for (const exp of extracted.exports) {
				const eid = `${fileId}:export:${exp.name}`;
				this.graph.upsertNode(
					InMemoryContextGraph.makeNode({
						id: eid,
						kind: 'export',
						label: exp.name,
						meta: { uri: event.uri, name: exp.name },
					}),
				);
				this.graph.addEdge({
					id: `e:${fileId}->${eid}`,
					from: fileId,
					to: eid,
					kind: 'exports',
				});
			}
			for (const call of extracted.calls ?? []) {
				const fromId = `${fileId}:function:${call.from}:0`;
				const toHint = call.to;
				this.graph.addEdge({
					id: `e:call:${fromId}->${toHint}`,
					from: fromId,
					to: `${fileId}:function:${toHint}:0`,
					kind: 'calls',
					weight: 1,
				});
			}
		}

		fileNode.dependencies = deps;
		this.graph.upsertNode(fileNode);
		this.fileHashes.set(event.uri, contentHash);
		this.dirty.add(event.uri);
	}

	removeFile(uri: string): void {
		const fileId = InMemoryContextGraph.fileId(uri);
		this.removeFileChildren(fileId);
		this.graph.removeNode(fileId);
		this.fileHashes.delete(uri);
		this.dirty.add(uri);
	}

	getFileHash(uri: string): string | undefined {
		return this.fileHashes.get(uri);
	}

	dirtyUris(): string[] {
		return [...this.dirty];
	}

	clearDirty(): void {
		this.dirty.clear();
	}

	private removeFileChildren(fileId: string): void {
		const children = this.graph.neighbors(fileId);
		for (const c of children) {
			this.graph.removeNode(c.id);
		}
		this.graph.removeEdges(fileId);
	}
}
