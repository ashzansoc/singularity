import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { MemoryRecord, MemoryVersion } from '../domain/memory.js';
import { parseMemory } from '../domain/memory.js';
import type {
  DeadLetter,
  MemoryEmbeddingRow,
  MemoryListFilter,
  MemoryRepository,
} from './repository.js';

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
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repository_url TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  json TEXT NOT NULL,
  type TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  embedding_pending INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_project_idx ON memories(project_id);
CREATE TABLE IF NOT EXISTS memory_versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_dead_letters (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

function rowToMemory(row: Record<string, unknown>): MemoryRecord {
  return parseMemory(JSON.parse(String(row.json)));
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly db: SqlDb) {
    db.exec(SCHEMA);
  }

  async upsertProject(id: string, name: string, repository_url?: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO projects(id,name,repository_url,metadata,created_at,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, repository_url=excluded.repository_url, updated_at=excluded.updated_at`,
      )
      .run(id, name, repository_url ?? null, '{}', now, now);
  }

  async insert(memory: MemoryRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memories(id,project_id,json,type,scope,status,title,embedding_pending,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        memory.id,
        memory.project_id,
        JSON.stringify(memory),
        memory.type,
        memory.scope,
        memory.status,
        memory.title,
        memory.embedding_pending ? 1 : 0,
        memory.updated_at,
      );
  }

  async get(projectId: string, id: string): Promise<MemoryRecord | undefined> {
    const row = this.db
      .prepare('SELECT json FROM memories WHERE id=? AND project_id=?')
      .get(id, projectId);
    return row ? rowToMemory(row) : undefined;
  }

  async patch(projectId: string, memory: MemoryRecord): Promise<void> {
    if (memory.project_id !== projectId) {
      return;
    }
    await this.insert(memory);
  }

  async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
    let sql = 'SELECT json FROM memories WHERE project_id=?';
    const params: unknown[] = [filter.project_id];
    if (filter.status) {
      sql += ' AND status=?';
      params.push(filter.status);
    }
    if (filter.type) {
      sql += ' AND type=?';
      params.push(filter.type);
    }
    if (filter.scope) {
      sql += ' AND scope=?';
      params.push(filter.scope);
    }
    sql += ' ORDER BY updated_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    return this.db.prepare(sql).all(...params).map(rowToMemory);
  }

  async searchKeyword(projectId: string, query: string, limit = 20): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    const all = await this.list({ project_id: projectId });
    return all
      .filter((m) =>
        `${m.title} ${m.content} ${m.reason} ${m.entities.join(' ')}`.toLowerCase().includes(q),
      )
      .slice(0, limit);
  }

  async insertVersion(version: MemoryVersion): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO memory_versions(id,memory_id,json,created_at) VALUES(?,?,?,?)')
      .run(version.id, version.memory_id, JSON.stringify(version), version.created_at);
  }

  async listVersions(memoryId: string): Promise<MemoryVersion[]> {
    return this.db
      .prepare('SELECT json FROM memory_versions WHERE memory_id=? ORDER BY created_at')
      .all(memoryId)
      .map((r) => JSON.parse(String(r.json)) as MemoryVersion);
  }

  async upsertEmbedding(row: MemoryEmbeddingRow): Promise<void> {
    const mem = this.db.prepare('SELECT project_id FROM memories WHERE id=?').get(row.memory_id);
    const projectId = mem ? String(mem.project_id) : '';
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory_embeddings(memory_id,project_id,embedding,model,dimensions)
         VALUES(?,?,?,?,?)`,
      )
      .run(row.memory_id, projectId, JSON.stringify(row.embedding), row.model, row.dimensions);
    const cur = this.db.prepare('SELECT json FROM memories WHERE id=?').get(row.memory_id);
    if (cur) {
      const m = rowToMemory(cur);
      m.embedding_pending = false;
      await this.insert(m);
    }
  }

  async listEmbeddings(projectId: string): Promise<MemoryEmbeddingRow[]> {
    return this.db
      .prepare('SELECT memory_id, embedding, model, dimensions FROM memory_embeddings WHERE project_id=?')
      .all(projectId)
      .map((r) => ({
        memory_id: String(r.memory_id),
        embedding: JSON.parse(String(r.embedding)) as number[],
        model: String(r.model),
        dimensions: Number(r.dimensions),
      }));
  }

  async markEventProcessed(eventId: string, projectId: string): Promise<boolean> {
    const existing = this.db
      .prepare('SELECT event_id FROM processed_events WHERE event_id=?')
      .get(eventId);
    if (existing) {
      return false;
    }
    this.db
      .prepare('INSERT INTO processed_events(event_id,project_id,processed_at) VALUES(?,?,?)')
      .run(eventId, projectId, new Date().toISOString());
    return true;
  }

  async wasEventProcessed(eventId: string): Promise<boolean> {
    return Boolean(
      this.db.prepare('SELECT event_id FROM processed_events WHERE event_id=?').get(eventId),
    );
  }

  async insertDeadLetter(letter: DeadLetter): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO memory_dead_letters(id,kind,payload,error,created_at) VALUES(?,?,?,?,?)',
      )
      .run(letter.id, letter.kind, JSON.stringify(letter.payload), letter.error, letter.created_at);
  }

  async listPendingEmbeddings(projectId: string, limit = 32): Promise<MemoryRecord[]> {
    return this.db
      .prepare('SELECT json FROM memories WHERE project_id=? AND embedding_pending=1 LIMIT ?')
      .all(projectId, limit)
      .map(rowToMemory);
  }

  close(): void {
    this.db.close();
  }
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly memories = new Map<string, MemoryRecord>();
  private readonly versions: MemoryVersion[] = [];
  private readonly embeddings = new Map<string, MemoryEmbeddingRow & { project_id: string }>();
  private readonly processed = new Set<string>();
  readonly deadLetters: DeadLetter[] = [];
  unavailable = false;

  async upsertProject(): Promise<void> {
    this.guard();
  }

  async insert(memory: MemoryRecord): Promise<void> {
    this.guard();
    this.memories.set(memory.id, { ...memory, entities: [...memory.entities] });
  }

  async get(projectId: string, id: string): Promise<MemoryRecord | undefined> {
    this.guard();
    const m = this.memories.get(id);
    return m && m.project_id === projectId ? m : undefined;
  }

  async patch(projectId: string, memory: MemoryRecord): Promise<void> {
    this.guard();
    if (memory.project_id !== projectId) {
      return;
    }
    await this.insert(memory);
  }

  async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
    this.guard();
    let rows = [...this.memories.values()].filter((m) => m.project_id === filter.project_id);
    if (filter.status) {
      rows = rows.filter((m) => m.status === filter.status);
    }
    if (filter.type) {
      rows = rows.filter((m) => m.type === filter.type);
    }
    if (filter.scope) {
      rows = rows.filter((m) => m.scope === filter.scope);
    }
    rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }

  async searchKeyword(projectId: string, query: string, limit = 20): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    const all = await this.list({ project_id: projectId });
    return all
      .filter((m) => `${m.title} ${m.content} ${m.reason}`.toLowerCase().includes(q))
      .slice(0, limit);
  }

  async insertVersion(version: MemoryVersion): Promise<void> {
    this.guard();
    this.versions.push(version);
  }

  async listVersions(memoryId: string): Promise<MemoryVersion[]> {
    return this.versions.filter((v) => v.memory_id === memoryId);
  }

  async upsertEmbedding(row: MemoryEmbeddingRow): Promise<void> {
    this.guard();
    const mem = this.memories.get(row.memory_id);
    this.embeddings.set(row.memory_id, { ...row, project_id: mem?.project_id ?? '' });
    if (mem) {
      mem.embedding_pending = false;
    }
  }

  async listEmbeddings(projectId: string): Promise<MemoryEmbeddingRow[]> {
    this.guard();
    return [...this.embeddings.values()].filter((e) => e.project_id === projectId);
  }

  async markEventProcessed(eventId: string, _projectId: string): Promise<boolean> {
    this.guard();
    if (this.processed.has(eventId)) {
      return false;
    }
    this.processed.add(eventId);
    return true;
  }

  async wasEventProcessed(eventId: string): Promise<boolean> {
    return this.processed.has(eventId);
  }

  async insertDeadLetter(letter: DeadLetter): Promise<void> {
    this.deadLetters.push(letter);
  }

  async listPendingEmbeddings(projectId: string, limit = 32): Promise<MemoryRecord[]> {
    const all = await this.list({ project_id: projectId });
    return all.filter((m) => m.embedding_pending).slice(0, limit);
  }

  close(): void {
    this.memories.clear();
  }

  private guard(): void {
    if (this.unavailable) {
      throw new Error('memory store unavailable');
    }
  }
}

export function openSqliteMemoryRepository(dbPath: string): MemoryRepository {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    /* ignore */
  }
  const db = tryOpenSqlite(dbPath);
  if (!db) {
    return new InMemoryMemoryRepository();
  }
  return new SqliteMemoryRepository(db);
}
