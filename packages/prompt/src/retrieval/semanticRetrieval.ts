/**
 * Level 4 — Semantic Retrieval Engine (symbol-first + hybrid lexical)
 */

import { cosineSimilarity, DefaultHashEmbedder } from '../embed/hashEmbedder.js';
import type {
	ContextGraph,
	Embedder,
	MemoryManager,
	RetrievalEngine,
	RetrievalHit,
	RetrievalQuery,
} from '../interfaces/index.js';
import { estimateTokens, sha256 } from '../hash.js';

export interface SemanticRetrievalOptions {
	graph: ContextGraph;
	memory: MemoryManager;
	embedder?: Embedder;
	/** Prefer symbols over whole files (default true). */
	symbolFirst?: boolean;
	/** Extra lexical hits from rg / searchText (source: search). */
	externalHits?: RetrievalHit[];
}

const SYMBOL_KINDS = new Set(['function', 'class', 'interface', 'symbol', 'export']);

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_$]+/g)
		.filter((t) => t.length > 2);
}

function lexicalOverlap(queryTokens: Set<string>, text: string): number {
	const toks = tokenize(text);
	if (!toks.length || !queryTokens.size) {
		return 0;
	}
	let hit = 0;
	for (const t of toks) {
		if (queryTokens.has(t)) {
			hit++;
		}
	}
	return hit / Math.max(queryTokens.size, 1);
}

export class SemanticRetrievalEngine implements RetrievalEngine {
	private readonly graph: ContextGraph;
	private readonly memory: MemoryManager;
	private readonly embedder: Embedder;
	private readonly symbolFirst: boolean;
	private externalHits: RetrievalHit[];

	constructor(options: SemanticRetrievalOptions) {
		this.graph = options.graph;
		this.memory = options.memory;
		this.embedder = options.embedder ?? new DefaultHashEmbedder();
		this.symbolFirst = options.symbolFirst !== false;
		this.externalHits = options.externalHits ?? [];
	}

	setExternalHits(hits: RetrievalHit[]): void {
		this.externalHits = hits;
	}

	async retrieve(query: RetrievalQuery): Promise<RetrievalHit[]> {
		const topK = query.topK ?? 24;
		const qText = [
			query.prompt,
			query.selectionText ?? '',
			...(query.diagnostics ?? []).map((d) => d.message),
			query.gitDiff?.slice(0, 2000) ?? '',
		]
			.filter(Boolean)
			.join('\n');
		const qEmb = await Promise.resolve(this.embedder.embed(qText));
		const qTokens = new Set(tokenize(qText));

		const hits: RetrievalHit[] = [...this.externalHits];
		const open = new Set(query.openFileUris ?? []);
		if (query.cursorUri) {
			open.add(query.cursorUri);
		}

		for (const node of this.graph.listNodes()) {
			if (node.kind === 'repository' || node.kind === 'folder') {
				continue;
			}
			const isSymbol = SYMBOL_KINDS.has(node.kind);
			const isFile = node.kind === 'file';

			let score = 0;
			const reasons: string[] = [];
			if (node.embedding) {
				const sim = cosineSimilarity(qEmb, node.embedding);
				score += sim * 0.45;
				if (sim > 0.2) {
					reasons.push('embed');
				}
			}
			const hay = `${node.label}\n${node.content ?? ''}`.slice(0, 8_000);
			const lex = lexicalOverlap(qTokens, hay);
			if (lex > 0) {
				score += Math.min(0.4, lex) * 0.35;
				reasons.push('lexical');
			}
			if (this.symbolFirst && isSymbol) {
				score += 0.12;
				reasons.push('symbol');
			} else if (isFile) {
				score -= 0.05;
			}

			const uri = String(node.meta?.uri ?? node.label);
			if (query.cursorUri && (uri === query.cursorUri || node.id.includes(query.cursorUri))) {
				score += isSymbol ? 0.4 : 0.25;
				reasons.push('current-file');
			} else if (open.has(uri)) {
				score += 0.12;
				reasons.push('open-file');
			}
			if (query.selectionText && node.content?.includes(query.selectionText.slice(0, 40))) {
				score += 0.2;
				reasons.push('selection');
			}
			const ageBoost = 1 / (1 + (Date.now() - node.lastModified) / 86_400_000);
			score += ageBoost * 0.05;
			if (score > 0.1) {
				hits.push({
					nodeId: node.id,
					score,
					reason: reasons.join('+') || 'score',
				});
			}
		}

		const memHits = this.memory.semanticSearch(qEmb, Math.min(8, topK));
		for (const m of memHits) {
			hits.push({
				nodeId: m.id,
				score: 0.4 + m.importance * 0.3,
				reason: `memory:${m.scope}`,
			});
			this.graph.upsertNode(m);
		}

		if (query.gitDiff) {
			const gitId = `git:${sha256(query.gitDiff).slice(0, 16)}`;
			this.graph.upsertNode({
				id: gitId,
				kind: 'git',
				label: 'git-diff',
				content: query.gitDiff.slice(0, 12_000),
				hash: sha256(query.gitDiff),
				version: 1,
				tokenCount: Math.ceil(Math.min(query.gitDiff.length, 12_000) / 4),
				dependencies: [],
				lastModified: Date.now(),
			});
			hits.push({ nodeId: gitId, score: 0.45, reason: 'git-diff' });
		}

		for (const d of query.diagnostics ?? []) {
			const id = `diag:${d.uri}:${sha256(d.message).slice(0, 12)}`;
			this.graph.upsertNode({
				id,
				kind: 'diagnostic',
				label: d.message.slice(0, 80),
				content: `${d.severity ?? 'info'}: ${d.message}`,
				hash: sha256(d.message),
				version: 1,
				tokenCount: Math.ceil(d.message.length / 4),
				dependencies: [],
				lastModified: Date.now(),
				meta: { uri: d.uri, severity: d.severity },
			});
			hits.push({ nodeId: id, score: 0.5, reason: 'diagnostic' });
		}

		hits.sort((a, b) => b.score - a.score);
		const seen = new Set<string>();
		const unique: RetrievalHit[] = [];
		for (const h of hits) {
			if (seen.has(h.nodeId)) {
				continue;
			}
			seen.add(h.nodeId);
			unique.push(h);
			if (unique.length >= topK) {
				break;
			}
		}

		return this.expandDependencies(unique, topK);
	}

