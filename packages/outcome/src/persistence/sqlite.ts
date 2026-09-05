import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AcceptanceCriterion,
  Evidence,
  HumanReview,
  HumanReviewEvent,
  Mission,
  MissionOutcome,
  Objective,
  OutcomeRequirement,
  Remediation,
  ReviewEvidencePackage,
  ReviewPolicyRule,
  VerificationPlan,
  VerificationRun,
} from '../domain/types.js';
import {
  AcceptanceCriterionSchema,
  EvidenceSchema,
  HumanReviewEventSchema,
  HumanReviewSchema,
  MissionOutcomeSchema,
  MissionSchema,
  ObjectiveSchema,
  OutcomeRequirementSchema,
  RemediationSchema,
  ReviewEvidencePackageSchema,
  ReviewPolicyRuleSchema,
  VerificationPlanSchema,
  VerificationRunSchema,
} from '../domain/types.js';
import type { OutcomeStore } from './store.js';
import { MemoryOutcomeStore } from './memoryStore.js';

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
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  json TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  json TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_plans (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  idempotency_key TEXT,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  verification_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outcomes (
  mission_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS remediations (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_events (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS human_reviews (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS human_review_events (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_evidence_packages (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_policies (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
`;

function parseJson<T>(row: Record<string, unknown> | undefined, schema: { parse: (v: unknown) => T }): T | undefined {
  if (!row?.json) {
    return undefined;
  }
  try {
    return schema.parse(JSON.parse(String(row.json)));
  } catch {
    return undefined;
  }
}

/** Hot-path read: data is written by this store — skip Zod on list queries. */
function parseStoredJson<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row?.json) {
    return undefined;
  }
  try {
    return JSON.parse(String(row.json)) as T;
  } catch {
    return undefined;
  }
}

export class SqliteOutcomeStore implements OutcomeStore {
  private reviewsByMission = new Map<string, HumanReview[]>();
  private openReviewsCache?: HumanReview[];

  constructor(private readonly db: SqlDb) {
    db.exec(SCHEMA);
  }

  private invalidateReviewCache(missionId?: string): void {
    if (missionId) {
      this.reviewsByMission.delete(missionId);
    } else {
      this.reviewsByMission.clear();
    }
    this.openReviewsCache = undefined;
  }

  upsertMission(m: Mission): void {
    this.db
      .prepare(
        `INSERT INTO missions (id, mission_id, project_id, json, status, updated_at)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json, status=excluded.status, updated_at=excluded.updated_at`,
      )
      .run(m.id, m.mission_id, m.project_id, JSON.stringify(m), m.status, m.updated_at);
  }
  getMission(id: string): Mission | undefined {
    return parseJson(this.db.prepare(`SELECT json FROM missions WHERE id = ?`).get(id), MissionSchema);
  }
  listMissions(projectId: string): Mission[] {
    return this.db
      .prepare(`SELECT json FROM missions WHERE project_id = ?`)
      .all(projectId)
      .map((r) => parseJson(r, MissionSchema))
      .filter((x): x is Mission => !!x);
  }
  activeMissions(projectId: string): Mission[] {
    return this.listMissions(projectId).filter(
      (m) => m.status !== 'ACHIEVED' && m.lifecycle !== 'ACHIEVED',
    );
  }

  upsertObjective(o: Objective): void {
    this.db
      .prepare(
        `INSERT INTO objectives (id, mission_id, json) VALUES (?,?,?)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
      )
      .run(o.id, o.mission_id, JSON.stringify(o));
  }
  listObjectives(missionId: string): Objective[] {
    return this.db
      .prepare(`SELECT json FROM objectives WHERE mission_id = ?`)
      .all(missionId)
      .map((r) => parseJson(r, ObjectiveSchema))
      .filter((x): x is Objective => !!x);
  }

  upsertRequirement(r: OutcomeRequirement): void {
    this.db
      .prepare(
        `INSERT INTO requirements (id, mission_id, json, status) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json, status=excluded.status`,
      )
      .run(r.id, r.mission_id, JSON.stringify(r), r.status);
  }
  getRequirement(id: string): OutcomeRequirement | undefined {
    return parseJson(
      this.db.prepare(`SELECT json FROM requirements WHERE id = ?`).get(id),
      OutcomeRequirementSchema,
    );
  }
  listRequirements(missionId: string): OutcomeRequirement[] {
    return this.db
      .prepare(`SELECT json FROM requirements WHERE mission_id = ?`)
      .all(missionId)
      .map((r) => parseJson(r, OutcomeRequirementSchema))
      .filter((x): x is OutcomeRequirement => !!x);
  }

  upsertCriterion(c: AcceptanceCriterion): void {
    this.db
      .prepare(
        `INSERT INTO acceptance_criteria (id, mission_id, requirement_id, json) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
      )
      .run(c.id, c.mission_id, c.requirement_id, JSON.stringify(c));
  }
  getCriterion(id: string): AcceptanceCriterion | undefined {
    return parseJson(
      this.db.prepare(`SELECT json FROM acceptance_criteria WHERE id = ?`).get(id),
      AcceptanceCriterionSchema,
    );
  }
  listCriteria(requirementId: string): AcceptanceCriterion[] {
    return this.db
      .prepare(`SELECT json FROM acceptance_criteria WHERE requirement_id = ?`)
      .all(requirementId)
      .map((r) => parseJson(r, AcceptanceCriterionSchema))
      .filter((x): x is AcceptanceCriterion => !!x);
  }

  upsertPlan(p: VerificationPlan): void {
    this.db
      .prepare(
        `INSERT INTO verification_plans (id, mission_id, requirement_id, json) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
      )
      .run(p.id, p.mission_id, p.requirement_id, JSON.stringify(p));
  }
  getPlan(id: string): VerificationPlan | undefined {
    return parseJson(
      this.db.prepare(`SELECT json FROM verification_plans WHERE id = ?`).get(id),
      VerificationPlanSchema,
    );
  }
  listPlansForRequirement(requirementId: string): VerificationPlan[] {
    return this.db
      .prepare(`SELECT json FROM verification_plans WHERE requirement_id = ?`)
      .all(requirementId)
      .map((r) => parseJson(r, VerificationPlanSchema))
      .filter((x): x is VerificationPlan => !!x);
  }
  listPlansForMission(missionId: string): VerificationPlan[] {
    return this.db
      .prepare(`SELECT json FROM verification_plans WHERE mission_id = ?`)
      .all(missionId)
      .map((r) => parseJson(r, VerificationPlanSchema))
      .filter((x): x is VerificationPlan => !!x);
  }

  insertRun(r: VerificationRun): void {
    this.db
      .prepare(
        `INSERT INTO verification_runs (id, mission_id, idempotency_key, json) VALUES (?,?,?,?)`,
      )
      .run(r.id, r.mission_id, r.idempotency_key, JSON.stringify(r));
  }
  updateRun(r: VerificationRun): void {
    this.db
      .prepare(`UPDATE verification_runs SET json = ? WHERE id = ?`)
      .run(JSON.stringify(r), r.id);
  }
  getRun(id: string): VerificationRun | undefined {
    return parseJson(
      this.db.prepare(`SELECT json FROM verification_runs WHERE id = ?`).get(id),
      VerificationRunSchema,
    );
  }
  findRunByIdempotency(key: string): VerificationRun | undefined {
    const rows = this.db
      .prepare(`SELECT json FROM verification_runs WHERE idempotency_key = ?`)
      .all(key)
      .map((r) => parseJson(r, VerificationRunSchema))
      .filter((x): x is VerificationRun => !!x);
    return (
      rows.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ??
      rows[rows.length - 1]
    );
  }

  insertEvidence(e: Evidence): void {
    this.db
      .prepare(
        `INSERT INTO evidence (id, mission_id, requirement_id, verification_id, json, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(e.id, e.mission_id, e.requirement_id, e.verification_id, JSON.stringify(e), e.created_at);
  }
  listEvidenceForRequirement(requirementId: string): Evidence[] {
    return this.db
      .prepare(`SELECT json FROM evidence WHERE requirement_id = ?`)
      .all(requirementId)
      .map((r) => parseJson(r, EvidenceSchema))
      .filter((x): x is Evidence => !!x);
  }
  listEvidenceForRun(runId: string): Evidence[] {
    return this.db
      .prepare(`SELECT json FROM evidence WHERE verification_id = ?`)
      .all(runId)
      .map((r) => parseJson(r, EvidenceSchema))
      .filter((x): x is Evidence => !!x);
  }
  listEvidenceForMission(missionId: string): Evidence[] {
    return this.db
      .prepare(`SELECT json FROM evidence WHERE mission_id = ?`)
      .all(missionId)
      .map((r) => parseJson(r, EvidenceSchema))
      .filter((x): x is Evidence => !!x);
  }

  upsertReview(r: HumanReview): void {
    this.db
      .prepare(
        `INSERT INTO human_reviews (id, mission_id, status, fingerprint, json) VALUES (?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, fingerprint=excluded.fingerprint, json=excluded.json`,
      )
      .run(r.id, r.mission_id, r.status, r.fingerprint, JSON.stringify(r));
    this.invalidateReviewCache(r.mission_id);
  }
  getReview(id: string): HumanReview | undefined {
    return parseJson(this.db.prepare(`SELECT json FROM human_reviews WHERE id = ?`).get(id), HumanReviewSchema);
  }
  listReviews(missionId: string): HumanReview[] {
    const cached = this.reviewsByMission.get(missionId);
    if (cached) {
      return cached;
    }
    const reviews = this.db
      .prepare(`SELECT json FROM human_reviews WHERE mission_id = ?`)
      .all(missionId)
      .map((r) => parseStoredJson<HumanReview>(r))
      .filter((x): x is HumanReview => !!x);
    this.reviewsByMission.set(missionId, reviews);
    return reviews;
  }
  listOpenReviews(): HumanReview[] {
    if (this.openReviewsCache) {
      return this.openReviewsCache;
    }
    const reviews = this.db
      .prepare(`SELECT json FROM human_reviews WHERE status IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED')`)
      .all()
      .map((r) => parseStoredJson<HumanReview>(r))
      .filter((x): x is HumanReview => !!x);
    this.openReviewsCache = reviews;
    return reviews;
  }

  insertReviewEvent(e: HumanReviewEvent): void {
    this.db
      .prepare(
        `INSERT INTO human_review_events (id, review_id, mission_id, json, created_at) VALUES (?,?,?,?,?)`,
      )
      .run(e.id, e.review_id, e.mission_id, JSON.stringify(e), e.created_at);
  }
  listReviewEvents(reviewId: string): HumanReviewEvent[] {
    return this.db
      .prepare(`SELECT json FROM human_review_events WHERE review_id = ?`)
      .all(reviewId)
      .map((r) => parseJson(r, HumanReviewEventSchema))
      .filter((x): x is HumanReviewEvent => !!x);
  }

  insertEvidencePackage(p: ReviewEvidencePackage): void {
    this.db
      .prepare(
        `INSERT INTO review_evidence_packages (id, mission_id, json, created_at) VALUES (?,?,?,?)`,
      )
      .run(p.id, p.mission_id, JSON.stringify(p), p.created_at);
  }
  getEvidencePackage(id: string): ReviewEvidencePackage | undefined {
    return parseJson(
      this.db.prepare(`SELECT json FROM review_evidence_packages WHERE id = ?`).get(id),
      ReviewEvidencePackageSchema,
    );
  }

  upsertReviewPolicy(p: ReviewPolicyRule): void {
    this.db
      .prepare(
        `INSERT INTO review_policies (id, json) VALUES (?,?)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json`,
      )
      .run(p.id, JSON.stringify(p));
  }
  listReviewPolicies(): ReviewPolicyRule[] {
    return this.db
      .prepare(`SELECT json FROM review_policies`)
      .all()
      .map((r) => parseJson(r, ReviewPolicyRuleSchema))
      .filter((x): x is ReviewPolicyRule => !!x);
  }

  upsertOutcome(o: MissionOutcome): void {
    this.db
      .prepare(
        `INSERT INTO outcomes (mission_id, json, status) VALUES (?,?,?)
         ON CONFLICT(mission_id) DO UPDATE SET json=excluded.json, status=excluded.status`,
      )
      .run(o.mission_id, JSON.stringify(o), o.status);
  }
  getOutcome(missionId: string): MissionOutcome | undefined {
    return parseJson(
      this.db.prepare(`SELECT json FROM outcomes WHERE mission_id = ?`).get(missionId),
      MissionOutcomeSchema,
    );
  }

  insertRemediation(r: Remediation): void {
    this.db
      .prepare(`INSERT INTO remediations (id, mission_id, json) VALUES (?,?,?)`)
      .run(r.id, r.mission_id, JSON.stringify(r));
  }
  listRemediations(missionId: string): Remediation[] {
    return this.db
      .prepare(`SELECT json FROM remediations WHERE mission_id = ?`)
      .all(missionId)
      .map((r) => parseJson(r, RemediationSchema))
      .filter((x): x is Remediation => !!x);
  }

  tryClaimIdempotency(key: string): boolean {
    try {
      this.db
        .prepare(`INSERT INTO processed_events (key, created_at) VALUES (?,?)`)
        .run(key, new Date().toISOString());
      return true;
    } catch {
      return false;
    }
  }
  isProcessed(key: string): boolean {
    const row = this.db.prepare(`SELECT key FROM processed_events WHERE key = ?`).get(key);
    return !!row;
  }

  close(): void {
    this.db.close();
  }
}

export function openOutcomeStore(dbPath: string): OutcomeStore {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    /* ignore */
  }
  const db = tryOpenSqlite(dbPath);
  if (!db) {
    return new MemoryOutcomeStore();
  }
  return new SqliteOutcomeStore(db);
}
