import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from '@singularity/prompt';
import { tokenize } from './hash.js';
import type {
  FileIndexMeta,
  GraphStore,
  StageName,
  StageProgress,
  Subgraph,
  SymbolHit,
} from './types.js';

function lexicalScore(query: string, text: string): number {
  const q = new Set(tokenize(query));
  if (!q.size) {
    return 0;
  }
  const toks = tokenize(text);
  let hit = 0;
  for (const t of toks) {
    if (q.has(t)) {
      hit++;
    }
  }
  const exact = text.toLowerCase().includes(query.toLowerCase()) ? 0.4 : 0;
  return hit / q.size + exact;
}

export class MemoryGraphStore implements GraphStore {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly out = new Map<string, Set<string>>();
  private readonly inn = new Map<string, Set<string>>();
  private readonly files = new Map<string, FileIndexMeta>();
  private readonly stages = new Map<StageName, StageProgress>();
  private readonly meta = new Map<string, string>();
  private readonly staleIds = new Set<string>();

  upsertNodes(nodes: GraphNode[]): void {
    for (const n of nodes) {
      this.nodes.set(n.id, n);
    }
  }

  upsertEdges(edges: GraphEdge[]): void {
    for (const e of edges) {
      this.edges.set(e.id, e);
      if (!this.out.has(e.from)) {
        this.out.set(e.from, new Set());
      }
      if (!this.inn.has(e.to)) {
        this.inn.set(e.to, new Set());
      }
      this.out.get(e.from)!.add(e.id);
      this.inn.get(e.to)!.add(e.id);
    }
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.removeEdges(id);
    this.staleIds.delete(id);
  }

  removeEdges(nodeId: string): void {
    const ids = [...(this.out.get(nodeId) ?? []), ...(this.inn.get(nodeId) ?? [])];
    for (const eid of ids) {
      const e = this.edges.get(eid);
      if (!e) {
        continue;
      }
      this.edges.delete(eid);
      this.out.get(e.from)?.delete(eid);
      this.inn.get(e.to)?.delete(eid);
    }
  }

  removeFileNeighborhood(fileId: string): void {
    const children = this.neighbors(fileId);
    for (const c of children) {
      this.removeNode(c.id);
    }
    this.removeNode(fileId);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  listNodes(kind?: NodeKind): GraphNode[] {
    const all = [...this.nodes.values()];
    return kind ? all.filter((n) => n.kind === kind) : all;
  }

  neighbors(id: string, kind?: EdgeKind): GraphNode[] {
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

  neighborhood(id: string, depth: number, rels?: EdgeKind[]): Subgraph {
    const relSet = rels ? new Set(rels) : undefined;
    const seen = new Set<string>();
    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    const queue: Array<{ id: string; d: number }> = [{ id, d: 0 }];
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur.id) || cur.d > depth) {
        continue;
      }
      seen.add(cur.id);
      const node = this.nodes.get(cur.id);
      if (node) {
        nodeMap.set(node.id, node);
      }
      const edgeIds = [...(this.out.get(cur.id) ?? []), ...(this.inn.get(cur.id) ?? [])];
      for (const eid of edgeIds) {
        const e = this.edges.get(eid);
        if (!e) {
          continue;
        }
        if (relSet && !relSet.has(e.kind)) {
          continue;
        }
        edgeMap.set(e.id, e);
        const next = e.from === cur.id ? e.to : e.from;
        if (!seen.has(next) && cur.d < depth) {
          queue.push({ id: next, d: cur.d + 1 });
        }
      }
    }
    return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
  }

  findSymbols(query: string, opts?: { limit?: number }): SymbolHit[] {
    const limit = opts?.limit ?? 24;
    const kinds = new Set<NodeKind>([
      'function',
      'class',
      'method',
      'interface',
      'symbol',
      'export',
    ]);
    const hits: SymbolHit[] = [];
    for (const n of this.nodes.values()) {
      if (!kinds.has(n.kind) && n.kind !== 'file') {
        continue;
      }
      const blob = `${n.label} ${n.content ?? ''} ${n.kind}`;
      const score = lexicalScore(query, blob);
      if (score <= 0) {
        continue;
      }
      hits.push({
        id: n.id,
        name: n.label,
        kind: n.kind,
        uri: n.meta?.uri ? String(n.meta.uri) : undefined,
        startLine: typeof n.meta?.startLine === 'number' ? n.meta.startLine : undefined,
        score,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  markStale(fileId: string, stale = true): void {
    if (stale) {
      this.staleIds.add(fileId);
    } else {
      this.staleIds.delete(fileId);
    }
    const node = this.nodes.get(fileId);
    if (node) {
      node.meta = { ...node.meta, stale };
    }
  }

  isStale(id: string): boolean {
    return this.staleIds.has(id);
  }

  getFileMeta(uri: string): FileIndexMeta | undefined {
    return this.files.get(uri);
  }

  setFileMeta(meta: FileIndexMeta): void {
    this.files.set(meta.uri, meta);
  }

  listFileMeta(): FileIndexMeta[] {
    return [...this.files.values()];
  }

  getStage(name: StageName): StageProgress | undefined {
    return this.stages.get(name);
  }

  setStage(progress: StageProgress): void {
    this.stages.set(progress.name, progress);
  }

  listStages(): StageProgress[] {
    return [...this.stages.values()];
  }

  setMeta(key: string, value: string): void {
    this.meta.set(key, value);
  }

  getMeta(key: string): string | undefined {
    return this.meta.get(key);
  }

  snapshot(): Subgraph {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  close(): void {
    /* in-memory */
  }
}
