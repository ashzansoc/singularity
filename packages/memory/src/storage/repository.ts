import type { MemoryRecord, MemoryVersion } from '../domain/memory.js';

export interface MemoryListFilter {
  project_id: string;
  status?: MemoryRecord['status'];
  type?: MemoryRecord['type'];
  scope?: string;
  limit?: number;
}

export interface MemoryEmbeddingRow {
  memory_id: string;
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface DeadLetter {
  id: string;
  kind: string;
  payload: unknown;
  error: string;
  created_at: string;
}

export interface MemoryRepository {
  upsertProject(id: string, name: string, repository_url?: string): Promise<void>;
  insert(memory: MemoryRecord): Promise<void>;
  get(projectId: string, id: string): Promise<MemoryRecord | undefined>;
  patch(projectId: string, memory: MemoryRecord): Promise<void>;
  list(filter: MemoryListFilter): Promise<MemoryRecord[]>;
  searchKeyword(projectId: string, query: string, limit?: number): Promise<MemoryRecord[]>;
  insertVersion(version: MemoryVersion): Promise<void>;
  listVersions(memoryId: string): Promise<MemoryVersion[]>;
  upsertEmbedding(row: MemoryEmbeddingRow): Promise<void>;
  listEmbeddings(projectId: string): Promise<MemoryEmbeddingRow[]>;
  markEventProcessed(eventId: string, projectId: string): Promise<boolean>;
  wasEventProcessed(eventId: string): Promise<boolean>;
  insertDeadLetter(letter: DeadLetter): Promise<void>;
  listPendingEmbeddings(projectId: string, limit?: number): Promise<MemoryRecord[]>;
  close(): Promise<void> | void;
}
