/**
 * Feature 7 — Graph Diff Engine
 */

import type { GraphNode } from '../graph/types.js';
import type { GraphDiff, GraphDiffEngine } from '../interfaces/v3.js';

export class DefaultGraphDiffEngine implements GraphDiffEngine {
	diff(
		prev: { nodes: GraphNode[] },
		next: { nodes: GraphNode[] },
	): GraphDiff {
		const prevMap = new Map(prev.nodes.map((n) => [n.id, n]));
		const nextMap = new Map(next.nodes.map((n) => [n.id, n]));

		const added: string[] = [];
		const removed: string[] = [];
		const changed: string[] = [];
		const unchanged: string[] = [];

		for (const [id, n] of nextMap) {
			const p = prevMap.get(id);
			if (!p) {
				added.push(id);
			} else if (p.hash !== n.hash || p.version !== n.version) {
				changed.push(id);
			} else {
				unchanged.push(id);
			}
		}
		for (const id of prevMap.keys()) {
			if (!nextMap.has(id)) {
				removed.push(id);
			}
		}

		const affected = new Set<string>([...added, ...changed, ...removed]);
		// Expand to dependents that list affected ids in dependencies
		for (const n of nextMap.values()) {
			if (n.dependencies.some((d) => affected.has(d))) {
				affected.add(n.id);
			}
			const parent = n.meta?.parent ? String(n.meta.parent) : undefined;
			if (parent && affected.has(n.id)) {
				affected.add(parent);
			}
		}

		return {
			added,
			removed,
			changed,
			unchanged,
			affectedSubtree: [...affected],
		};
	}
}
