import type { ArchEdge, ArchNode, ArchNodeKind, ArchRelKind } from './types.js';

/**
 * Replaceable graph backend. Default is in-process memory/JSON.
 * Neo4j is an optional adapter — never on the coding path.
 */
export interface GraphBackend {
  upsertNodes(nodes: ArchNode[]): void;
  upsertEdges(edges: ArchEdge[]): void;
  getNode(id: string): ArchNode | undefined;
  listNodes(kind?: ArchNodeKind): ArchNode[];
  listEdges(from?: string, kind?: ArchRelKind): ArchEdge[];
  neighbors(id: string, depth?: number, rels?: ArchRelKind[]): {
    nodes: ArchNode[];
    edges: ArchEdge[];
  };
  close(): void;
}
