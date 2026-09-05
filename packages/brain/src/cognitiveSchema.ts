/**
 * Cognitive-runtime schema fragments and row mappers (schema v3).
 */

import type {
  BrainActivityEvent,
  BrainEpisode,
  BrainEvaluation,
  BrainExperiment,
  BrainHypothesis,
  BrainInsight,
  BrainPolicy,
  BrainProcedure,
  EvidenceRef,
  InsightStatus,
  PolicyStatus,
  ReasoningMode,
} from './types.js';

export const COGNITIVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS procedures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  conditions TEXT,
  steps TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0,
  failure_rate REAL NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.5,
  last_used INTEGER,
  last_evaluated INTEGER,
  project_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_procedures_user ON procedures(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  observation TEXT,
  reasoning TEXT,
  improvement TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',
  related_memory_ids TEXT NOT NULL DEFAULT '[]',
  related_files TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'new',
  reasoning_mode TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(user_id, status);

CREATE TABLE IF NOT EXISTS hypotheses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  statement TEXT NOT NULL,
  counter_statement TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  insight_id TEXT,
  experiment_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'experimental',
  autonomy_level INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_policies_kind ON policies(user_id, kind, status);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  policy_kind TEXT NOT NULL,
  baseline_policy_id TEXT,
  candidate_policy_id TEXT NOT NULL,
  hypothesis_id TEXT,
  evaluation_set TEXT NOT NULL DEFAULT 'default',
  baseline_metrics TEXT NOT NULL DEFAULT '{}',
  candidate_metrics TEXT NOT NULL DEFAULT '{}',
  metrics_meta TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  decision TEXT NOT NULL DEFAULT 'pending',
  summary TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  label TEXT NOT NULL,
  metrics TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  refs TEXT,
  project_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(user_id, ts DESC);
`;

export const EPISODE_COLUMN_MIGRATIONS = [
  'ALTER TABLE episodes ADD COLUMN outcome TEXT',
  'ALTER TABLE episodes ADD COLUMN intention TEXT',
  'ALTER TABLE episodes ADD COLUMN action TEXT',
  'ALTER TABLE episodes ADD COLUMN result TEXT',
  'ALTER TABLE episodes ADD COLUMN lesson TEXT',
  'ALTER TABLE episodes ADD COLUMN meta_json TEXT',
];

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) {
    return fallback;
  }
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function rowToProcedure(r: Record<string, unknown>): BrainProcedure {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    conditions: r.conditions == null ? undefined : String(r.conditions),
    steps: parseJson<string[]>(String(r.steps ?? '[]'), []),
    successRate: Number(r.success_rate ?? 0),
    failureRate: Number(r.failure_rate ?? 0),
    evidence: parseJson<string[]>(String(r.evidence ?? '[]'), []),
    confidence: Number(r.confidence ?? 0.5),
    lastUsed: r.last_used == null ? undefined : Number(r.last_used),
    lastEvaluated: r.last_evaluated == null ? undefined : Number(r.last_evaluated),
    projectId: r.project_id == null ? undefined : String(r.project_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function rowToInsight(r: Record<string, unknown>): BrainInsight {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    projectId: r.project_id == null ? undefined : String(r.project_id),
    title: String(r.title),
    kind: String(r.kind),
    confidence: Number(r.confidence ?? 0.5),
    observation: r.observation == null ? undefined : String(r.observation),
    reasoning: r.reasoning == null ? undefined : String(r.reasoning),
    improvement: r.improvement == null ? undefined : String(r.improvement),
    evidence: parseJson<EvidenceRef[]>(String(r.evidence ?? '[]'), []),
    relatedMemoryIds: parseJson<string[]>(String(r.related_memory_ids ?? '[]'), []),
    relatedFiles: parseJson<string[]>(String(r.related_files ?? '[]'), []),
    status: String(r.status ?? 'new') as InsightStatus,
    reasoningMode: String(r.reasoning_mode ?? 'default') as ReasoningMode,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function rowToHypothesis(r: Record<string, unknown>): BrainHypothesis {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    projectId: r.project_id == null ? undefined : String(r.project_id),
    statement: String(r.statement),
    counterStatement: r.counter_statement == null ? undefined : String(r.counter_statement),
    confidence: Number(r.confidence ?? 0.5),
    evidenceIds: parseJson<string[]>(String(r.evidence_ids ?? '[]'), []),
    status: String(r.status ?? 'open') as BrainHypothesis['status'],
    insightId: r.insight_id == null ? undefined : String(r.insight_id),
    experimentId: r.experiment_id == null ? undefined : String(r.experiment_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function rowToPolicy(r: Record<string, unknown>): BrainPolicy {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    kind: String(r.kind),
    version: String(r.version),
    payload: parseJson<Record<string, unknown>>(String(r.payload ?? '{}'), {}),
    status: String(r.status ?? 'experimental') as PolicyStatus,
    autonomyLevel: Number(r.autonomy_level ?? 1) as BrainPolicy['autonomyLevel'],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function rowToExperiment(r: Record<string, unknown>): BrainExperiment {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    policyKind: String(r.policy_kind),
    baselinePolicyId: r.baseline_policy_id == null ? undefined : String(r.baseline_policy_id),
    candidatePolicyId: String(r.candidate_policy_id),
    hypothesisId: r.hypothesis_id == null ? undefined : String(r.hypothesis_id),
    evaluationSet: String(r.evaluation_set ?? 'default'),
    baselineMetrics: parseJson<Record<string, number>>(String(r.baseline_metrics ?? '{}'), {}),
    candidateMetrics: parseJson<Record<string, number>>(String(r.candidate_metrics ?? '{}'), {}),
    metricsMeta: r.metrics_meta == null ? undefined : parseJson<Record<string, { higherIsBetter: boolean }> | undefined>(String(r.metrics_meta), undefined),
    status: String(r.status ?? 'proposed') as BrainExperiment['status'],
    decision: String(r.decision ?? 'pending') as BrainExperiment['decision'],
    summary: r.summary == null ? undefined : String(r.summary),
    createdAt: Number(r.created_at),
    finishedAt: r.finished_at == null ? undefined : Number(r.finished_at),
  };
}

export function rowToEvaluation(r: Record<string, unknown>): BrainEvaluation {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    experimentId: String(r.experiment_id),
    label: String(r.label),
    metrics: parseJson<Record<string, number>>(String(r.metrics ?? '{}'), {}),
    notes: r.notes == null ? undefined : String(r.notes),
    createdAt: Number(r.created_at),
  };
}

export function rowToActivity(r: Record<string, unknown>): BrainActivityEvent {
  return {
    id: String(r.id),
    ts: Number(r.ts),
    kind: String(r.kind),
    message: String(r.message),
    refs: r.refs == null ? undefined : parseJson<string[] | undefined>(String(r.refs), undefined),
    projectId: r.project_id == null ? undefined : String(r.project_id),
  };
}

export function enrichEpisodeRow(r: Record<string, unknown>, base: BrainEpisode): BrainEpisode {
  return {
    ...base,
    outcome: r.outcome == null ? base.outcome : (String(r.outcome) as BrainEpisode['outcome']),
    intention: r.intention == null ? undefined : String(r.intention),
    action: r.action == null ? undefined : String(r.action),
    result: r.result == null ? undefined : String(r.result),
    lesson: r.lesson == null ? undefined : String(r.lesson),
    meta: r.meta_json == null ? undefined : parseJson<Record<string, unknown> | undefined>(String(r.meta_json), undefined),
  };
}
