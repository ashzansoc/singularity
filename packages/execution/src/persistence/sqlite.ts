import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ExecutionPlan, TaskNode } from '@singularity/runtime';
import type { ExecutionEvent } from '../events/types.js';
import type {
  ExecutionRecord,
  IntegrationRecord,
  TaskArtifact,
  TaskAttempt,
  TaskDependency,
  VerificationRecord,
} from '../types.js';
import type { ExecutionStore } from './store.js';
import { MemoryExecutionStore } from './memory.js';

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
    mkdirSync(dirname(dbPath), { recursive: true });
    const raw = new sqlite.DatabaseSync(dbPath);
    return {
      exec: (sql) => raw.exec(sql),
      prepare: (sql) => {
        const stmt = raw.prepare(sql);
        return {
          run: (...params) => { stmt.run(...params); },
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
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  session_id TEXT,
  workspace_root TEXT NOT NULL,
  critical_path_json TEXT,
  checkpoint_batch INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  execution_id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  execution_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  json TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (execution_id, task_id)
);
CREATE TABLE IF NOT EXISTS task_dependencies (
  execution_id TEXT NOT NULL,
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS task_attempts (
  execution_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (execution_id, task_id, attempt_number)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT,
  sha256 TEXT,
  json_payload TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS integrations (
  execution_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  report_json TEXT,
  applied_paths TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  report_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS execution_events (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  task_id TEXT,
  message TEXT NOT NULL,
  payload TEXT,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS checkpoints (
  execution_id TEXT PRIMARY KEY,
  batch_index INTEGER NOT NULL,
  completed_task_ids TEXT NOT NULL,
  in_flight_task_ids TEXT NOT NULL
);
`;

function parseJson<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row?.json) {
    return undefined;
  }
  try {
    return JSON.parse(String(row.json)) as T;
  } catch {
    return undefined;
  }
}

export class SqliteExecutionStore implements ExecutionStore {
  constructor(private readonly db: SqlDb) {
    db.exec(SCHEMA);
  }

  upsertExecution(record: ExecutionRecord): void {
    this.db.prepare(`
      INSERT INTO executions (id, objective, status, session_id, workspace_root, critical_path_json, checkpoint_batch, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        objective=excluded.objective, status=excluded.status, session_id=excluded.session_id,
        critical_path_json=excluded.critical_path_json, checkpoint_batch=excluded.checkpoint_batch, updated_at=excluded.updated_at
    `).run(
      record.id,
      record.objective,
      record.status,
      record.sessionId ?? null,
      record.workspaceRoot,
      record.criticalPathJson ? JSON.stringify(record.criticalPathJson) : null,
      record.checkpointBatch ?? null,
      record.createdAt,
      record.updatedAt,
    );
  }

  getExecution(id: string): ExecutionRecord | undefined {
    const row = this.db.prepare('SELECT * FROM executions WHERE id = ?').get(id);
    if (!row) return undefined;
    return {
      id: String(row.id),
      objective: String(row.objective),
      status: row.status as ExecutionRecord['status'],
      sessionId: row.session_id ? String(row.session_id) : undefined,
      workspaceRoot: String(row.workspace_root),
      criticalPathJson: row.critical_path_json ? JSON.parse(String(row.critical_path_json)) : undefined,
      checkpointBatch: row.checkpoint_batch != null ? Number(row.checkpoint_batch) : undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  listExecutions(workspaceRoot: string): ExecutionRecord[] {
    return this.db.prepare('SELECT * FROM executions WHERE workspace_root = ? ORDER BY created_at DESC')
      .all(workspaceRoot)
      .map(row => this.getExecution(String(row.id))!)
      .filter(Boolean);
  }

  getActiveExecution(sessionId: string): ExecutionRecord | undefined {
    const rows = this.db.prepare(`
      SELECT * FROM executions WHERE session_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
      ORDER BY updated_at DESC LIMIT 1
    `).all(sessionId);
    return rows[0] ? this.getExecution(String(rows[0].id)) : undefined;
  }

  upsertTask(executionId: string, task: TaskNode): void {
    this.db.prepare(`
      INSERT INTO tasks (execution_id, task_id, json, status) VALUES (?, ?, ?, ?)
      ON CONFLICT(execution_id, task_id) DO UPDATE SET json=excluded.json, status=excluded.status
    `).run(executionId, task.id, JSON.stringify(task), task.status);
  }

  getTask(executionId: string, taskId: string): TaskNode | undefined {
    const row = this.db.prepare('SELECT json FROM tasks WHERE execution_id = ? AND task_id = ?').get(executionId, taskId);
    return parseJson<TaskNode>(row);
  }

  listTasks(executionId: string): TaskNode[] {
    return this.db.prepare('SELECT json FROM tasks WHERE execution_id = ?').all(executionId)
      .map(row => parseJson<TaskNode>(row))
      .filter((t): t is TaskNode => !!t);
  }

  addDependency(dep: TaskDependency & { executionId: string }): void {
    this.db.prepare(`
      INSERT INTO task_dependencies (execution_id, from_task_id, to_task_id, kind, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(dep.executionId, dep.fromTaskId, dep.toTaskId, dep.kind, dep.reason ?? null);
  }

  listDependencies(executionId: string): TaskDependency[] {
    return this.db.prepare('SELECT * FROM task_dependencies WHERE execution_id = ?').all(executionId).map(row => ({
      fromTaskId: String(row.from_task_id),
      toTaskId: String(row.to_task_id),
      kind: row.kind as TaskDependency['kind'],
      reason: row.reason ? String(row.reason) : undefined,
    }));
  }

  insertAttempt(executionId: string, taskId: string, attempt: TaskAttempt): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO task_attempts (execution_id, task_id, attempt_number, json)
      VALUES (?, ?, ?, ?)
    `).run(executionId, taskId, attempt.attemptNumber, JSON.stringify(attempt));
  }

  listAttempts(executionId: string, taskId: string): TaskAttempt[] {
    return this.db.prepare('SELECT json FROM task_attempts WHERE execution_id = ? AND task_id = ? ORDER BY attempt_number')
      .all(executionId, taskId)
      .map(row => parseJson<TaskAttempt>(row))
      .filter((a): a is TaskAttempt => !!a);
  }

  insertArtifact(artifact: TaskArtifact): void {
    const id = `${artifact.taskId}:${artifact.kind}:${artifact.createdAt}`;
    this.db.prepare(`
      INSERT INTO artifacts (id, execution_id, task_id, kind, path, sha256, json_payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      artifact.taskId.split(':')[0] ?? artifact.taskId,
      artifact.taskId,
      artifact.kind,
      artifact.path ?? null,
      artifact.sha256 ?? null,
      artifact.jsonPayload ? JSON.stringify(artifact.jsonPayload) : null,
      artifact.createdAt,
    );
  }

  listArtifacts(_executionId: string, taskId?: string): TaskArtifact[] {
    const rows = taskId
      ? this.db.prepare('SELECT * FROM artifacts WHERE task_id = ?').all(taskId)
      : this.db.prepare('SELECT * FROM artifacts WHERE execution_id = ?').all(_executionId);
    return rows.map(row => ({
      taskId: String(row.task_id),
      kind: String(row.kind),
      path: row.path ? String(row.path) : undefined,
      sha256: row.sha256 ? String(row.sha256) : undefined,
      jsonPayload: row.json_payload ? JSON.parse(String(row.json_payload)) : undefined,
      createdAt: Number(row.created_at),
    }));
  }

  upsertIntegration(record: IntegrationRecord): void {
    this.db.prepare(`
      INSERT INTO integrations (execution_id, status, report_json, applied_paths, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(execution_id) DO UPDATE SET
        status=excluded.status, report_json=excluded.report_json,
        applied_paths=excluded.applied_paths, completed_at=excluded.completed_at
    `).run(
      record.executionId,
      record.status,
      record.reportJson ? JSON.stringify(record.reportJson) : null,
      record.appliedPaths ? JSON.stringify(record.appliedPaths) : null,
      record.createdAt,
      record.completedAt ?? null,
    );
  }

  getIntegration(executionId: string): IntegrationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM integrations WHERE execution_id = ?').get(executionId);
    if (!row) return undefined;
    return {
      executionId: String(row.execution_id),
      status: row.status as IntegrationRecord['status'],
      reportJson: row.report_json ? JSON.parse(String(row.report_json)) : undefined,
      appliedPaths: row.applied_paths ? JSON.parse(String(row.applied_paths)) : undefined,
      createdAt: Number(row.created_at),
      completedAt: row.completed_at != null ? Number(row.completed_at) : undefined,
    };
  }

  insertVerification(record: VerificationRecord): void {
    const id = `${record.executionId}:${record.createdAt}`;
    this.db.prepare(`
      INSERT INTO verifications (id, execution_id, verdict, report_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, record.executionId, record.verdict, record.reportJson ? JSON.stringify(record.reportJson) : null, record.createdAt);
  }

  getLatestVerification(executionId: string): VerificationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM verifications WHERE execution_id = ? ORDER BY created_at DESC LIMIT 1').get(executionId);
    if (!row) return undefined;
    return {
      executionId: String(row.execution_id),
      verdict: row.verdict as VerificationRecord['verdict'],
      reportJson: row.report_json ? JSON.parse(String(row.report_json)) : undefined,
      createdAt: Number(row.created_at),
    };
  }

  appendEvent(event: ExecutionEvent): void {
    this.db.prepare(`
      INSERT INTO execution_events (id, execution_id, kind, task_id, message, payload, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.executionId,
      event.kind,
      event.taskId ?? null,
      event.message,
      event.payload ? JSON.stringify(event.payload) : null,
      event.ts,
    );
  }

  listEvents(executionId: string, limit?: number): ExecutionEvent[] {
    const sql = limit
      ? 'SELECT * FROM execution_events WHERE execution_id = ? ORDER BY ts DESC LIMIT ?'
      : 'SELECT * FROM execution_events WHERE execution_id = ? ORDER BY ts';
    const rows = limit
      ? this.db.prepare(sql).all(executionId, limit)
      : this.db.prepare(sql).all(executionId);
    return rows.map(row => ({
      id: String(row.id),
      executionId: String(row.execution_id),
      kind: row.kind as ExecutionEvent['kind'],
      taskId: row.task_id ? String(row.task_id) : undefined,
      message: String(row.message),
      payload: row.payload ? JSON.parse(String(row.payload)) : undefined,
      ts: Number(row.ts),
    }));
  }

  savePlan(executionId: string, plan: ExecutionPlan): void {
    this.db.prepare('INSERT OR REPLACE INTO plans (execution_id, json) VALUES (?, ?)').run(executionId, JSON.stringify(plan));
    for (const node of plan.nodes) {
      this.upsertTask(executionId, node);
    }
  }

  getPlan(executionId: string): ExecutionPlan | undefined {
    const row = this.db.prepare('SELECT json FROM plans WHERE execution_id = ?').get(executionId);
    return parseJson<ExecutionPlan>(row);
  }

  saveCheckpoint(executionId: string, batchIndex: number, completedTaskIds: string[], inFlightTaskIds: string[]): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints (execution_id, batch_index, completed_task_ids, in_flight_task_ids)
      VALUES (?, ?, ?, ?)
    `).run(executionId, batchIndex, JSON.stringify(completedTaskIds), JSON.stringify(inFlightTaskIds));
    this.db.prepare('UPDATE executions SET checkpoint_batch = ?, updated_at = ? WHERE id = ?')
      .run(batchIndex, Date.now(), executionId);
  }

  getCheckpoint(executionId: string): { batchIndex: number; completedTaskIds: string[]; inFlightTaskIds: string[] } | undefined {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE execution_id = ?').get(executionId);
    if (!row) return undefined;
    return {
      batchIndex: Number(row.batch_index),
      completedTaskIds: JSON.parse(String(row.completed_task_ids)),
      inFlightTaskIds: JSON.parse(String(row.in_flight_task_ids)),
    };
  }

  close(): void {
    this.db.close();
  }
}

export function openExecutionStore(dbPath: string): ExecutionStore {
  const db = tryOpenSqlite(dbPath);
  if (db) {
    return new SqliteExecutionStore(db);
  }
  return new MemoryExecutionStore();
}
