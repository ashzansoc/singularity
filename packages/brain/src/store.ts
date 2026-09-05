/**
 * SQLite persistence for the Singularity Brain.
 *
 * Uses node:sqlite when available (Node >= 22.5 / the bundled Electron runtime)
 * and falls back to a JSON file so the Brain still works in constrained envs.
 * The DB is USER-level: one brain.sqlite per user, independent of workspaces.
 */

import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  BrainActivityEvent,
  BrainEntity,
  BrainEpisode,
  BrainEvaluation,
  BrainExperiment,
  BrainHypothesis,
  BrainInsight,
  BrainPolicy,
  BrainProcedure,
  BrainRelationship,
  BrainSyncState,
  BrainTypeMeta,
  EntityDetail,
  GraphViewEdge,
  InsightStatus,
  SearchFilters,
  UpsertEntityInput,
  UpsertRelationshipInput,
} from './types.js';
import { clusterForType } from './types.js';
import {
  COGNITIVE_SCHEMA,
  EPISODE_COLUMN_MIGRATIONS,
  enrichEpisodeRow,
  rowToActivity,
  rowToEvaluation,
  rowToExperiment,
  rowToHypothesis,
  rowToInsight,
  rowToPolicy,
  rowToProcedure,
} from './cognitiveSchema.js';

interface SqlStmt {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): SqlStmt;
  close(): void;
}

