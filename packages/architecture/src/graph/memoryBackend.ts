import type { GraphBackend } from './backend.js';
import { edgeId, type ArchEdge, type ArchNode, type ArchNodeKind, type ArchRelKind } from './types.js';

export class MemoryGraphBackend implements GraphBackend {
  private readonly nodes = new Map<string, ArchNode>();
  private readonly edges = new Map<string, ArchEdge>();

  upsertNodes(nodes: ArchNode[]): void {
    for (const n of nodes) {
      this.nodes.set(n.id, n);
    }
  }

  upsertEdges(edges: ArchEdge[]): void {
    for (const e of edges) {
      const id = e.id || edgeId(e.from, e.kind, e.to);
      this.edges.set(id, { ...e, id });
    }
  }

  getNode(id: string): ArchNode | undefined {
    return this.nodes.get(id);
  }

  listNodes(kind?: ArchNodeKind): ArchNode[] {
    const all = [...this.nodes.values()];
    return kind ? all.filter((n) => n.kind === kind) : all;
  }

  listEdges(from?: string, kind?: ArchRelKind): ArchEdge[] {
    let all = [...this.edges.values()];
    if (from) {
      all = all.filter((e) => e.from === from || e.to === from);
    }
    if (kind) {
      all = all.filter((e) => e.kind === kind);
    }
    return all;
  }

  neighbors(
    id: string,
    depth = 1,
    rels?: ArchRelKind[],
  ): { nodes: ArchNode[]; edges: ArchEdge[] } {
    const allowed = rels ? new Set(rels) : undefined;
    const seen = new Set<string>([id]);
    const edgeAcc: ArchEdge[] = [];
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of this.edges.values()) {
          if (allowed && !allowed.has(e.kind)) {
            continue;
          }
          let other: string | undefined;
          if (e.from === cur) {
            other = e.to;
          } else if (e.to === cur) {
            other = e.from;
          }
          if (!other) {
            continue;
          }
          edgeAcc.push(e);
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    const nodes = [...seen]
      .map((nid) => this.nodes.get(nid))
      .filter((n): n is ArchNode => Boolean(n));
    return { nodes, edges: edgeAcc };
  }

  close(): void {
    this.nodes.clear();
    this.edges.clear();
  }
}
