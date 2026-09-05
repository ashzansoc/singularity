import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryRecord, MemoryVersion } from '../domain/memory.js';
import { parseMemory } from '../domain/memory.js';
import type {
  DeadLetter,
  MemoryEmbeddingRow,
  MemoryListFilter,
  MemoryRepository,
} from './repository.js';

interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

async function loadPg(): Promise<
  | { Client: new (opts: { connectionString: string }) => PgClient & { connect(): Promise<void> } }
  | undefined
> {
  try {
    return (await import('pg')) as unknown as {
      Client: new (opts: { connectionString: string }) => PgClient & { connect(): Promise<void> };
    };
  } catch {
    return undefined;
  }
}

function migrationPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '../../migrations/001_init.sql');
}

function parseEntities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === 'string') {
    try {
      const p = JSON.parse(value);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function pgRowToMemory(row: Record<string, unknown>): MemoryRecord {
  return parseMemory({
    id: row.id,
    project_id: row.project_id,
    type: row.type,
    scope: row.scope,
    title: row.title,
    content: row.content,
    reason: row.reason ?? '',
    status: row.status,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    source_type: row.source_type,
    source_id: row.source_id,
    task_id: row.task_id ?? undefined,
    agent_id: row.agent_id ?? undefined,
    supersedes_id: row.supersedes_id ?? undefined,
    entities: parseEntities(row.entities),
    embedding_pending: Boolean(row.embedding_pending),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
    last_accessed_at: row.last_accessed_at
      ? new Date(String(row.last_accessed_at)).toISOString()
      : undefined,
  });
}

function parseVector(text: string): number[] {
  const inner = text.replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) {
    return [];
  }
  return inner.split(',').map((p) => Number(p.trim()));
}

export class PostgresMemoryRepository implements MemoryRepository {
  private constructor(private readonly client: PgClient) {}

  static async connect(connectionString: string): Promise<PostgresMemoryRepository> {
    const pg = await loadPg();
    if (!pg) {
      throw new Error('pg driver not installed');
    }
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const sql = readFileSync(migrationPath(), 'utf8');
      await client.query(sql);
    } catch {
      /* partial apply is ok */
    }
    return new PostgresMemoryRepository(client);
  }

  async upsertProject(id: string, name: string, repository_url?: string): Promise<void> {
    await this.client.query(
      `INSERT INTO projects(id,name,repository_url)
       VALUES($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, repository_url=EXCLUDED.repository_url, updated_at=NOW()`,
      [id, name, repository_url ?? null],
    );
  }

  async insert(memory: MemoryRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memories(
         id,project_id,type,scope,title,content,reason,status,importance,confidence,
         source_type,source_id,task_id,agent_id,supersedes_id,entities,embedding_pending,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, content=EXCLUDED.content, reason=EXCLUDED.reason, status=EXCLUDED.status,
         importance=EXCLUDED.importance, confidence=EXCLUDED.confidence, supersedes_id=EXCLUDED.supersedes_id,
         entities=EXCLUDED.entities, embedding_pending=EXCLUDED.embedding_pending, updated_at=EXCLUDED.updated_at`,
      [
        memory.id,
        memory.project_id,
        memory.type,
        memory.scope,
        memory.title,
        memory.content,
        memory.reason,
        memory.status,
        memory.importance,
        memory.confidence,
        memory.source_type,
        memory.source_id,
        memory.task_id ?? null,
        memory.agent_id ?? null,
        memory.supersedes_id ?? null,
        JSON.stringify(memory.entities),
        memory.embedding_pending,
        memory.created_at,
        memory.updated_at,
      ],
    );
  }

  async get(projectId: string, id: string): Promise<MemoryRecord | undefined> {
    const res = await this.client.query('SELECT * FROM memories WHERE id=$1 AND project_id=$2', [
      id,
      projectId,
    ]);
    const row = res.rows[0];
    return row ? pgRowToMemory(row) : undefined;
  }

  async patch(projectId: string, memory: MemoryRecord): Promise<void> {
    if (memory.project_id !== projectId) {
      return;
    }
    await this.insert(memory);
  }

  async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
    const clauses = ['project_id=$1'];
    const params: unknown[] = [filter.project_id];
    if (filter.status) {
      params.push(filter.status);
      clauses.push(`status=$${params.length}`);
    }
    if (filter.type) {
      params.push(filter.type);
      clauses.push(`type=$${params.length}`);
    }
    let sql = `SELECT * FROM memories WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`;
    if (filter.limit) {
      params.push(filter.limit);
      sql += ` LIMIT $${params.length}`;
    }
    const res = await this.client.query(sql, params);
    return res.rows.map(pgRowToMemory);
  }

  async searchKeyword(projectId: string, query: string, limit = 20): Promise<MemoryRecord[]> {
    const res = await this.client.query(
      `SELECT * FROM memories WHERE project_id=$1 AND (
         title ILIKE $2 OR content ILIKE $2 OR reason ILIKE $2
       ) LIMIT $3`,
      [projectId, `%${query}%`, limit],
    );
    return res.rows.map(pgRowToMemory);
  }

  async insertVersion(version: MemoryVersion): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_versions(id,memory_id,content,reason,status,source_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        version.id,
        version.memory_id,
        version.content,
        version.reason,
        version.status,
        version.source_id ?? null,
        version.created_at,
      ],
    );
  }

  async listVersions(memoryId: string): Promise<MemoryVersion[]> {
    const res = await this.client.query(
      'SELECT * FROM memory_versions WHERE memory_id=$1 ORDER BY created_at',
      [memoryId],
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      memory_id: String(r.memory_id),
      content: String(r.content),
      reason: String(r.reason ?? ''),
      status: r.status as MemoryVersion['status'],
      source_id: r.source_id ? String(r.source_id) : undefined,
      created_at: new Date(String(r.created_at)).toISOString(),
    }));
  }

  async upsertEmbedding(row: MemoryEmbeddingRow): Promise<void> {
    const literal = `[${row.embedding.join(',')}]`;
    await this.client.query(
      `INSERT INTO memory_embeddings(id,memory_id,embedding,model,dimensions)
       VALUES($1,$2,$3::vector,$4,$5)
       ON CONFLICT (memory_id) DO UPDATE SET embedding=EXCLUDED.embedding, model=EXCLUDED.model`,
      [row.memory_id, row.memory_id, literal, row.model, row.dimensions],
    );
    await this.client.query('UPDATE memories SET embedding_pending=false WHERE id=$1', [
      row.memory_id,
    ]);
  }

  async listEmbeddings(projectId: string): Promise<MemoryEmbeddingRow[]> {
    const res = await this.client.query(
      `SELECT e.memory_id, e.embedding::text AS embedding, e.model, e.dimensions
       FROM memory_embeddings e
       JOIN memories m ON m.id = e.memory_id
       WHERE m.project_id=$1`,
      [projectId],
    );
    return res.rows.map((r) => ({
      memory_id: String(r.memory_id),
      embedding: parseVector(String(r.embedding)),
      model: String(r.model),
      dimensions: Number(r.dimensions),
    }));
  }

  async markEventProcessed(eventId: string, projectId: string): Promise<boolean> {
    const existing = await this.client.query(
      'SELECT event_id FROM processed_events WHERE event_id=$1',
      [eventId],
    );
    if (existing.rows[0]) {
      return false;
    }
    await this.client.query(
      'INSERT INTO processed_events(event_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [eventId, projectId],
    );
    return true;
  }

  async wasEventProcessed(eventId: string): Promise<boolean> {
    const res = await this.client.query('SELECT event_id FROM processed_events WHERE event_id=$1', [
      eventId,
    ]);
    return Boolean(res.rows[0]);
  }

  async insertDeadLetter(letter: DeadLetter): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_dead_letters(id,kind,payload,error,created_at) VALUES($1,$2,$3::jsonb,$4,$5)`,
      [letter.id, letter.kind, JSON.stringify(letter.payload), letter.error, letter.created_at],
    );
  }

  async listPendingEmbeddings(projectId: string, limit = 32): Promise<MemoryRecord[]> {
    const res = await this.client.query(
      'SELECT * FROM memories WHERE project_id=$1 AND embedding_pending=true LIMIT $2',
      [projectId, limit],
    );
    return res.rows.map(pgRowToMemory);
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

export async function openPostgresMemoryRepository(
  url: string,
): Promise<PostgresMemoryRepository> {
  return PostgresMemoryRepository.connect(url);
}
