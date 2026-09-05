export const GRAPH_NODE_KINDS = [
  'Project',
  'Repository',
  'Service',
  'Module',
  'Class',
  'Function',
  'Database',
  'API',
  'Technology',
  'Decision',
  'ADR',
  'Task',
  'Commit',
  'PR',
  'Incident',
] as const;
export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_REL_KINDS = [
  'DEPENDS_ON',
  'USES',
  'CALLS',
  'IMPLEMENTS',
  'AFFECTS',
  'DECIDED_BY',
  'SUPERSEDES',
  'REJECTS',
  'INTRODUCED_BY',
  'FIXED_BY',
  'TESTED_BY',
  'DEPLOYED_TO',
] as const;
export type GraphRelKind = (typeof GRAPH_REL_KINDS)[number];

export interface GraphEntity {
  id: string;
  kind: GraphNodeKind;
  label: string;
  project_id: string;
  meta?: Record<string, unknown>;
}

export interface GraphRel {
  from: string;
  to: string;
  kind: GraphRelKind;
}

export interface RelationshipStore {
  createEntity(entity: GraphEntity): Promise<void>;
  createRelationship(rel: GraphRel): Promise<void>;
  findRelated(id: string, kind?: GraphRelKind): Promise<GraphEntity[]>;
  traverse(id: string, depth?: number): Promise<{ nodes: GraphEntity[]; edges: GraphRel[] }>;
  close(): Promise<void> | void;
}

export class JsonRelationshipStore implements RelationshipStore {
  private readonly nodes = new Map<string, GraphEntity>();
  private readonly edges: GraphRel[] = [];

  async createEntity(entity: GraphEntity): Promise<void> {
    this.nodes.set(entity.id, entity);
  }

  async createRelationship(rel: GraphRel): Promise<void> {
    if (!this.edges.some((e) => e.from === rel.from && e.to === rel.to && e.kind === rel.kind)) {
      this.edges.push(rel);
    }
  }

  async findRelated(id: string, kind?: GraphRelKind): Promise<GraphEntity[]> {
    const out: GraphEntity[] = [];
    for (const e of this.edges) {
      if (kind && e.kind !== kind) {
        continue;
      }
      const other = e.from === id ? e.to : e.to === id ? e.from : undefined;
      if (other) {
        const n = this.nodes.get(other);
        if (n) {
          out.push(n);
        }
      }
    }
    return out;
  }

  async traverse(
    id: string,
    depth = 2,
  ): Promise<{ nodes: GraphEntity[]; edges: GraphRel[] }> {
    const seen = new Set<string>([id]);
    const nodes: GraphEntity[] = [];
    const edges: GraphRel[] = [];
    const start = this.nodes.get(id);
    if (start) {
      nodes.push(start);
    }
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of this.edges) {
          if (e.from !== cur && e.to !== cur) {
            continue;
          }
          edges.push(e);
          const other = e.from === cur ? e.to : e.from;
          if (!seen.has(other)) {
            seen.add(other);
            next.push(other);
            const n = this.nodes.get(other);
            if (n) {
              nodes.push(n);
            }
          }
        }
      }
      frontier = next;
    }
    return { nodes, edges };
  }

  close(): void {
    this.nodes.clear();
  }
}

export class Neo4jRelationshipStore implements RelationshipStore {
  private driver?: {
    session: () => {
      run: (cypher: string, params?: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }>;
      close: () => Promise<void>;
    };
    close: () => Promise<void>;
  };
  readonly configured: boolean;
  private readonly fallback = new JsonRelationshipStore();

  constructor(opts?: { uri?: string; user?: string; password?: string }) {
    this.configured = Boolean(opts?.uri);
    this.uri = opts?.uri;
    this.user = opts?.user ?? 'neo4j';
    this.password = opts?.password ?? '';
  }

  private readonly uri?: string;
  private readonly user: string;
  private readonly password: string;

  private async session() {
    if (!this.uri) {
      return undefined;
    }
    if (!this.driver) {
      try {
        const neo4j = (await import('neo4j-driver')) as {
          default?: {
            driver: (uri: string, auth: unknown) => NonNullable<Neo4jRelationshipStore['driver']>;
            auth: { basic: (u: string, p: string) => unknown };
          };
          driver?: (uri: string, auth: unknown) => NonNullable<Neo4jRelationshipStore['driver']>;
          auth?: { basic: (u: string, p: string) => unknown };
        };
        const lib = neo4j.default ?? neo4j;
        if (!lib.driver || !lib.auth) {
          return undefined;
        }
        this.driver = lib.driver(this.uri, lib.auth.basic(this.user, this.password));
      } catch {
        return undefined;
      }
    }
    return this.driver?.session();
  }

  async createEntity(entity: GraphEntity): Promise<void> {
    await this.fallback.createEntity(entity);
    const session = await this.session();
    if (!session) {
      return;
    }
    try {
      await session.run(
        `MERGE (n:${entity.kind} {id: $id}) SET n.label = $label, n.project_id = $project_id`,
        { id: entity.id, label: entity.label, project_id: entity.project_id },
      );
    } catch {
      /* fallback already wrote */
    } finally {
      await session.close();
    }
  }

  async createRelationship(rel: GraphRel): Promise<void> {
    await this.fallback.createRelationship(rel);
    const session = await this.session();
    if (!session) {
      return;
    }
    try {
      await session.run(
        `MATCH (a {id: $from}), (b {id: $to}) MERGE (a)-[r:${rel.kind}]->(b)`,
        { from: rel.from, to: rel.to },
      );
    } catch {
      /* ignore */
    } finally {
      await session.close();
    }
  }

  async findRelated(id: string, kind?: GraphRelKind): Promise<GraphEntity[]> {
    return this.fallback.findRelated(id, kind);
  }

  async traverse(id: string, depth = 2) {
    return this.fallback.traverse(id, depth);
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.fallback.close();
  }
}

export function openRelationshipStore(opts: {
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
}): RelationshipStore {
  if (opts.neo4jUri) {
    return new Neo4jRelationshipStore({
      uri: opts.neo4jUri,
      user: opts.neo4jUser,
      password: opts.neo4jPassword,
    });
  }
  return new JsonRelationshipStore();
}
