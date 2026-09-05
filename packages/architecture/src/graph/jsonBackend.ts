import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemoryGraphBackend } from './memoryBackend.js';
import type { ArchEdge, ArchNode, ArchNodeKind, ArchRelKind } from './types.js';
import type { GraphBackend } from './backend.js';

/**
 * JSON-persisted graph (rebuildable from ADRs). Default local backend.
 */
export class JsonGraphBackend implements GraphBackend {
  private readonly inner = new MemoryGraphBackend();
  private readonly path?: string;

  constructor(persistPath?: string) {
    this.path = persistPath;
    if (persistPath && existsSync(persistPath)) {
      try {
        const data = JSON.parse(readFileSync(persistPath, 'utf8')) as {
          nodes?: ArchNode[];
          edges?: ArchEdge[];
        };
        this.inner.upsertNodes(data.nodes ?? []);
        this.inner.upsertEdges(data.edges ?? []);
      } catch {
        /* empty */
      }
    }
  }

  private persist(): void {
    if (!this.path) {
      return;
    }
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(
        this.path,
        JSON.stringify(
          { nodes: this.inner.listNodes(), edges: this.inner.listEdges() },
          null,
          0,
        ),
      );
    } catch {
      /* ignore */
    }
  }

  upsertNodes(nodes: ArchNode[]): void {
    this.inner.upsertNodes(nodes);
    this.persist();
  }

  upsertEdges(edges: ArchEdge[]): void {
    this.inner.upsertEdges(edges);
    this.persist();
  }

  getNode(id: string): ArchNode | undefined {
    return this.inner.getNode(id);
  }

  listNodes(kind?: ArchNodeKind): ArchNode[] {
    return this.inner.listNodes(kind);
  }

  listEdges(from?: string, kind?: ArchRelKind): ArchEdge[] {
    return this.inner.listEdges(from, kind);
  }

  neighbors(id: string, depth?: number, rels?: ArchRelKind[]) {
    return this.inner.neighbors(id, depth, rels);
  }

  close(): void {
    this.persist();
    this.inner.close();
  }
}
