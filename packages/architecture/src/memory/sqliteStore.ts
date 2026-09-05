import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Adr, AdrStatus } from '../domain/adr/schema.js';
import { parseAdr } from '../domain/adr/schema.js';
import type { DomainEvent } from '../events/types.js';
import type {
  DecisionStore,
  Observation,
  StoredConflict,
  StoredCorrelation,
  StoredDebugContext,
  StoredDrift,
  StoredEvolution,
  StoredProductionEvent,
} from './decisionStore.js';
import type { StoredImpactAnalysis } from '../impact/types.js';
import type { StoredRiskAssessment } from '../risk/types.js';

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
CREATE TABLE IF NOT EXISTS architecture_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  json TEXT NOT NULL,
  status TEXT NOT NULL,
  record_kind TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_decision_versions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE TABLE IF NOT EXISTS architecture_alternatives (
  adr_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS architecture_constraints (
  adr_id TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_consequences (
  adr_id TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_evidence (
  adr_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  relationship TEXT
);
CREATE TABLE IF NOT EXISTS architecture_relationships (
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_validations (
  adr_id TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS architecture_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  adr_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_drifts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  adr_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  files TEXT NOT NULL,
  created_at TEXT NOT NULL,
  extra TEXT
);
CREATE TABLE IF NOT EXISTS architecture_evolution (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  old_adr_id TEXT NOT NULL,
  proposed_adr_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  trigger TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_embeddings (
  adr_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_production_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  received_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_correlations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  confidence REAL NOT NULL,
  reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_debug_contexts (
  incident_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_impact_analyses (
  analysis_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  severity TEXT,
  recommendation TEXT,
  confidence REAL,
  error TEXT,
  trace_id TEXT,
  analysis_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architecture_risk_assessments (
  assessment_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  mission_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  assessment_status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  risk_score REAL,
  risk_level TEXT,
  confidence REAL,
  source_versions TEXT,
  error TEXT,
  trace_id TEXT,
  assessment_version INTEGER NOT NULL,
  outcome_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_mission ON architecture_risk_assessments (project_id, mission_id, created_at);
`;

function persistNormalized(db: SqlDb, adr: Adr): void {
  db.prepare(`DELETE FROM architecture_alternatives WHERE adr_id = ?`).run(adr.id);
  db.prepare(`DELETE FROM architecture_constraints WHERE adr_id = ?`).run(adr.id);
  db.prepare(`DELETE FROM architecture_consequences WHERE adr_id = ?`).run(adr.id);
  db.prepare(`DELETE FROM architecture_evidence WHERE adr_id = ?`).run(adr.id);
  db.prepare(`DELETE FROM architecture_validations WHERE adr_id = ?`).run(adr.id);
  for (const a of adr.alternatives) {
    db.prepare(
      `INSERT INTO architecture_alternatives (adr_id, name, status, reason) VALUES (?,?,?,?)`,
    ).run(adr.id, a.name, a.status, a.reason);
  }
  for (const c of adr.constraints) {
    db.prepare(`INSERT INTO architecture_constraints (adr_id, text) VALUES (?,?)`).run(adr.id, c);
  }
  for (const c of adr.consequences) {
    db.prepare(`INSERT INTO architecture_consequences (adr_id, text) VALUES (?,?)`).run(adr.id, c);
  }
  const allEvidence = [
    ...adr.evidence.commits,
    ...adr.evidence.pull_requests,
    ...adr.evidence.tests,
    ...adr.evidence.documents,
    ...adr.evidence.conversations,
    ...adr.evidence.code,
    ...(adr.evidence.incidents ?? []),
    ...(adr.evidence.deployments ?? []),
    ...(adr.evidence.metrics ?? []),
  ];
  for (const e of allEvidence) {
    db.prepare(
      `INSERT INTO architecture_evidence (adr_id, type, ref_id, relationship) VALUES (?,?,?,?)`,
    ).run(adr.id, e.type, e.id, e.relationship);
  }
  db.prepare(`INSERT INTO architecture_validations (adr_id, status, notes) VALUES (?,?,?)`).run(
    adr.id,
    adr.validation.status,
    adr.validation.notes ?? null,
  );
  if (adr.relationships.supersedes) {
    db.prepare(
      `INSERT INTO architecture_relationships (from_id, to_id, kind) VALUES (?,?,?)`,
    ).run(adr.id, adr.relationships.supersedes, 'SUPERSEDES');
  }
}

function driftExtra(d: StoredDrift): string {
  return JSON.stringify({
    status: d.status ?? 'open',
    confidence: d.confidence,
    declared: d.declared,
    observed: d.observed,
    affected_nodes: d.affected_nodes,
  });
}

function parseStoredDrift(r: Record<string, unknown>): StoredDrift {
  let extra: Record<string, unknown> = {};
  try {
    extra = r.extra ? (JSON.parse(String(r.extra)) as Record<string, unknown>) : {};
  } catch {
    extra = {};
  }
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    adr_id: String(r.adr_id),
    severity: r.severity as StoredDrift['severity'],
    kind: r.kind as StoredDrift['kind'],
    reason: String(r.reason),
    files: JSON.parse(String(r.files || '[]')) as string[],
    created_at: String(r.created_at),
    status: (extra.status as StoredDrift['status']) ?? 'open',
    confidence: typeof extra.confidence === 'number' ? extra.confidence : undefined,
    declared: extra.declared,
    observed: extra.observed,
    affected_nodes: Array.isArray(extra.affected_nodes)
      ? (extra.affected_nodes as string[])
      : undefined,
  };
}

export class MemoryDecisionStore implements DecisionStore {
  private adrs = new Map<string, Adr>();
  private hist = new Map<string, Adr[]>();
  private observations: Observation[] = [];
  private conflicts: StoredConflict[] = [];
  private drifts: StoredDrift[] = [];
  private evolutions: StoredEvolution[] = [];
  private embeddings = new Map<string, { embedding: number[]; text: string; project_id: string }>();
  private outbox: DomainEvent[] = [];
  private kv = new Map<string, string>();
  private productionEvents = new Map<string, StoredProductionEvent>();
  private productionByKey = new Map<string, string>();
  private correlations: StoredCorrelation[] = [];
  private debugContexts = new Map<string, StoredDebugContext>();
  private impacts = new Map<string, StoredImpactAnalysis>();
  private impactsByFp = new Map<string, string>();
  private risks = new Map<string, StoredRiskAssessment>();
  private risksByFp = new Map<string, string>();
  private seq = 0;

  nextAdrId(projectId: string): string {
    const n = this.list({ project_id: projectId }).length + 1;
    return `ADR-${String(n).padStart(4, '0')}`;
  }

  insert(adr: Adr): Adr {
    this.adrs.set(adr.id, adr);
    const h = this.hist.get(adr.id) ?? [];
    h.push(adr);
    this.hist.set(adr.id, h);
    return adr;
  }

  update(adr: Adr): Adr {
    return this.insert(adr);
  }

  get(id: string): Adr | undefined {
    return this.adrs.get(id);
  }

  list(opts?: {
    project_id?: string;
    status?: AdrStatus | AdrStatus[];
    record_kind?: Adr['record_kind'];
  }): Adr[] {
    let rows = [...this.adrs.values()];
    if (opts?.project_id) {
      rows = rows.filter((a) => a.project_id === opts.project_id);
    }
    if (opts?.status) {
      const set = new Set(Array.isArray(opts.status) ? opts.status : [opts.status]);
      rows = rows.filter((a) => set.has(a.status));
    }
    if (opts?.record_kind) {
      rows = rows.filter((a) => a.record_kind === opts.record_kind);
    }
    return rows;
  }

  versions(id: string): Adr[] {
    return this.hist.get(id) ?? [];
  }

  insertObservation(obs: Observation): void {
    this.observations.push(obs);
  }

  listObservations(projectId: string): Observation[] {
    return this.observations.filter((o) => o.project_id === projectId);
  }

  insertConflict(c: StoredConflict): void {
    this.conflicts.push(c);
  }

  listConflicts(projectId: string): StoredConflict[] {
    return this.conflicts.filter((c) => c.project_id === projectId);
  }

  insertDrift(d: StoredDrift): void {
    const row = { status: 'open' as const, ...d };
    this.drifts = this.drifts.filter((x) => x.id !== d.id);
    this.drifts.push(row);
  }

  listDrifts(projectId: string): StoredDrift[] {
    return this.drifts.filter((d) => d.project_id === projectId);
  }

  getDrift(id: string): StoredDrift | undefined {
    return this.drifts.find((d) => d.id === id);
  }

  updateDrift(d: StoredDrift): void {
    this.insertDrift(d);
  }

  insertEvolution(e: StoredEvolution): void {
    this.evolutions = this.evolutions.filter((x) => x.id !== e.id);
    this.evolutions.push(e);
  }

  listEvolutions(projectId: string): StoredEvolution[] {
    return this.evolutions.filter((e) => e.project_id === projectId);
  }

  upsertEmbedding(adrId: string, embedding: number[], text: string): void {
    const adr = this.adrs.get(adrId);
    this.embeddings.set(adrId, {
      embedding,
      text,
      project_id: adr?.project_id ?? 'default',
    });
  }

  getEmbedding(adrId: string): { embedding: number[]; text: string } | undefined {
    const row = this.embeddings.get(adrId);
    return row ? { embedding: row.embedding, text: row.text } : undefined;
  }

  listEmbeddings(projectId: string): Array<{ adr_id: string; embedding: number[]; text: string }> {
    const out: Array<{ adr_id: string; embedding: number[]; text: string }> = [];
    for (const [id, row] of this.embeddings) {
      if (row.project_id === projectId) {
        out.push({ adr_id: id, embedding: row.embedding, text: row.text });
      }
    }
    return out;
  }

  enqueueOutbox(event: DomainEvent): void {
    this.outbox.push(event);
    this.seq += 1;
  }

  drainOutbox(limit = 32): DomainEvent[] {
    return this.outbox.splice(0, limit);
  }

  getKv(key: string): string | undefined {
    return this.kv.get(key);
  }

  setKv(key: string, value: string): void {
    this.kv.set(key, value);
  }

  upsertProductionEvent(row: StoredProductionEvent): void {
    this.productionEvents.set(row.event_id, row);
    this.productionByKey.set(row.idempotency_key, row.event_id);
  }

  getProductionEvent(eventId: string): StoredProductionEvent | undefined {
    return this.productionEvents.get(eventId);
  }

  getProductionEventByIdempotency(key: string): StoredProductionEvent | undefined {
    const id = this.productionByKey.get(key);
    return id ? this.productionEvents.get(id) : undefined;
  }

  pruneProductionEvents(beforeIso: string): number {
    let n = 0;
    for (const [id, row] of this.productionEvents) {
      if (row.received_at < beforeIso) {
        this.productionEvents.delete(id);
        this.productionByKey.delete(row.idempotency_key);
        n += 1;
      }
    }
    return n;
  }

  insertCorrelation(row: StoredCorrelation): void {
    this.correlations = this.correlations.filter((c) => c.id !== row.id);
    this.correlations.push(row);
  }

  listCorrelations(projectId: string, eventId?: string): StoredCorrelation[] {
    return this.correlations.filter(
      (c) => c.project_id === projectId && (!eventId || c.event_id === eventId),
    );
  }

  getCorrelation(id: string): StoredCorrelation | undefined {
    return this.correlations.find((c) => c.id === id);
  }

  upsertDebugContext(row: StoredDebugContext): void {
    this.debugContexts.set(row.incident_id, row);
  }

  getDebugContext(incidentId: string): StoredDebugContext | undefined {
    return this.debugContexts.get(incidentId);
  }

  upsertImpactAnalysis(row: StoredImpactAnalysis): void {
    this.impacts.set(row.analysis_id, row);
    this.impactsByFp.set(row.fingerprint, row.analysis_id);
  }

  getImpactAnalysis(id: string): StoredImpactAnalysis | undefined {
    return this.impacts.get(id);
  }

  getImpactByFingerprint(fingerprint: string): StoredImpactAnalysis | undefined {
    const id = this.impactsByFp.get(fingerprint);
    return id ? this.impacts.get(id) : undefined;
  }

  listImpactAnalyses(projectId: string, limit = 50): StoredImpactAnalysis[] {
    return [...this.impacts.values()]
      .filter((r) => r.project_id === projectId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);
  }

  listProductionEvents(projectId: string, limit = 200): StoredProductionEvent[] {
    return [...this.productionEvents.values()]
      .filter((r) => r.project_id === projectId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit);
  }

  upsertRiskAssessment(row: StoredRiskAssessment): void {
    this.risks.set(row.assessment_id, row);
    this.risksByFp.set(row.fingerprint, row.assessment_id);
  }

  getRiskAssessment(id: string): StoredRiskAssessment | undefined {
    return this.risks.get(id);
  }

  getRiskByFingerprint(fingerprint: string): StoredRiskAssessment | undefined {
    const id = this.risksByFp.get(fingerprint);
    return id ? this.risks.get(id) : undefined;
  }

  listRiskAssessments(projectId: string, limit = 50): StoredRiskAssessment[] {
    return [...this.risks.values()]
      .filter((r) => r.project_id === projectId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, limit);
  }

  listRiskByMission(projectId: string, missionId: string, limit = 50): StoredRiskAssessment[] {
    return this.listRiskAssessments(projectId, 200)
      .filter((r) => r.mission_id === missionId)
      .slice(0, limit);
  }

  close(): void {
    /* noop */
  }
}

export class SqliteDecisionStore implements DecisionStore {
  private readonly db: SqlDb;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    const opened = tryOpenSqlite(dbPath);
    if (!opened) {
      throw new Error('node:sqlite unavailable');
    }
    this.db = opened;
    this.db.exec(SCHEMA);
    try {
      this.db.exec(`ALTER TABLE architecture_drifts ADD COLUMN extra TEXT`);
    } catch {
      /* already present */
    }
  }

  nextAdrId(projectId: string): string {
    const rows = this.list({ project_id: projectId });
    const max = rows.reduce((m, a) => {
      const n = Number(/ADR-(\d+)/.exec(a.id)?.[1] ?? 0);
      return Math.max(m, n);
    }, 0);
    return `ADR-${String(max + 1).padStart(4, '0')}`;
  }

  insert(adr: Adr): Adr {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_decisions (id, project_id, json, status, record_kind, updated_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(adr.id, adr.project_id, JSON.stringify(adr), adr.status, adr.record_kind, adr.timestamps.updated_at);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_decision_versions (id, version, json, created_at) VALUES (?,?,?,?)`,
      )
      .run(adr.id, adr.version, JSON.stringify(adr), adr.timestamps.updated_at);
    persistNormalized(this.db, adr);
    return adr;
  }

  update(adr: Adr): Adr {
    return this.insert(adr);
  }

  get(id: string): Adr | undefined {
    const row = this.db.prepare(`SELECT json FROM architecture_decisions WHERE id = ?`).get(id);
    if (!row?.json) {
      return undefined;
    }
    return parseAdr(JSON.parse(String(row.json)));
  }

  list(opts?: {
    project_id?: string;
    status?: AdrStatus | AdrStatus[];
    record_kind?: Adr['record_kind'];
  }): Adr[] {
    let sql = `SELECT json FROM architecture_decisions WHERE 1=1`;
    const params: unknown[] = [];
    if (opts?.project_id) {
      sql += ` AND project_id = ?`;
      params.push(opts.project_id);
    }
    const rows = this.db.prepare(sql).all(...params);
    let adrs = rows.map((r) => parseAdr(JSON.parse(String(r.json))));
    if (opts?.status) {
      const set = new Set(Array.isArray(opts.status) ? opts.status : [opts.status]);
      adrs = adrs.filter((a) => set.has(a.status));
    }
    if (opts?.record_kind) {
      adrs = adrs.filter((a) => a.record_kind === opts.record_kind);
    }
    return adrs;
  }

  versions(id: string): Adr[] {
    const rows = this.db
      .prepare(`SELECT json FROM architecture_decision_versions WHERE id = ? ORDER BY version`)
      .all(id);
    return rows.map((r) => parseAdr(JSON.parse(String(r.json))));
  }

  insertObservation(obs: Observation): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_observations (id, project_id, text, confidence, source, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(obs.id, obs.project_id, obs.text, obs.confidence, obs.source ?? null, obs.created_at);
  }

  listObservations(projectId: string): Observation[] {
    return this.db
      .prepare(`SELECT * FROM architecture_observations WHERE project_id = ?`)
      .all(projectId)
      .map((r) => ({
        id: String(r.id),
        project_id: String(r.project_id),
        text: String(r.text),
        confidence: Number(r.confidence),
        source: r.source ? String(r.source) : undefined,
        created_at: String(r.created_at),
      }));
  }

  insertConflict(c: StoredConflict): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_conflicts (id, project_id, adr_id, severity, reason, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(c.id, c.project_id, c.adr_id, c.severity, c.reason, c.created_at);
  }

  listConflicts(projectId: string): StoredConflict[] {
    return this.db
      .prepare(`SELECT * FROM architecture_conflicts WHERE project_id = ?`)
      .all(projectId)
      .map((r) => ({
        id: String(r.id),
        project_id: String(r.project_id),
        adr_id: String(r.adr_id),
        severity: r.severity as StoredConflict['severity'],
        reason: String(r.reason),
        created_at: String(r.created_at),
      }));
  }

  insertDrift(d: StoredDrift): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_drifts
         (id, project_id, adr_id, severity, kind, reason, files, created_at, extra)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        d.id,
        d.project_id,
        d.adr_id,
        d.severity,
        d.kind,
        d.reason,
        JSON.stringify(d.files),
        d.created_at,
        driftExtra(d),
      );
  }

  listDrifts(projectId: string): StoredDrift[] {
    return this.db
      .prepare(`SELECT * FROM architecture_drifts WHERE project_id = ?`)
      .all(projectId)
      .map((r) => parseStoredDrift(r));
  }

  getDrift(id: string): StoredDrift | undefined {
    const row = this.db.prepare(`SELECT * FROM architecture_drifts WHERE id = ?`).get(id);
    return row ? parseStoredDrift(row) : undefined;
  }

  updateDrift(d: StoredDrift): void {
    this.insertDrift(d);
  }

  insertEvolution(e: StoredEvolution): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_evolution
         (id, project_id, old_adr_id, proposed_adr_id, reason, trigger, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        e.id,
        e.project_id,
        e.old_adr_id,
        e.proposed_adr_id,
        e.reason,
        e.trigger,
        e.created_at,
      );
  }

  listEvolutions(projectId: string): StoredEvolution[] {
    return this.db
      .prepare(`SELECT * FROM architecture_evolution WHERE project_id = ?`)
      .all(projectId)
      .map((r) => ({
        id: String(r.id),
        project_id: String(r.project_id),
        old_adr_id: String(r.old_adr_id),
        proposed_adr_id: String(r.proposed_adr_id),
        reason: String(r.reason),
        trigger: r.trigger as StoredEvolution['trigger'],
        created_at: String(r.created_at),
      }));
  }

  upsertEmbedding(adrId: string, embedding: number[], text: string): void {
    const adr = this.get(adrId);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_embeddings (adr_id, project_id, embedding, text) VALUES (?,?,?,?)`,
      )
      .run(adrId, adr?.project_id ?? 'default', JSON.stringify(embedding), text);
  }

  getEmbedding(adrId: string): { embedding: number[]; text: string } | undefined {
    const row = this.db
      .prepare(`SELECT embedding, text FROM architecture_embeddings WHERE adr_id = ?`)
      .get(adrId);
    if (!row) {
      return undefined;
    }
    return {
      embedding: JSON.parse(String(row.embedding)) as number[],
      text: String(row.text),
    };
  }

  listEmbeddings(projectId: string): Array<{ adr_id: string; embedding: number[]; text: string }> {
    return this.db
      .prepare(`SELECT adr_id, embedding, text FROM architecture_embeddings WHERE project_id = ?`)
      .all(projectId)
      .map((r) => ({
        adr_id: String(r.adr_id),
        embedding: JSON.parse(String(r.embedding)) as number[],
        text: String(r.text),
      }));
  }

  enqueueOutbox(event: DomainEvent): void {
    this.db.prepare(`INSERT INTO architecture_outbox (json) VALUES (?)`).run(JSON.stringify(event));
  }

  drainOutbox(limit = 32): DomainEvent[] {
    const rows = this.db
      .prepare(`SELECT seq, json FROM architecture_outbox ORDER BY seq LIMIT ?`)
      .all(limit);
    const ids = rows.map((r) => Number(r.seq));
    if (ids.length) {
      this.db
        .prepare(`DELETE FROM architecture_outbox WHERE seq IN (${ids.map(() => '?').join(',')})`)
        .run(...ids);
    }
    return rows.map((r) => JSON.parse(String(r.json)) as DomainEvent);
  }

  getKv(key: string): string | undefined {
    const row = this.db.prepare(`SELECT value FROM architecture_kv WHERE key = ?`).get(key);
    return row?.value != null ? String(row.value) : undefined;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO architecture_kv (key, value) VALUES (?,?)`)
      .run(key, value);
  }

  upsertProductionEvent(row: StoredProductionEvent): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_production_events
         (event_id, project_id, idempotency_key, event_type, timestamp, received_at, json)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        row.event_id,
        row.project_id,
        row.idempotency_key,
        row.event_type,
        row.timestamp,
        row.received_at,
        row.json,
      );
  }

  getProductionEvent(eventId: string): StoredProductionEvent | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_production_events WHERE event_id = ?`)
      .get(eventId);
    return row ? mapProductionEvent(row) : undefined;
  }

  getProductionEventByIdempotency(key: string): StoredProductionEvent | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_production_events WHERE idempotency_key = ?`)
      .get(key);
    return row ? mapProductionEvent(row) : undefined;
  }

  pruneProductionEvents(beforeIso: string): number {
    const rows = this.db
      .prepare(`SELECT event_id FROM architecture_production_events WHERE received_at < ?`)
      .all(beforeIso);
    this.db
      .prepare(`DELETE FROM architecture_production_events WHERE received_at < ?`)
      .run(beforeIso);
    return rows.length;
  }

  insertCorrelation(row: StoredCorrelation): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_correlations
         (id, project_id, event_id, target_type, target_id, rel, confidence, reasons_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.project_id,
        row.event_id,
        row.target_type,
        row.target_id,
        row.rel,
        row.confidence,
        JSON.stringify(row.reasons),
        row.created_at,
      );
  }

  listCorrelations(projectId: string, eventId?: string): StoredCorrelation[] {
    const rows = eventId
      ? this.db
          .prepare(
            `SELECT * FROM architecture_correlations WHERE project_id = ? AND event_id = ?`,
          )
          .all(projectId, eventId)
      : this.db
          .prepare(`SELECT * FROM architecture_correlations WHERE project_id = ?`)
          .all(projectId);
    return rows.map(mapCorrelation);
  }

  getCorrelation(id: string): StoredCorrelation | undefined {
    const row = this.db.prepare(`SELECT * FROM architecture_correlations WHERE id = ?`).get(id);
    return row ? mapCorrelation(row) : undefined;
  }

  upsertDebugContext(row: StoredDebugContext): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_debug_contexts (incident_id, project_id, json, updated_at)
         VALUES (?,?,?,?)`,
      )
      .run(row.incident_id, row.project_id, row.json, row.updated_at);
  }

  getDebugContext(incidentId: string): StoredDebugContext | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_debug_contexts WHERE incident_id = ?`)
      .get(incidentId);
    if (!row) {
      return undefined;
    }
    return {
      incident_id: String(row.incident_id),
      project_id: String(row.project_id),
      json: String(row.json),
      updated_at: String(row.updated_at),
    };
  }

  upsertImpactAnalysis(row: StoredImpactAnalysis): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_impact_analyses
         (analysis_id, fingerprint, project_id, status, request_json, result_json, severity,
          recommendation, confidence, error, trace_id, analysis_version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.analysis_id,
        row.fingerprint,
        row.project_id,
        row.status,
        row.request_json,
        row.result_json,
        row.severity ?? null,
        row.recommendation ?? null,
        row.confidence ?? null,
        row.error ?? null,
        row.trace_id ?? null,
        row.analysis_version,
        row.created_at,
        row.updated_at,
      );
  }

  getImpactAnalysis(id: string): StoredImpactAnalysis | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_impact_analyses WHERE analysis_id = ?`)
      .get(id);
    return row ? mapImpact(row) : undefined;
  }

  getImpactByFingerprint(fingerprint: string): StoredImpactAnalysis | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_impact_analyses WHERE fingerprint = ?`)
      .get(fingerprint);
    return row ? mapImpact(row) : undefined;
  }

  listImpactAnalyses(projectId: string, limit = 50): StoredImpactAnalysis[] {
    return this.db
      .prepare(
        `SELECT * FROM architecture_impact_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit)
      .map(mapImpact);
  }

  listProductionEvents(projectId: string, limit = 200): StoredProductionEvent[] {
    return this.db
      .prepare(
        `SELECT * FROM architecture_production_events WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(projectId, limit)
      .map(mapProductionEvent);
  }

  upsertRiskAssessment(row: StoredRiskAssessment): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO architecture_risk_assessments
         (assessment_id, fingerprint, mission_id, project_id, status, assessment_status,
          request_json, result_json, risk_score, risk_level, confidence, source_versions,
          error, trace_id, assessment_version, outcome_json, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.assessment_id,
        row.fingerprint,
        row.mission_id,
        row.project_id,
        row.status,
        row.assessment_status,
        row.request_json,
        row.result_json,
        row.risk_score ?? null,
        row.risk_level ?? null,
        row.confidence ?? null,
        row.source_versions ?? null,
        row.error ?? null,
        row.trace_id ?? null,
        row.assessment_version,
        row.outcome_json ?? null,
        row.created_at,
        row.updated_at,
      );
  }

  getRiskAssessment(id: string): StoredRiskAssessment | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_risk_assessments WHERE assessment_id = ?`)
      .get(id);
    return row ? mapRisk(row) : undefined;
  }

  getRiskByFingerprint(fingerprint: string): StoredRiskAssessment | undefined {
    const row = this.db
      .prepare(`SELECT * FROM architecture_risk_assessments WHERE fingerprint = ?`)
      .get(fingerprint);
    return row ? mapRisk(row) : undefined;
  }

  listRiskAssessments(projectId: string, limit = 50): StoredRiskAssessment[] {
    return this.db
      .prepare(
        `SELECT * FROM architecture_risk_assessments WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit)
      .map(mapRisk);
  }

  listRiskByMission(projectId: string, missionId: string, limit = 50): StoredRiskAssessment[] {
    return this.db
      .prepare(
        `SELECT * FROM architecture_risk_assessments WHERE project_id = ? AND mission_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, missionId, limit)
      .map(mapRisk);
  }

  close(): void {
    this.db.close();
  }
}

function mapProductionEvent(r: Record<string, unknown>): StoredProductionEvent {
  return {
    event_id: String(r.event_id),
    project_id: String(r.project_id),
    idempotency_key: String(r.idempotency_key),
    event_type: String(r.event_type),
    timestamp: String(r.timestamp),
    received_at: String(r.received_at),
    json: String(r.json),
  };
}

function mapCorrelation(r: Record<string, unknown>): StoredCorrelation {
  return {
    id: String(r.id),
    project_id: String(r.project_id),
    event_id: String(r.event_id),
    target_type: String(r.target_type),
    target_id: String(r.target_id),
    rel: String(r.rel),
    confidence: Number(r.confidence),
    reasons: JSON.parse(String(r.reasons_json || '[]')) as string[],
    created_at: String(r.created_at),
  };
}

function mapImpact(r: Record<string, unknown>): StoredImpactAnalysis {
  return {
    analysis_id: String(r.analysis_id),
    fingerprint: String(r.fingerprint),
    project_id: String(r.project_id),
    status: String(r.status) as StoredImpactAnalysis['status'],
    request_json: String(r.request_json),
    result_json: String(r.result_json),
    severity: r.severity != null ? String(r.severity) : undefined,
    recommendation: r.recommendation != null ? String(r.recommendation) : undefined,
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
    error: r.error != null ? String(r.error) : undefined,
    trace_id: r.trace_id != null ? String(r.trace_id) : undefined,
    analysis_version: Number(r.analysis_version),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function mapRisk(r: Record<string, unknown>): StoredRiskAssessment {
  return {
    assessment_id: String(r.assessment_id),
    fingerprint: String(r.fingerprint),
    mission_id: String(r.mission_id),
    project_id: String(r.project_id),
    status: String(r.status) as StoredRiskAssessment['status'],
    assessment_status: String(r.assessment_status) as StoredRiskAssessment['assessment_status'],
    request_json: String(r.request_json),
    result_json: String(r.result_json),
    risk_score: r.risk_score != null ? Number(r.risk_score) : undefined,
    risk_level: r.risk_level != null ? String(r.risk_level) : undefined,
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
    source_versions: r.source_versions != null ? String(r.source_versions) : undefined,
    error: r.error != null ? String(r.error) : undefined,
    trace_id: r.trace_id != null ? String(r.trace_id) : undefined,
    assessment_version: Number(r.assessment_version),
    outcome_json: r.outcome_json != null ? String(r.outcome_json) : undefined,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function openDecisionStore(dbPath: string): DecisionStore {
  try {
    return new SqliteDecisionStore(dbPath);
  } catch {
    return new MemoryDecisionStore();
  }
}

export type { DecisionStore } from './decisionStore.js';
