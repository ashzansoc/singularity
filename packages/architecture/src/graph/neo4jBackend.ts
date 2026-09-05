import type { GraphBackend } from './backend.js';
import type { ArchEdge, ArchNode, ArchNodeKind, ArchRelKind } from './types.js';
import { MemoryGraphBackend } from './memoryBackend.js';
import { JsonGraphBackend } from './jsonBackend.js';
import { join } from 'node:path';

type Neo4jSession = {
  run: (cypher: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

type Neo4jDriver = {
  session: () => Neo4jSession;
  close: () => Promise<void>;
};

/**
 * Optional Neo4j adapter. Writes are fire-and-forget onto the intelligence plane.
 * Without a live driver, JSON/memory fallback remains source of graph reads.
 */
export class Neo4jGraphBackend implements GraphBackend {
  private readonly fallback = new MemoryGraphBackend();
  readonly configured: boolean;
  private driver?: Neo4jDriver;
  private readonly uri?: string;
  private readonly user: string;
  private readonly password: string;
  private connecting?: Promise<void>;

  constructor(opts?: { uri?: string; user?: string; password?: string }) {
    this.uri = opts?.uri || process.env.NEO4J_URI;
    this.user = opts?.user || process.env.NEO4J_USER || 'neo4j';
    this.password = opts?.password || process.env.NEO4J_PASSWORD || '';
    this.configured = Boolean(this.uri);
    if (this.configured) {
      this.connecting = this.connect();
    }
  }

  private async connect(): Promise<void> {
    if (!this.uri) {
      return;
    }
    try {
      const neo4j = (await import('neo4j-driver')) as {
        default?: { driver: (uri: string, auth: unknown) => Neo4jDriver; auth: { basic: (u: string, p: string) => unknown } };
        driver?: (uri: string, auth: unknown) => Neo4jDriver;
        auth?: { basic: (u: string, p: string) => unknown };
      };
      const lib = neo4j.default ?? neo4j;
      if (!lib.driver || !lib.auth) {
        return;
      }
      this.driver = lib.driver(this.uri, lib.auth.basic(this.user, this.password));
    } catch {
      this.driver = undefined;
    }
  }

  upsertNodes(nodes: ArchNode[]): void {
    this.fallback.upsertNodes(nodes);
    void this.pushNodes(nodes);
  }

  upsertEdges(edges: ArchEdge[]): void {
    this.fallback.upsertEdges(edges);
    void this.pushEdges(edges);
  }

  getNode(id: string): ArchNode | undefined {
    return this.fallback.getNode(id);
  }

  listNodes(kind?: ArchNodeKind): ArchNode[] {
    return this.fallback.listNodes(kind);
  }

  listEdges(from?: string, kind?: ArchRelKind): ArchEdge[] {
    return this.fallback.listEdges(from, kind);
  }

  neighbors(id: string, depth?: number, rels?: ArchRelKind[]) {
    return this.fallback.neighbors(id, depth, rels);
  }

  close(): void {
    this.fallback.close();
    void this.driver?.close();
  }

  private async pushNodes(nodes: ArchNode[]): Promise<void> {
    await this.connecting;
    const session = this.driver?.session();
    if (!session) {
      return;
    }
    try {
      for (const n of nodes) {
        await session.run(
          `MERGE (x:${n.kind} {id: $id}) SET x.label = $label, x.project_id = $project_id`,
          { id: n.id, label: n.label, project_id: n.project_id },
        );
      }
    } catch {
      /* coding continues */
    } finally {
      await session.close();
    }
  }

  private async pushEdges(edges: ArchEdge[]): Promise<void> {
    await this.connecting;
    const session = this.driver?.session();
    if (!session) {
      return;
    }
    try {
      for (const e of edges) {
        await session.run(
          `MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[:${e.kind}]->(b)`,
          { from: e.from, to: e.to },
        );
      }
    } catch {
      /* ignore */
    } finally {
      await session.close();
    }
  }
}

export function openGraphBackend(opts: {
  workspaceRoot: string;
  preferNeo4j?: boolean;
  persist?: boolean;
}): GraphBackend {
  if (opts.preferNeo4j || process.env.NEO4J_URI) {
    return new Neo4jGraphBackend({ uri: process.env.NEO4J_URI });
  }
  if (opts.persist === false) {
    return new MemoryGraphBackend();
  }
  return new JsonGraphBackend(join(opts.workspaceRoot, '.singularity', 'architecture', 'graph.json'));
}
