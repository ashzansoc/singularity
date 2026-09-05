/**
 * SQLite-backed GraphStore (WAL when node:sqlite is available).
 * Falls back to JSON persistence of MemoryGraphStore when node:sqlite is missing.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from '@singularity/prompt';
import { MemoryGraphStore } from './memoryGraphStore.js';
import type {
  FileIndexMeta,
  GraphStore,
  StageName,
  StageProgress,
  Subgraph,
  SymbolHit,
} from './types.js';

interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  close(): void;
}

function tryOpenSqlite(dbPath: string): SqlDb | undefined {
  try {
    const req = createRequire(import.meta.url);
    const sqlite = req('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...params: unknown[]): unknown;
          get(...params: unknown[]): Record<string, unknown> | undefined;
          all(...params: unknown[]): Record<string, unknown>[];
        };
        close(): void;
      };
    };
    const raw = new sqlite.DatabaseSync(dbPath);
    return {
      exec: (sql) => raw.exec(sql),
      prepare: (sql) => {
        const stmt = raw.prepare(sql);
        return {
          run: (...params) => {
            stmt.run(...params);
          },
          get: (...params) => stmt.get(...params),
          all: (...params) => stmt.all(...params),
        };
      },
      close: () => raw.close(),
    };
  } catch {
    return undefined;
  }
}

const SCHEMA = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  content TEXT,
  hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  embedding TEXT,
  dependencies TEXT NOT NULL,
  last_modified INTEGER NOT NULL,
  meta TEXT
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  kind TEXT NOT NULL,
  weight REAL
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE TABLE IF NOT EXISTS files (
  uri TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_indexed_at INTEGER NOT NULL,
  git_commit TEXT,
  branch TEXT,
  language_id TEXT,
  stale INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stages (
  name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  progress REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function nodeFromRow(row: Record<string, unknown>): GraphNode {
  return {
    id: String(row.id),
    kind: String(row.kind) as NodeKind,
    label: String(row.label),
    content: row.content != null ? String(row.content) : undefined,
    hash: String(row.hash),
    version: Number(row.version),
    tokenCount: Number(row.token_count),
    embedding: row.embedding ? (JSON.parse(String(row.embedding)) as number[]) : undefined,
    dependencies: JSON.parse(String(row.dependencies ?? '[]')) as string[],
    lastModified: Number(row.last_modified),
    meta: row.meta ? (JSON.parse(String(row.meta)) as Record<string, unknown>) : undefined,
  };
}

export class SqliteGraphStore implements GraphStore {
  private readonly inner = new MemoryGraphStore();
  private readonly db?: SqlDb;
  private readonly jsonPath?: string;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = tryOpenSqlite(dbPath);
    if (this.db) {
      this.db.exec(SCHEMA);
      this.hydrateFromSql();
    } else {
      this.jsonPath = dbPath.replace(/\.sqlite$/, '') + '.json';
      this.hydrateFromJson();
    }
  }

  private hydrateFromSql(): void {
    if (!this.db) {
      return;
    }
    const nodes = this.db.prepare('SELECT * FROM nodes').all();
    this.inner.upsertNodes(nodes.map(nodeFromRow));
    const edges = this.db.prepare('SELECT * FROM edges').all();
    this.inner.upsertEdges(
      edges.map((row) => ({
        id: String(row.id),
        from: String(row.src),
        to: String(row.dst),
        kind: String(row.kind) as EdgeKind,
        weight: row.weight != null ? Number(row.weight) : undefined,
      })),
    );
    for (const row of this.db.prepare('SELECT * FROM files').all()) {
      this.inner.setFileMeta({
        uri: String(row.uri),
        fileId: String(row.file_id),
        contentHash: String(row.content_hash),
        lastIndexedAt: Number(row.last_indexed_at),
        gitCommit: row.git_commit != null ? String(row.git_commit) : undefined,
        branch: row.branch != null ? String(row.branch) : undefined,
        languageId: row.language_id != null ? String(row.language_id) : undefined,
        stale: Number(row.stale) === 1,
      });
      if (Number(row.stale) === 1) {
        this.inner.markStale(String(row.file_id), true);
      }
    }
    for (const row of this.db.prepare('SELECT * FROM stages').all()) {
      this.inner.setStage({
        name: String(row.name) as StageName,
        status: String(row.status) as StageProgress['status'],
        progress: Number(row.progress),
        updatedAt: Number(row.updated_at),
        detail: row.detail != null ? String(row.detail) : undefined,
      });
    }
    for (const row of this.db.prepare('SELECT * FROM kv').all()) {
      this.inner.setMeta(String(row.key), String(row.value));
    }
  }

  private hydrateFromJson(): void {
    if (!this.jsonPath || !existsSync(this.jsonPath)) {
      return;
    }
    try {
      const data = JSON.parse(readFileSync(this.jsonPath, 'utf8')) as {
        nodes?: GraphNode[];
        edges?: GraphEdge[];
        files?: FileIndexMeta[];
        stages?: StageProgress[];
        kv?: Record<string, string>;
      };
      if (data.nodes) {
        this.inner.upsertNodes(data.nodes);
      }
      if (data.edges) {
        this.inner.upsertEdges(data.edges);
      }
      for (const f of data.files ?? []) {
        this.inner.setFileMeta(f);
        if (f.stale) {
          this.inner.markStale(f.fileId, true);
        }
      }
      for (const s of data.stages ?? []) {
        this.inner.setStage(s);
      }
      for (const [k, v] of Object.entries(data.kv ?? {})) {
        this.inner.setMeta(k, v);
      }
    } catch {
      /* corrupt snapshot */
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.flush();
    }, 250);
    this.persistTimer.unref();
  }

  flush(): void {
    if (this.db) {
      this.flushSql();
      return;
    }
    if (!this.jsonPath) {
      return;
    }
    const snap = this.inner.snapshot();
    const kv: Record<string, string> = {};
    for (const key of ['git_commit', 'branch', 'workspace']) {
      const v = this.inner.getMeta(key);
      if (v) {
        kv[key] = v;
      }
    }
    writeFileSync(
      this.jsonPath,
      JSON.stringify({
        nodes: snap.nodes,
        edges: snap.edges,
        files: this.inner.listFileMeta(),
        stages: this.inner.listStages(),
        kv,
      }),
    );
  }

  private flushSql(): void {
    if (!this.db) {
      return;
    }
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM nodes');
      this.db.exec('DELETE FROM edges');
      this.db.exec('DELETE FROM files');
      this.db.exec('DELETE FROM stages');
      this.db.exec('DELETE FROM kv');
      const nStmt = this.db.prepare(
        `INSERT INTO nodes (id,kind,label,content,hash,version,token_count,embedding,dependencies,last_modified,meta)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      const eStmt = this.db.prepare(
        `INSERT INTO edges (id,src,dst,kind,weight) VALUES (?,?,?,?,?)`,
      );
      const snap = this.inner.snapshot();
      for (const n of snap.nodes) {
        nStmt.run(
          n.id,
          n.kind,
          n.label,
          n.content ?? null,
          n.hash,
          n.version,
          n.tokenCount,
          n.embedding ? JSON.stringify(n.embedding) : null,
          JSON.stringify(n.dependencies),
          n.lastModified,
          n.meta ? JSON.stringify(n.meta) : null,
        );
      }
      for (const e of snap.edges) {
        eStmt.run(e.id, e.from, e.to, e.kind, e.weight ?? null);
      }
      const fStmt = this.db.prepare(
        `INSERT INTO files (uri,file_id,content_hash,last_indexed_at,git_commit,branch,language_id,stale)
         VALUES (?,?,?,?,?,?,?,?)`,
      );
      for (const f of this.inner.listFileMeta()) {
        fStmt.run(
          f.uri,
          f.fileId,
          f.contentHash,
          f.lastIndexedAt,
          f.gitCommit ?? null,
          f.branch ?? null,
          f.languageId ?? null,
          f.stale ? 1 : 0,
        );
      }
      const sStmt = this.db.prepare(
        `INSERT INTO stages (name,status,progress,updated_at,detail) VALUES (?,?,?,?,?)`,
      );
      for (const s of this.inner.listStages()) {
        sStmt.run(s.name, s.status, s.progress, s.updatedAt, s.detail ?? null);
      }
      const kStmt = this.db.prepare(`INSERT INTO kv (key,value) VALUES (?,?)`);
      for (const key of ['git_commit', 'branch', 'workspace']) {
        const v = this.inner.getMeta(key);
        if (v) {
          kStmt.run(key, v);
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  upsertNodes(nodes: GraphNode[]): void {
    this.inner.upsertNodes(nodes);
    this.schedulePersist();
  }

  upsertEdges(edges: GraphEdge[]): void {
    this.inner.upsertEdges(edges);
    this.schedulePersist();
  }

  removeNode(id: string): void {
    this.inner.removeNode(id);
    this.schedulePersist();
  }

  removeFileNeighborhood(fileId: string): void {
    this.inner.removeFileNeighborhood(fileId);
    this.schedulePersist();
  }

  getNode(id: string): GraphNode | undefined {
    return this.inner.getNode(id);
  }

  listNodes(kind?: NodeKind): GraphNode[] {
    return this.inner.listNodes(kind);
  }

  neighborhood(id: string, depth: number, rels?: EdgeKind[]): Subgraph {
    return this.inner.neighborhood(id, depth, rels);
  }

  findSymbols(query: string, opts?: { limit?: number }): SymbolHit[] {
    return this.inner.findSymbols(query, opts);
  }

  markStale(fileId: string, stale = true): void {
    this.inner.markStale(fileId, stale);
    const meta = this.inner.listFileMeta().find((f) => f.fileId === fileId);
    if (meta) {
      this.inner.setFileMeta({ ...meta, stale });
    }
    this.schedulePersist();
  }

  getFileMeta(uri: string): FileIndexMeta | undefined {
    return this.inner.getFileMeta(uri);
  }

  setFileMeta(meta: FileIndexMeta): void {
    this.inner.setFileMeta(meta);
    this.schedulePersist();
  }

  listFileMeta(): FileIndexMeta[] {
    return this.inner.listFileMeta();
  }

  getStage(name: StageName): StageProgress | undefined {
    return this.inner.getStage(name);
  }

  setStage(progress: StageProgress): void {
    this.inner.setStage(progress);
    this.schedulePersist();
  }

  listStages(): StageProgress[] {
    return this.inner.listStages();
  }

  setMeta(key: string, value: string): void {
    this.inner.setMeta(key, value);
    this.schedulePersist();
  }

  getMeta(key: string): string | undefined {
    return this.inner.getMeta(key);
  }

  snapshot(): Subgraph {
    return this.inner.snapshot();
  }

  hot(): MemoryGraphStore {
    return this.inner;
  }

  close(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    try {
      this.flush();
    } catch {
      /* best-effort */
    }
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
  }
}

export function openGraphStore(dbPath: string): SqliteGraphStore {
  return new SqliteGraphStore(dbPath);
}