function tryOpenSqlite(dbPath: string): SqlDb | undefined {
  try {
    const req = createRequire(import.meta.url);
    const sqlite = req('node:sqlite') as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): SqlStmt;
        close(): void;
      };
    };
    const raw = new sqlite.DatabaseSync(dbPath);
    return {
      exec: (sql) => raw.exec(sql),
      prepare: (sql) => raw.prepare(sql),
      close: () => raw.close(),
    };
  } catch {
    return undefined;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  label_norm TEXT NOT NULL,
  description TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  confidence REAL NOT NULL DEFAULT 0.8,
  source_type TEXT NOT NULL DEFAULT 'unknown',
  source_ref TEXT,
  project_id TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  degree INTEGER NOT NULL DEFAULT 0,
  embedding BLOB
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_user_label ON entities(user_id, label_norm);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(user_id, type);
CREATE INDEX IF NOT EXISTS idx_entities_importance ON entities(user_id, importance DESC);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_event TEXT
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  project_id TEXT,
  workspace_root TEXT,
  entity_ids TEXT NOT NULL DEFAULT '[]',
  occurred_at INTEGER NOT NULL,
  source_ref TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_time ON episodes(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS type_registry (
  type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS sync_state (
  workspace_root TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT '',
  files_total INTEGER NOT NULL DEFAULT 0,
  files_done INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
` + COGNITIVE_SCHEMA;

export interface StoreRow {
  id: string;
  userId: string;
  type: string;
  label: string;
  description?: string;
  importance: number;
  confidence: number;
  sourceType: string;
  sourceRef?: string;
  projectId?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  degree: number;
}

function rowToEntity(r: Record<string, unknown>): BrainEntity {
  const type = String(r.type);
  return {
    id: String(r.id),
    userId: String(r.user_id),
    type,
    label: String(r.label),
    description: r.description === null || r.description === undefined ? undefined : String(r.description),
    importance: Number(r.importance),
    confidence: Number(r.confidence),
    sourceType: String(r.source_type),
    sourceRef: r.source_ref === null || r.source_ref === undefined ? undefined : String(r.source_ref),
    projectId: r.project_id === null || r.project_id === undefined ? undefined : String(r.project_id),
    firstSeenAt: Number(r.first_seen_at),
    lastSeenAt: Number(r.last_seen_at),
    degree: Number(r.degree ?? 0),
    authority: r.authority === null || r.authority === undefined ? undefined : String(r.authority) as BrainEntity['authority'],
    cluster: r.cluster === null || r.cluster === undefined ? clusterForType(type) : String(r.cluster),
    evidence: r.evidence === null || r.evidence === undefined ? undefined : String(r.evidence),
    validity: r.validity === null || r.validity === undefined ? undefined : String(r.validity),
    supersededBy: r.superseded_by === null || r.superseded_by === undefined ? undefined : String(r.superseded_by),
  };
}

function rowToRelationship(r: Record<string, unknown>): BrainRelationship {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    sourceId: String(r.source_id),
    targetId: String(r.target_id),
    relType: String(r.rel_type),
    confidence: Number(r.confidence),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    sourceEvent: r.source_event === null || r.source_event === undefined ? undefined : String(r.source_event),
  };
}

const SEED_TYPES: Array<[string, string, string]> = [
  ['project', 'Projects', '#6b7280'],
  ['repository', 'Repositories', '#9d7cd8'],
  ['code', 'Code', '#40a9ff'],
  ['technology', 'Technologies', '#50fa7b'],
  ['service', 'Services', '#38bdf8'],
  ['layer', 'Layers', '#67e8f9'],
  ['architecture', 'Architecture', '#c084fc'],
  ['concept', 'Concepts', '#22d3ee'],
  ['fact', 'Facts', '#cbd5e1'],
  ['requirement', 'Requirements', '#fca5a5'],
  ['constraint', 'Constraints', '#fb7185'],
  ['assumption', 'Assumptions', '#fdba74'],
  ['topic', 'Topics', '#a5b4fc'],
  ['goal', 'Goals', '#f8fafc'],
  ['decision', 'Decisions', '#ffd866'],
  ['tradeoff', 'Tradeoffs', '#fbbf24'],
  ['learning', 'Learnings', '#f1fa8c'],
  ['lesson', 'Lessons', '#fde047'],
  ['observation', 'Observations', '#94a3b8'],
  ['experiment', 'Experiments', '#ff79c6'],
  ['hypothesis', 'Hypotheses', '#e879f9'],
  ['evaluation', 'Evaluations', '#34d399'],
  ['outcome', 'Outcomes', '#4ade80'],
  ['experience', 'Experiences', '#f472b6'],
  ['conversation', 'Conversations', '#8be9fd'],
  ['document', 'Documents', '#94a3b8'],
  ['task', 'Tasks', '#fbbf24'],
  ['plan', 'Plans', '#fcd34d'],
  ['change', 'Changes', '#fb923c'],
  ['event', 'Events', '#fdba74'],
  ['person', 'People', '#ff2e88'],
  ['bug', 'Bugs', '#ff5555'],
  ['solution', 'Solutions', '#34d399'],
  ['preference', 'Preferences', '#c084fc'],
];

const ENTITY_COLUMN_MIGRATIONS = [
  'ALTER TABLE entities ADD COLUMN authority TEXT',
  'ALTER TABLE entities ADD COLUMN cluster TEXT',
  'ALTER TABLE entities ADD COLUMN evidence TEXT',
  'ALTER TABLE entities ADD COLUMN validity TEXT',
  'ALTER TABLE entities ADD COLUMN superseded_by TEXT',
];

export class BrainStore {
  private readonly db?: SqlDb;
  private readonly jsonPath?: string;
  private mem = {
    entities: new Map<string, BrainEntity & { embedding?: number[] }>(),
    rels: new Map<string, BrainRelationship>(),
    episodes: [] as BrainEpisode[],
    procedures: new Map<string, BrainProcedure>(),
    insights: new Map<string, BrainInsight>(),
    hypotheses: new Map<string, BrainHypothesis>(),
    policies: new Map<string, BrainPolicy>(),
    experiments: new Map<string, BrainExperiment>(),
    evaluations: new Map<string, BrainEvaluation>(),
    activity: [] as BrainActivityEvent[],
  };

  constructor(
    dbPath: string,
    private readonly userId: string,
  ) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = tryOpenSqlite(dbPath);
    if (this.db) {
      this.db.exec(SCHEMA);
      this.migrateEntityColumns();
      this.migrateCognitive();
      this.seedTypes();
    } else {
      this.jsonPath = dbPath.replace(/\.sqlite$/, '') + '.json';
      if (existsSync(this.jsonPath)) {
        try {
          const parsed = JSON.parse(readFileSync(this.jsonPath, 'utf8')) as {
            entities?: Array<BrainEntity & { embedding?: number[] }>;
            rels?: BrainRelationship[];
            episodes?: BrainEpisode[];
            procedures?: BrainProcedure[];
            insights?: BrainInsight[];
            hypotheses?: BrainHypothesis[];
            policies?: BrainPolicy[];
            experiments?: BrainExperiment[];
            evaluations?: BrainEvaluation[];
            activity?: BrainActivityEvent[];
            kv?: Record<string, string>;
          };
          for (const e of parsed.entities ?? []) {
            this.mem.entities.set(e.id, e);
          }
          for (const r of parsed.rels ?? []) {
            this.mem.rels.set(r.id, r);
          }
          this.mem.episodes = parsed.episodes ?? [];
          for (const p of parsed.procedures ?? []) {
            this.mem.procedures.set(p.id, p);
          }
          for (const i of parsed.insights ?? []) {
            this.mem.insights.set(i.id, i);
          }
          for (const h of parsed.hypotheses ?? []) {
            this.mem.hypotheses.set(h.id, h);
          }
          for (const p of parsed.policies ?? []) {
            this.mem.policies.set(p.id, p);
          }
          for (const e of parsed.experiments ?? []) {
            this.mem.experiments.set(e.id, e);
          }
          for (const e of parsed.evaluations ?? []) {
            this.mem.evaluations.set(e.id, e);
          }
          this.mem.activity = parsed.activity ?? [];
          for (const [k, v] of Object.entries(parsed.kv ?? {})) {
            this.memKv.set(k, v);
          }
        } catch {
          /* start fresh */
        }
      }
    }
  }

  get usesSqlite(): boolean {
    return Boolean(this.db);
  }

  private migrateEntityColumns(): void {
    if (!this.db) {
      return;
    }
    for (const sql of ENTITY_COLUMN_MIGRATIONS) {
      try {
        this.db.exec(sql);
      } catch {
        /* column already exists */
      }
    }
  }

  private migrateCognitive(): void {
    if (!this.db) {
      return;
    }
    try {
      this.db.exec(COGNITIVE_SCHEMA);
    } catch {
      /* ignore */
    }
    for (const sql of EPISODE_COLUMN_MIGRATIONS) {
      try {
        this.db.exec(sql);
      } catch {
        /* column already exists */
      }
    }
  }

  private seedTypes(): void {
    if (!this.db) {
      return;
    }
    const stmt = this.db.prepare('INSERT OR IGNORE INTO type_registry (type, label, color, sort_order) VALUES (?, ?, ?, ?)');
    SEED_TYPES.forEach(([type, label, color], i) => stmt.run(type, label, color, i * 10));
    // Refresh colors for known types (project demoted from purple hub).
    const upd = this.db.prepare('UPDATE type_registry SET label = ?, color = ? WHERE type = ?');
    for (const [type, label, color] of SEED_TYPES) {
      upd.run(label, color, type);
    }
  }

  listTypeRegistry(): BrainTypeMeta[] {
    if (this.db) {
      return this.db
        .prepare('SELECT type, label, color, sort_order FROM type_registry ORDER BY sort_order')
        .all()
        .map((r) => ({ type: String(r.type), label: String(r.label), color: String(r.color), order: Number(r.sort_order) }));
    }
    return SEED_TYPES.map(([type, label, color], i) => ({ type, label, color, order: i * 10 }));
  }

  registerType(type: string, label: string, color: string): void {
    if (!this.db) {
      return;
    }
    this.db
      .prepare('INSERT INTO type_registry (type, label, color, sort_order) VALUES (?, ?, ?, 500) ON CONFLICT(type) DO UPDATE SET label=excluded.label, color=excluded.color')
      .run(type, label, color);
  }

  // ---- Entities -------------------------------------------------------------

  findByNormLabel(labelNorm: string): BrainEntity | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM entities WHERE user_id = ? AND label_norm = ?').get(this.userId, labelNorm);
      return r ? rowToEntity(r) : undefined;
    }
    for (const e of this.mem.entities.values()) {
      if (normLabel(e.label) === labelNorm) {
        const { embedding: _e, ...rest } = e;
        return rest;
      }
    }
    return undefined;
  }

  upsertEntity(input: UpsertEntityInput, embedding?: number[], now = Date.now()): BrainEntity {
    const labelNorm = normLabel(input.label);
    const existing = this.findByNormLabel(labelNorm);
    if (existing) {
      const merged: BrainEntity = {
        ...existing,
        description: input.description?.trim() ? input.description : existing.description,
        confidence: Math.min(1, Math.max(existing.confidence, input.confidence ?? existing.confidence)),
        lastSeenAt: now,
        projectId: existing.projectId ?? input.projectId,
        importance: Math.max(existing.importance, input.importance ?? 0),
        authority: input.authority ?? existing.authority,
        cluster: input.cluster ?? existing.cluster ?? clusterForType(existing.type),
        evidence: input.evidence ?? existing.evidence,
        validity: input.validity ?? existing.validity,
        supersededBy: input.supersededBy ?? existing.supersededBy,
      };
      this.writeEntity(merged, mergeEmbedding(this.getEmbedding(existing.id), embedding));
      return merged;
    }
    const entity: BrainEntity = {
      id: `ent_${randomId()}`,
      userId: this.userId,
      type: input.type,
      label: input.label.trim(),
      description: input.description?.trim() || undefined,
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.8,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      projectId: input.projectId,
      firstSeenAt: now,
      lastSeenAt: now,
      degree: 0,
      authority: input.authority,
      cluster: input.cluster ?? clusterForType(input.type),
      evidence: input.evidence,
      validity: input.validity ?? 'active',
      supersededBy: input.supersededBy,
    };
    this.writeEntity(entity, embedding);
    return entity;
  }

  private writeEntity(e: BrainEntity, embedding?: number[] | undefined): void {
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO entities (id, user_id, type, label, label_norm, description, importance, confidence, source_type, source_ref, project_id, first_seen_at, last_seen_at, degree, embedding, authority, cluster, evidence, validity, superseded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type=excluded.type, label=excluded.label, label_norm=excluded.label_norm,
             description=COALESCE(excluded.description, entities.description),
             importance=excluded.importance, confidence=excluded.confidence,
             source_ref=COALESCE(excluded.source_ref, entities.source_ref),
             project_id=COALESCE(entities.project_id, excluded.project_id),
             first_seen_at=excluded.first_seen_at, last_seen_at=excluded.last_seen_at,
             embedding=COALESCE(excluded.embedding, entities.embedding),
             authority=COALESCE(excluded.authority, entities.authority),
             cluster=COALESCE(excluded.cluster, entities.cluster),
             evidence=COALESCE(excluded.evidence, entities.evidence),
             validity=COALESCE(excluded.validity, entities.validity),
             superseded_by=COALESCE(excluded.superseded_by, entities.superseded_by)`,
        )
        .run(
          e.id, e.userId, e.type, e.label, normLabel(e.label), e.description ?? null, e.importance, e.confidence,
          e.sourceType, e.sourceRef ?? null, e.projectId ?? null, e.firstSeenAt, e.lastSeenAt, e.degree,
          embedding ? packEmbedding(embedding) : null,
          e.authority ?? null, e.cluster ?? null, e.evidence ?? null, e.validity ?? null, e.supersededBy ?? null,
        );
    } else {
      const prev = this.mem.entities.get(e.id);
      this.mem.entities.set(e.id, { ...e, ...(prev?.embedding || embedding ? { embedding: embedding ?? prev?.embedding } : {}) });
    }
  }

  getEntity(id: string): BrainEntity | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM entities WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToEntity(r) : undefined;
    }
    const e = this.mem.entities.get(id);
    if (!e) {
      return undefined;
    }
    const { embedding: _e, ...rest } = e;
    return rest;
  }

  getEmbedding(id: string): number[] | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT embedding FROM entities WHERE id = ?').get(id);
      const blob = r?.embedding;
      if (!blob || typeof blob !== 'object') {
        return undefined;
      }
      return unpackEmbedding(blob as Uint8Array);
    }
    return this.mem.entities.get(id)?.embedding;
  }

  setEmbedding(id: string, embedding: number[]): void {
    if (this.db) {
      this.db.prepare('UPDATE entities SET embedding = ? WHERE id = ?').run(packEmbedding(embedding), id);
    } else {
      const e = this.mem.entities.get(id);
      if (e) {
        e.embedding = embedding;
      }
    }
  }

  entitiesMissingEmbeddings(limit = 256): BrainEntity[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM entities WHERE embedding IS NULL ORDER BY importance DESC LIMIT ?')
        .all(limit)
        .map(rowToEntity);
    }
    return [...this.mem.entities.values()].filter((e) => !e.embedding).slice(0, limit).map(({ embedding: _e, ...rest }) => rest);
  }

  countEntities(): number {
    if (this.db) {
      const r = this.db.prepare('SELECT COUNT(*) AS c FROM entities WHERE user_id = ?').get(this.userId);
      return Number((r as { c: number | bigint }).c);
    }
    return this.mem.entities.size;
  }

  topEntities(limit: number, filters?: SearchFilters): BrainEntity[] {
    const conds: string[] = ['user_id = ?'];
    const params: unknown[] = [this.userId];
    if (filters?.types?.length) {
      conds.push(`type IN (${filters.types.map(() => '?').join(',')})`);
      params.push(...filters.types);
    }
    if (filters?.projectId) {
      params.push(filters.projectId);
      conds.push('(project_id = ? OR id IN (SELECT source_id FROM relationships WHERE target_id IN (SELECT id FROM entities WHERE project_id = ?)) OR id IN (SELECT target_id FROM relationships WHERE source_id IN (SELECT id FROM entities WHERE project_id = ?)))');
      params.push(filters.projectId, filters.projectId);
    }
    if (filters?.since !== undefined) {
      params.push(filters.since);
      conds.push('last_seen_at >= ?');
    }
    if (filters?.until !== undefined) {
      params.push(filters.until);
      conds.push('last_seen_at <= ?');
    }
    if (filters?.clusters?.length) {
      conds.push(`cluster IN (${filters.clusters.map(() => '?').join(',')})`);
      params.push(...filters.clusters);
    }
    if (this.db) {
      return this.db
        .prepare(`SELECT * FROM entities WHERE ${conds.join(' AND ')} ORDER BY importance DESC LIMIT ?`)
        .all(...params, limit)
        .map(rowToEntity);
    }
    let list = [...this.mem.entities.values()];
    if (filters?.types?.length) {
      list = list.filter((e) => filters.types!.includes(e.type));
    }
    if (filters?.clusters?.length) {
      list = list.filter((e) => e.cluster && filters.clusters!.includes(e.cluster));
    }
    if (filters?.projectId) {
      const keep = new Set<string>();
      for (const e of list) {
        if (e.projectId === filters.projectId) {
          keep.add(e.id);
        }
      }
      for (const r of this.mem.rels.values()) {
        const s = this.mem.entities.get(r.sourceId);
        const t = this.mem.entities.get(r.targetId);
        if (s?.projectId === filters.projectId) {
          keep.add(r.targetId);
        }
        if (t?.projectId === filters.projectId) {
          keep.add(r.sourceId);
        }
      }
      list = list.filter((e) => keep.has(e.id));
    }
    if (filters?.since !== undefined) {
      list = list.filter((e) => e.lastSeenAt >= filters.since!);
    }
    if (filters?.until !== undefined) {
      list = list.filter((e) => e.lastSeenAt <= filters.until!);
    }
    return list.sort((a, b) => b.importance - a.importance).slice(0, limit).map(({ embedding: _e, ...rest }) => rest);
  }

  allEntitiesWithEmbeddings(): Array<{ entity: BrainEntity; embedding: number[] }> {
    if (this.db) {
      const out: Array<{ entity: BrainEntity; embedding: number[] }> = [];
      const rows = this.db.prepare('SELECT * FROM entities WHERE embedding IS NOT NULL').all();
      for (const r of rows) {
        const emb = unpackEmbedding(r.embedding as Uint8Array);
        if (emb) {
          out.push({ entity: rowToEntity(r), embedding: emb });
        }
      }
      return out;
    }
    const out: Array<{ entity: BrainEntity; embedding: number[] }> = [];
    for (const e of this.mem.entities.values()) {
      if (e.embedding) {
        const { embedding, ...rest } = e;
        out.push({ entity: rest, embedding });
      }
    }
    return out;
  }

  // ---- Relationships --------------------------------------------------------

  upsertRelationship(input: UpsertRelationshipInput, resolveEntity: (label: string, type: string) => BrainEntity, now = Date.now()): BrainRelationship | undefined {
    const src = resolveEntity(input.sourceLabel, input.sourceType);
    const tgt = resolveEntity(input.targetLabel, input.targetType);
    if (!src || !tgt || src.id === tgt.id) {
      return undefined;
    }
    const existing = this.findRelationship(src.id, tgt.id, input.relType);
    if (existing) {
      const updated: BrainRelationship = {
        ...existing,
        confidence: Math.min(1, Math.max(existing.confidence, input.confidence ?? 0)),
        updatedAt: now,
        sourceEvent: input.sourceEvent ?? existing.sourceEvent,
      };
      this.writeRelationship(updated);
      return updated;
    }
    const rel: BrainRelationship = {
      id: `rel_${randomId()}`,
      userId: this.userId,
      sourceId: src.id,
      targetId: tgt.id,
      relType: input.relType,
      confidence: input.confidence ?? 0.8,
      createdAt: now,
      updatedAt: now,
      sourceEvent: input.sourceEvent,
    };
    this.writeRelationship(rel);
    return rel;
  }

  findRelationship(sourceId: string, targetId: string, relType: string): BrainRelationship | undefined {
    if (this.db) {
      const r = this.db
        .prepare('SELECT * FROM relationships WHERE source_id = ? AND target_id = ? AND rel_type = ?')
        .get(sourceId, targetId, relType);
      return r ? rowToRelationship(r) : undefined;
    }
    for (const r of this.mem.rels.values()) {
      if (r.sourceId === sourceId && r.targetId === targetId && r.relType === relType) {
        return r;
      }
    }
    return undefined;
  }

  private writeRelationship(rel: BrainRelationship): void {
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO relationships (id, user_id, source_id, target_id, rel_type, confidence, created_at, updated_at, source_event)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET confidence=excluded.confidence, updated_at=excluded.updated_at, source_event=COALESCE(excluded.source_event, relationships.source_event)`,
        )
        .run(rel.id, rel.userId, rel.sourceId, rel.targetId, rel.relType, rel.confidence, rel.createdAt, rel.updatedAt, rel.sourceEvent ?? null);
    } else {
      this.mem.rels.set(rel.id, rel);
    }
  }

  edgesFor(nodeIds: Set<string>): GraphViewEdge[] {
    const out: GraphViewEdge[] = [];
    if (this.db) {
      const placeholders = [...nodeIds].map(() => '?').join(',');
      if (!placeholders) {
        return out;
      }
      const rows = this.db
        .prepare(`SELECT * FROM relationships WHERE source_id IN (${placeholders}) AND target_id IN (${placeholders})`)
        .all(...nodeIds, ...nodeIds);
      for (const r of rows) {
        const rel = rowToRelationship(r);
        out.push({ id: rel.id, source: rel.sourceId, target: rel.targetId, relType: rel.relType, confidence: rel.confidence });
      }
      return out;
    }
    for (const r of this.mem.rels.values()) {
      if (nodeIds.has(r.sourceId) && nodeIds.has(r.targetId)) {
        out.push({ id: r.id, source: r.sourceId, target: r.targetId, relType: r.relType, confidence: r.confidence });
      }
    }
    return out;
  }

  refreshDegrees(): void {
    if (this.db) {
      this.db.exec(`
        UPDATE entities SET degree = (
          SELECT COUNT(*) FROM relationships r WHERE r.source_id = entities.id OR r.target_id = entities.id
        )`);
    } else {
      const counts = new Map<string, number>();
      for (const r of this.mem.rels.values()) {
        counts.set(r.sourceId, (counts.get(r.sourceId) ?? 0) + 1);
        counts.set(r.targetId, (counts.get(r.targetId) ?? 0) + 1);
      }
      for (const [id, e] of this.mem.entities) {
        e.degree = counts.get(id) ?? 0;
      }
    }
  }

  /**
   * Remove star-hub edges from a project node (belongs_to / implemented_in)
   * so the graph can re-wire through semantic intermediates. Keeps uses edges
   * that already point at technologies — those get re-homed by the engine.
   */
  pruneProjectStarEdges(projectEntityId: string): number {
    const STAR = new Set(['belongs_to', 'implemented_in', 'uses', 'contains']);
    let removed = 0;
    if (this.db) {
      const rows = this.db
        .prepare(
          `SELECT id FROM relationships
           WHERE source_id = ? AND rel_type IN ('belongs_to', 'implemented_in', 'uses', 'contains')`,
        )
        .all(projectEntityId);
      const del = this.db.prepare('DELETE FROM relationships WHERE id = ?');
      for (const r of rows) {
        del.run(r.id);
        removed++;
      }
    } else {
      for (const [id, rel] of [...this.mem.rels.entries()]) {
        if (rel.sourceId === projectEntityId && STAR.has(rel.relType)) {
          this.mem.rels.delete(id);
          removed++;
        }
      }
    }
    return removed;
  }

  /** Entities of a given type (for cluster-balanced graph views). */
  entitiesByType(type: string, limit = 80): BrainEntity[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM entities WHERE user_id = ? AND type = ? ORDER BY importance DESC LIMIT ?')
        .all(this.userId, type, limit)
        .map(rowToEntity);
    }
    return [...this.mem.entities.values()]
      .filter((e) => e.type === type)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)
      .map(({ embedding: _e, ...rest }) => rest);
  }

  // ---- Neighborhood / detail ------------------------------------------------

  neighborsOf(id: string): Array<{ entity: BrainEntity; rel: BrainRelationship; direction: 'out' | 'in' }> {
    const out: Array<{ entity: BrainEntity; rel: BrainRelationship; direction: 'out' | 'in' }> = [];
    const loadRel = (r: BrainRelationship) => {
      const otherId = r.sourceId === id ? r.targetId : r.sourceId;
      const entity = this.getEntity(otherId);
      if (entity) {
        out.push({ entity, rel: r, direction: r.sourceId === id ? 'out' : 'in' });
      }
    };
    if (this.db) {
      for (const r of this.db.prepare('SELECT * FROM relationships WHERE source_id = ?').all(id)) {
        loadRel(rowToRelationship(r));
      }
      for (const r of this.db.prepare('SELECT * FROM relationships WHERE target_id = ?').all(id)) {
        loadRel(rowToRelationship(r));
      }
    } else {
      for (const r of this.mem.rels.values()) {
        if (r.sourceId === id || r.targetId === id) {
          loadRel(r);
        }
      }
    }
    return out;
  }

  detail(id: string): EntityDetail | undefined {
    const entity = this.getEntity(id);
    if (!entity) {
      return undefined;
    }
    const neighbors = this.neighborsOf(id);
    const projects = new Map<string, string>();
    if (entity.projectId) {
      projects.set(entity.projectId, entity.projectId);
    }
    const related: EntityDetail['related'] = [];
    const decisions: string[] = [];
    const learnings: string[] = [];
    for (const n of neighbors) {
      related.push({ id: n.entity.id, label: n.entity.label, type: n.entity.type, relType: n.rel.relType, direction: n.direction });
      if (n.entity.projectId && !projects.has(n.entity.projectId)) {
        projects.set(n.entity.projectId, n.entity.projectId);
      }
      if (n.entity.type === 'decision') {
        decisions.push(n.entity.label + (n.entity.description ? ` — ${n.entity.description}` : ''));
      }
      if (n.entity.type === 'learning') {
        learnings.push(n.entity.label + (n.entity.description ? ` — ${n.entity.description}` : ''));
      }
    }
    return {
      ...entity,
      projects: [...projects].map(([projectId, label]) => ({ projectId, label })),
      related: related.sort((a, b) => a.type.localeCompare(b.type)).slice(0, 24),
      decisions: decisions.slice(0, 8),
      learnings: learnings.slice(0, 8),
      episodeCount: this.episodesFor(id).length,
    };
  }

  // ---- Episodes ---------------------------------------------------------------

  addEpisode(ep: Omit<BrainEpisode, 'id' | 'userId'>): BrainEpisode {
    const full: BrainEpisode = { id: `ep_${randomId()}`, userId: this.userId, ...ep };
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO episodes (id, user_id, kind, summary, project_id, workspace_root, entity_ids, occurred_at, source_ref,
            outcome, intention, action, result, lesson, meta_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          full.id, full.userId, full.kind, full.summary, full.projectId ?? null, full.workspaceRoot ?? null,
          JSON.stringify(full.entityIds), full.occurredAt, full.sourceRef ?? null,
          full.outcome ?? null, full.intention ?? null, full.action ?? null, full.result ?? null,
          full.lesson ?? null, full.meta ? JSON.stringify(full.meta) : null,
        );
    } else {
      this.mem.episodes.push(full);
    }
    return full;
  }

  episodesFor(entityId: string, limit = 20): BrainEpisode[] {
    const like = `%${entityId}%`;
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM episodes WHERE user_id = ? AND entity_ids LIKE ? ORDER BY occurred_at DESC LIMIT ?')
        .all(this.userId, like, limit)
        .map(rowToEpisode);
    }
    return this.mem.episodes.filter((e) => e.entityIds.includes(entityId)).sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
  }

  recentEpisodes(limit = 30): BrainEpisode[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM episodes WHERE user_id = ? ORDER BY occurred_at DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToEpisode);
    }
    return [...this.mem.episodes].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
  }

  // ---- Sync state ----------------------------------------------------------

  getSyncState(workspaceRoot: string): BrainSyncState | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM sync_state WHERE workspace_root = ?').get(workspaceRoot);
      return r ? rowToSyncState(r) : undefined;
    }
    return this.kvGet(`sync:${workspaceRoot}`) ? (JSON.parse(this.kvGet(`sync:${workspaceRoot}`)!) as BrainSyncState) : undefined;
  }

  setSyncState(state: BrainSyncState): void {
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO sync_state (workspace_root, status, phase, files_total, files_done, started_at, updated_at, finished_at, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_root) DO UPDATE SET status=excluded.status, phase=excluded.phase, files_total=excluded.files_total,
             files_done=excluded.files_done, updated_at=excluded.updated_at, finished_at=excluded.finished_at, error=excluded.error`,
        )
        .run(state.workspaceRoot, state.status, state.phase, state.filesTotal, state.filesDone, state.startedAt, state.updatedAt, state.finishedAt ?? null, state.error ?? null);
    } else {
      this.kvSet(`sync:${state.workspaceRoot}`, JSON.stringify(state));
    }
  }

  // ---- KV -------------------------------------------------------------------

  kvGet(key: string): string | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(key);
      return r ? String(r.v) : undefined;
    }
    return this.memKv.get(key);
  }

  kvSet(key: string, value: string): void {
    if (this.db) {
      this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, value);
    } else {
      this.memKv.set(key, value);
    }
  }

  private memKv = new Map<string, string>();

  // ---- Cognitive runtime persistence ----------------------------------------

  upsertProcedure(input: Omit<BrainProcedure, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }, now = Date.now()): BrainProcedure {
    const existing = input.id ? this.getProcedure(input.id) : [...(this.db ? [] : this.mem.procedures.values())].find((p) => p.name === input.name);
    const full: BrainProcedure = {
      id: existing?.id ?? input.id ?? `proc_${randomId()}`,
      userId: this.userId,
      name: input.name,
      conditions: input.conditions,
      steps: input.steps,
      successRate: input.successRate,
      failureRate: input.failureRate,
      evidence: input.evidence,
      confidence: input.confidence,
      lastUsed: input.lastUsed,
      lastEvaluated: input.lastEvaluated,
      projectId: input.projectId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO procedures (id, user_id, name, conditions, steps, success_rate, failure_rate, evidence, confidence, last_used, last_evaluated, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, conditions=excluded.conditions, steps=excluded.steps,
             success_rate=excluded.success_rate, failure_rate=excluded.failure_rate, evidence=excluded.evidence,
             confidence=excluded.confidence, last_used=excluded.last_used, last_evaluated=excluded.last_evaluated,
             project_id=excluded.project_id, updated_at=excluded.updated_at`,
        )
        .run(
          full.id, full.userId, full.name, full.conditions ?? null, JSON.stringify(full.steps),
          full.successRate, full.failureRate, JSON.stringify(full.evidence), full.confidence,
          full.lastUsed ?? null, full.lastEvaluated ?? null, full.projectId ?? null, full.createdAt, full.updatedAt,
        );
    } else {
      this.mem.procedures.set(full.id, full);
    }
    return full;
  }

  getProcedure(id: string): BrainProcedure | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM procedures WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToProcedure(r) : undefined;
    }
    return this.mem.procedures.get(id);
  }

  searchProcedures(query: string, limit = 20): BrainProcedure[] {
    const q = query.trim().toLowerCase();
    const all = this.listProcedures(200);
    if (!q) {
      return all.slice(0, limit);
    }
    return all.filter((p) => p.name.toLowerCase().includes(q) || (p.conditions ?? '').toLowerCase().includes(q)).slice(0, limit);
  }

  listProcedures(limit = 50): BrainProcedure[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM procedures WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToProcedure);
    }
    return [...this.mem.procedures.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  upsertInsight(input: Omit<BrainInsight, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }, now = Date.now()): BrainInsight {
    const id = input.id ?? `ins_${randomId()}`;
    const existing = this.getInsight(id);
    const full: BrainInsight = {
      id,
      userId: this.userId,
      projectId: input.projectId,
      title: input.title,
      kind: input.kind,
      confidence: input.confidence,
      observation: input.observation,
      reasoning: input.reasoning,
      improvement: input.improvement,
      evidence: input.evidence ?? [],
      relatedMemoryIds: input.relatedMemoryIds ?? [],
      relatedFiles: input.relatedFiles ?? [],
      status: input.status ?? 'new',
      reasoningMode: input.reasoningMode ?? 'default',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO insights (id, user_id, project_id, title, kind, confidence, observation, reasoning, improvement,
            evidence, related_memory_ids, related_files, status, reasoning_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title, kind=excluded.kind, confidence=excluded.confidence,
             observation=excluded.observation, reasoning=excluded.reasoning, improvement=excluded.improvement,
             evidence=excluded.evidence, related_memory_ids=excluded.related_memory_ids, related_files=excluded.related_files,
             status=excluded.status, reasoning_mode=excluded.reasoning_mode, updated_at=excluded.updated_at`,
        )
        .run(
          full.id, full.userId, full.projectId ?? null, full.title, full.kind, full.confidence,
          full.observation ?? null, full.reasoning ?? null, full.improvement ?? null,
          JSON.stringify(full.evidence), JSON.stringify(full.relatedMemoryIds), JSON.stringify(full.relatedFiles),
          full.status, full.reasoningMode, full.createdAt, full.updatedAt,
        );
    } else {
      this.mem.insights.set(full.id, full);
    }
    return full;
  }

  getInsight(id: string): BrainInsight | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM insights WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToInsight(r) : undefined;
    }
    return this.mem.insights.get(id);
  }

  listInsights(limit = 40, status?: InsightStatus): BrainInsight[] {
    if (this.db) {
      if (status) {
        return this.db
          .prepare('SELECT * FROM insights WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?')
          .all(this.userId, status, limit)
          .map(rowToInsight);
      }
      return this.db
        .prepare('SELECT * FROM insights WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToInsight);
    }
    let list = [...this.mem.insights.values()];
    if (status) {
      list = list.filter((i) => i.status === status);
    }
    return list.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  updateInsightStatus(id: string, status: InsightStatus): BrainInsight | undefined {
    const cur = this.getInsight(id);
    if (!cur) {
      return undefined;
    }
    return this.upsertInsight({ ...cur, status });
  }

  upsertHypothesis(input: Omit<BrainHypothesis, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }, now = Date.now()): BrainHypothesis {
    const id = input.id ?? `hyp_${randomId()}`;
    const existing = this.getHypothesis(id);
    const full: BrainHypothesis = {
      id,
      userId: this.userId,
      projectId: input.projectId,
      statement: input.statement,
      counterStatement: input.counterStatement,
      confidence: input.confidence,
      evidenceIds: input.evidenceIds ?? [],
      status: input.status ?? 'open',
      insightId: input.insightId,
      experimentId: input.experimentId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO hypotheses (id, user_id, project_id, statement, counter_statement, confidence, evidence_ids, status, insight_id, experiment_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET statement=excluded.statement, counter_statement=excluded.counter_statement,
             confidence=excluded.confidence, evidence_ids=excluded.evidence_ids, status=excluded.status,
             insight_id=excluded.insight_id, experiment_id=excluded.experiment_id, updated_at=excluded.updated_at`,
        )
        .run(
          full.id, full.userId, full.projectId ?? null, full.statement, full.counterStatement ?? null,
          full.confidence, JSON.stringify(full.evidenceIds), full.status, full.insightId ?? null,
          full.experimentId ?? null, full.createdAt, full.updatedAt,
        );
    } else {
      this.mem.hypotheses.set(full.id, full);
    }
    return full;
  }

  getHypothesis(id: string): BrainHypothesis | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM hypotheses WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToHypothesis(r) : undefined;
    }
    return this.mem.hypotheses.get(id);
  }

  listHypotheses(limit = 40): BrainHypothesis[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM hypotheses WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToHypothesis);
    }
    return [...this.mem.hypotheses.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  upsertPolicy(input: Omit<BrainPolicy, 'id' | 'userId' | 'createdAt' | 'updatedAt'> & { id?: string }, now = Date.now()): BrainPolicy {
    const id = input.id ?? `pol_${randomId()}`;
    const existing = this.getPolicy(id);
    const full: BrainPolicy = {
      id,
      userId: this.userId,
      kind: input.kind,
      version: input.version,
      payload: input.payload ?? {},
      status: input.status,
      autonomyLevel: input.autonomyLevel,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO policies (id, user_id, kind, version, payload, status, autonomy_level, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, version=excluded.version, payload=excluded.payload,
             status=excluded.status, autonomy_level=excluded.autonomy_level, updated_at=excluded.updated_at`,
        )
        .run(
          full.id, full.userId, full.kind, full.version, JSON.stringify(full.payload),
          full.status, full.autonomyLevel, full.createdAt, full.updatedAt,
        );
    } else {
      this.mem.policies.set(full.id, full);
    }
    return full;
  }

  getPolicy(id: string): BrainPolicy | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM policies WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToPolicy(r) : undefined;
    }
    return this.mem.policies.get(id);
  }

  listPolicies(kind?: string, limit = 40): BrainPolicy[] {
    if (this.db) {
      if (kind) {
        return this.db
          .prepare('SELECT * FROM policies WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT ?')
          .all(this.userId, kind, limit)
          .map(rowToPolicy);
      }
      return this.db
        .prepare('SELECT * FROM policies WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToPolicy);
    }
    let list = [...this.mem.policies.values()];
    if (kind) {
      list = list.filter((p) => p.kind === kind);
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }

  currentPolicy(kind: string): BrainPolicy | undefined {
    return this.listPolicies(kind, 20).find((p) => p.status === 'current');
  }

  upsertExperiment(input: Omit<BrainExperiment, 'id' | 'userId' | 'createdAt'> & { id?: string }, now = Date.now()): BrainExperiment {
    const id = input.id ?? `exp_${randomId()}`;
    const existing = this.getExperiment(id);
    const full: BrainExperiment = {
      id,
      userId: this.userId,
      name: input.name,
      policyKind: input.policyKind,
      baselinePolicyId: input.baselinePolicyId,
      candidatePolicyId: input.candidatePolicyId,
      hypothesisId: input.hypothesisId,
      evaluationSet: input.evaluationSet,
      baselineMetrics: input.baselineMetrics ?? {},
      candidateMetrics: input.candidateMetrics ?? {},
      metricsMeta: input.metricsMeta,
      status: input.status,
      decision: input.decision,
      summary: input.summary,
      createdAt: existing?.createdAt ?? now,
      finishedAt: input.finishedAt,
    };
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO experiments (id, user_id, name, policy_kind, baseline_policy_id, candidate_policy_id, hypothesis_id,
            evaluation_set, baseline_metrics, candidate_metrics, metrics_meta, status, decision, summary, created_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, baseline_metrics=excluded.baseline_metrics,
             candidate_metrics=excluded.candidate_metrics, status=excluded.status, decision=excluded.decision,
             summary=excluded.summary, finished_at=excluded.finished_at`,
        )
        .run(
          full.id, full.userId, full.name, full.policyKind, full.baselinePolicyId ?? null, full.candidatePolicyId,
          full.hypothesisId ?? null, full.evaluationSet, JSON.stringify(full.baselineMetrics),
          JSON.stringify(full.candidateMetrics), full.metricsMeta ? JSON.stringify(full.metricsMeta) : null,
          full.status, full.decision, full.summary ?? null, full.createdAt, full.finishedAt ?? null,
        );
    } else {
      this.mem.experiments.set(full.id, full);
    }
    return full;
  }

  getExperiment(id: string): BrainExperiment | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM experiments WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToExperiment(r) : undefined;
    }
    return this.mem.experiments.get(id);
  }

  listExperiments(limit = 40): BrainExperiment[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM experiments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToExperiment);
    }
    return [...this.mem.experiments.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  addEvaluation(input: Omit<BrainEvaluation, 'id' | 'userId' | 'createdAt'>, now = Date.now()): BrainEvaluation {
    const full: BrainEvaluation = {
      id: `eval_${randomId()}`,
      userId: this.userId,
      experimentId: input.experimentId,
      label: input.label,
      metrics: input.metrics,
      notes: input.notes,
      createdAt: now,
    };
    if (this.db) {
      this.db
        .prepare('INSERT INTO evaluations (id, user_id, experiment_id, label, metrics, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(full.id, full.userId, full.experimentId, full.label, JSON.stringify(full.metrics), full.notes ?? null, full.createdAt);
    } else {
      this.mem.evaluations.set(full.id, full);
    }
    return full;
  }

  listEvaluations(experimentId: string): BrainEvaluation[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM evaluations WHERE user_id = ? AND experiment_id = ? ORDER BY created_at DESC')
        .all(this.userId, experimentId)
        .map(rowToEvaluation);
    }
    return [...this.mem.evaluations.values()].filter((e) => e.experimentId === experimentId).sort((a, b) => b.createdAt - a.createdAt);
  }

  addActivity(ev: Omit<BrainActivityEvent, 'id'> & { id?: string }): BrainActivityEvent {
    const full: BrainActivityEvent = { id: ev.id ?? `act_${randomId()}`, ...ev };
    if (this.db) {
      this.db
        .prepare('INSERT INTO activity_log (id, user_id, ts, kind, message, refs, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(full.id, this.userId, full.ts, full.kind, full.message, full.refs ? JSON.stringify(full.refs) : null, full.projectId ?? null);
    } else {
      this.mem.activity.push(full);
      if (this.mem.activity.length > 2000) {
        this.mem.activity = this.mem.activity.slice(-1500);
      }
    }
    return full;
  }

  recentActivity(limit = 50): BrainActivityEvent[] {
    if (this.db) {
      return this.db
        .prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY ts DESC LIMIT ?')
        .all(this.userId, limit)
        .map(rowToActivity);
    }
    return [...this.mem.activity].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  getEpisode(id: string): BrainEpisode | undefined {
    if (this.db) {
      const r = this.db.prepare('SELECT * FROM episodes WHERE id = ? AND user_id = ?').get(id, this.userId);
      return r ? rowToEpisode(r) : undefined;
    }
    return this.mem.episodes.find((e) => e.id === id);
  }

  flushJsonFallback(): void {
    if (this.db || !this.jsonPath) {
      return;
    }
    mkdirSync(dirname(this.jsonPath!), { recursive: true });
    writeFileSync(
      this.jsonPath,
      JSON.stringify({
        entities: [...this.mem.entities.values()],
        rels: [...this.mem.rels.values()],
        episodes: this.mem.episodes,
        procedures: [...this.mem.procedures.values()],
        insights: [...this.mem.insights.values()],
        hypotheses: [...this.mem.hypotheses.values()],
        policies: [...this.mem.policies.values()],
        experiments: [...this.mem.experiments.values()],
        evaluations: [...this.mem.evaluations.values()],
        activity: this.mem.activity,
        kv: Object.fromEntries(this.memKv),
      }),
    );
  }

  close(): void {
    this.flushJsonFallback();
    this.db?.close();
  }
}

function rowToEpisode(r: Record<string, unknown>): BrainEpisode {
  const base: BrainEpisode = {
    id: String(r.id),
    userId: String(r.user_id),
    kind: String(r.kind) as BrainEpisode['kind'],
    summary: String(r.summary),
    projectId: r.project_id === null || r.project_id === undefined ? undefined : String(r.project_id),
    workspaceRoot: r.workspace_root === null || r.workspace_root === undefined ? undefined : String(r.workspace_root),
    entityIds: safeParseArray(String(r.entity_ids)),
    occurredAt: Number(r.occurred_at),
    sourceRef: r.source_ref === null || r.source_ref === undefined ? undefined : String(r.source_ref),
  };
  return enrichEpisodeRow(r, base);
}

function rowToSyncState(r: Record<string, unknown>): BrainSyncState {
  return {
    workspaceRoot: String(r.workspace_root),
    status: String(r.status) as BrainSyncState['status'],
    phase: String(r.phase),
    filesTotal: Number(r.files_total),
    filesDone: Number(r.files_done),
    startedAt: Number(r.started_at),
    updatedAt: Number(r.updated_at),
    finishedAt: r.finished_at === null || r.finished_at === undefined ? undefined : Number(r.finished_at),
    error: r.error === null || r.error === undefined ? undefined : String(r.error),
  };
}

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function normLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Float32 little-endian packing keeps embeddings compact in SQLite blobs. */
export function packEmbedding(v: number[]): Uint8Array {
  const buf = new ArrayBuffer(v.length * 4);
  const view = new DataView(buf);
  v.forEach((x, i) => view.setFloat32(i * 4, x, true));
  return new Uint8Array(buf);
}

export function unpackEmbedding(buf: Uint8Array): number[] | undefined {
  if (!buf || buf.byteLength < 4) {
    return undefined;
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = Math.floor(buf.byteLength / 4);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(view.getFloat32(i * 4, true));
  }
  return out;
}

function mergeEmbedding(prev: number[] | undefined, next: number[] | undefined): number[] | undefined {
  return next ?? prev;
}