	/** 1-hop callers / callees / depends_on, capped by token budget. */
	private expandDependencies(seed: RetrievalHit[], topK: number): RetrievalHit[] {
		const out = [...seed];
		const seen = new Set(seed.map((h) => h.nodeId));
		const tokenBudget = 6_000;
		let tokens = 0;

		for (const h of seed.slice(0, 12)) {
			const node = this.graph.getNode(h.nodeId);
			if (!node) {
				continue;
			}
			tokens += node.tokenCount || estimateTokens(node.content ?? node.label);
			const neighborLists = [
				this.graph.neighbors(h.nodeId, 'calls'),
				this.graph.neighbors(h.nodeId, 'depends_on'),
				this.graph.neighbors(h.nodeId, 'imports'),
				this.graph.neighbors(h.nodeId, 'contains'),
			];
			const parent = String(node.meta?.parent ?? '');
			if (parent) {
				neighborLists.push(this.graph.neighbors(parent, 'contains'));
			}
			for (const list of neighborLists) {
				for (const n of list.slice(0, 4)) {
					if (seen.has(n.id)) {
						continue;
					}
					if (!SYMBOL_KINDS.has(n.kind) && n.kind !== 'file' && n.kind !== 'import') {
						continue;
					}
					const t = n.tokenCount || estimateTokens(n.content ?? n.label);
					if (tokens + t > tokenBudget) {
						continue;
					}
					if (n.kind === 'file' && t > 400) {
						continue;
					}
					seen.add(n.id);
					tokens += t;
					out.push({
						nodeId: n.id,
						score: h.score * 0.7,
						reason: `dep:${h.nodeId}`,
					});
				}
			}
			if (out.length >= topK + 16) {
				break;
			}
		}
		out.sort((a, b) => b.score - a.score);
		return out.slice(0, topK + 12);
	}
}

/** Materialize a hit as a symbol snippet (not whole file by default). */
export function materializeSymbolSnippet(
	graph: ContextGraph,
	nodeId: string,
	maxChars = 4_000,
): string {
	const n = graph.getNode(nodeId);
	if (!n) {
		return '';
	}
	if (SYMBOL_KINDS.has(n.kind)) {
		const body = (n.content ?? n.label).slice(0, maxChars);
		const uri = n.meta?.uri ? ` // ${n.meta.uri}:${n.meta.startLine ?? '?'}` : '';
		return `[${n.kind}] ${n.label}${uri}\n${body}`;
	}
	if (n.kind === 'file') {
		const children = graph
			.neighbors(nodeId, 'contains')
			.filter((c) => SYMBOL_KINDS.has(c.kind))
			.slice(0, 8);
		if (children.length) {
			return children
				.map((c) =>
					materializeSymbolSnippet(graph, c.id, Math.floor(maxChars / children.length)),
				)
				.join('\n\n');
		}
		return (n.content ?? '').slice(0, Math.min(maxChars, 2_000));
	}
	return graph.materialize(nodeId).slice(0, maxChars);
}
