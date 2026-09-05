/**
 * Level 2 — In-memory Context Graph with optional durable snapshot.
 */

import { estimateTokens, sha256, sha256Object } from '../hash.js';
import type { ContextGraph } from '../interfaces/index.js';
import type { GraphEdge, GraphNode, NodeKind } from './types.js';

export class InMemoryContextGraph implements ContextGraph {
	private readonly nodes = new Map<string, GraphNode>();
	private readonly edges = new Map<string, GraphEdge>();
	private readonly out = new Map<string, Set<string>>();
	private readonly inn = new Map<string, Set<string>>();

	upsertNode(node: GraphNode): void {
		this.nodes.set(node.id, node);
	}

	removeNode(id: string): void {
		this.nodes.delete(id);
		this.removeEdges(id);
	}

	getNode(id: string): GraphNode | undefined {
		return this.nodes.get(id);
	}

	listNodes(kind?: NodeKind): GraphNode[] {
		const all = [...this.nodes.values()];
		return kind ? all.filter((n) => n.kind === kind) : all;
	}

	addEdge(edge: GraphEdge): void {
		this.edges.set(edge.id, edge);
		if (!this.out.has(edge.from)) {
			this.out.set(edge.from, new Set());
		}
		if (!this.inn.has(edge.to)) {
			this.inn.set(edge.to, new Set());
		}
		this.out.get(edge.from)!.add(edge.id);
		this.inn.get(edge.to)!.add(edge.id);
	}

	removeEdges(nodeId: string): void {
		const edgeIds = [
			...(this.out.get(nodeId) ?? []),
			...(this.inn.get(nodeId) ?? []),
		];
		for (const eid of edgeIds) {
			const e = this.edges.get(eid);
			if (!e) {
				continue;
			}
			this.edges.delete(eid);
			this.out.get(e.from)?.delete(eid);
			this.inn.get(e.to)?.delete(eid);
		}
	}

	neighbors(id: string, kind?: GraphEdge['kind']): GraphNode[] {
		const result: GraphNode[] = [];
		for (const eid of this.out.get(id) ?? []) {
			const e = this.edges.get(eid);
			if (!e || (kind && e.kind !== kind)) {
				continue;
			}
			const n = this.nodes.get(e.to);
			if (n) {
				result.push(n);
			}
		}
		return result;
	}

	repoHash(): string {
		const files = this.listNodes('file')
			.map((n) => ({ id: n.id, hash: n.hash }))
			.sort((a, b) => a.id.localeCompare(b.id));
		return sha256Object(files);
	}

	snapshot(): { nodes: GraphNode[]; edges: GraphEdge[] } {
		return {
			nodes: [...this.nodes.values()],
			edges: [...this.edges.values()],
		};
	}

	materialize(nodeId: string): string {
		const n = this.nodes.get(nodeId);
		if (!n) {
			return '';
		}
		const symbolKinds = new Set(['function', 'class', 'interface', 'symbol']);
		if (symbolKinds.has(n.kind)) {
			const uri = n.meta?.uri ? ` // ${n.meta.uri}:${n.meta.startLine ?? '?'}` : '';
			const body = (n.content ?? '').slice(0, 4_000);
			return body
				? `[${n.kind}] ${n.label}${uri}\n${body}`
				: `[${n.kind}] ${n.label}${uri}`;
		}
		if (n.kind === 'file') {
			const children = this.neighbors(nodeId, 'contains').filter((c) =>
				symbolKinds.has(c.kind),
			);
			if (children.length) {
				return children
					.slice(0, 10)
					.map((c) => this.materialize(c.id))
					.join('\n\n')
					.slice(0, 8_000);
			}
			if (n.content) {
				return n.content.slice(0, 2_000);
			}
			return `[file] ${n.label}`;
		}
		if (n.content) {
			return n.content;
		}
		const parts = [`[${n.kind}] ${n.label}`];
		if (n.meta) {
			parts.push(JSON.stringify(n.meta));
		}
		return parts.join('\n');
	}

	static fileId(uri: string): string {
		return `file:${uri}`;
	}

	static makeNode(
		partial: Omit<GraphNode, 'hash' | 'tokenCount' | 'dependencies' | 'version' | 'lastModified'> &
			Partial<GraphNode>,
	): GraphNode {
		const content = partial.content ?? '';
		return {
			id: partial.id,
			kind: partial.kind,
			label: partial.label,
			content: partial.content,
			hash: partial.hash ?? sha256(content || partial.id),
			version: partial.version ?? 1,
			tokenCount: partial.tokenCount ?? estimateTokens(content || partial.label),
			embedding: partial.embedding,
			dependencies: partial.dependencies ?? [],
			lastModified: partial.lastModified ?? Date.now(),
			meta: partial.meta,
		};
	}
}
