import type { Adr, AdrStatus } from '../domain/adr/schema.js';
import type { DomainEvent } from '../events/types.js';
import type { StoredImpactAnalysis } from '../impact/types.js';
import type { StoredRiskAssessment } from '../risk/types.js';

export interface Observation {
  id: string;
  project_id: string;
  text: string;
  confidence: number;
  source?: string;
  created_at: string;
}

export interface StoredConflict {
  id: string;
  project_id: string;
  adr_id: string;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  created_at: string;
}

export type DriftKind =
  | 'rejected_in_use'
  | 'missing_declared'
  | 'constraint_violation'
  | 'missing_implementation'
  | 'undeclared_dependency';

export type DriftStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export interface StoredDrift {
  id: string;
  project_id: string;
  adr_id: string;
  severity: 'low' | 'medium' | 'high';
  kind: DriftKind;
  reason: string;
  files: string[];
  created_at: string;
  status?: DriftStatus;
  confidence?: number;
  declared?: unknown;
  observed?: unknown;
  affected_nodes?: string[];
}

export interface StoredProductionEvent {
  event_id: string;
  project_id: string;
  idempotency_key: string;
  event_type: string;
  timestamp: string;
  received_at: string;
  json: string;
}

export interface StoredCorrelation {
  id: string;
  project_id: string;
  event_id: string;
  target_type: string;
  target_id: string;
  rel: string;
  confidence: number;
  reasons: string[];
  created_at: string;
}

export interface StoredDebugContext {
  incident_id: string;
  project_id: string;
  json: string;
  updated_at: string;
}

export interface StoredEvolution {
  id: string;
  project_id: string;
  old_adr_id: string;
  proposed_adr_id: string;
  reason: string;
  trigger: 'drift' | 'incident' | 'deployment_failure' | 'validation';
  created_at: string;
}

export interface DecisionStore {
  nextAdrId(projectId: string): string;
  insert(adr: Adr): Adr;
  update(adr: Adr): Adr;
  get(id: string): Adr | undefined;
  list(opts?: {
    project_id?: string;
    status?: AdrStatus | AdrStatus[];
    record_kind?: Adr['record_kind'];
  }): Adr[];
  versions(id: string): Adr[];
  insertObservation(obs: Observation): void;
  listObservations(projectId: string): Observation[];
  insertConflict(c: StoredConflict): void;
  listConflicts(projectId: string): StoredConflict[];
  insertDrift(d: StoredDrift): void;
  listDrifts(projectId: string): StoredDrift[];
  getDrift(id: string): StoredDrift | undefined;
  updateDrift(d: StoredDrift): void;
  insertEvolution(e: StoredEvolution): void;
  listEvolutions(projectId: string): StoredEvolution[];
  upsertEmbedding(adrId: string, embedding: number[], text: string): void;
  getEmbedding(adrId: string): { embedding: number[]; text: string } | undefined;
  listEmbeddings(projectId: string): Array<{ adr_id: string; embedding: number[]; text: string }>;
  enqueueOutbox(event: DomainEvent): void;
  drainOutbox(limit?: number): DomainEvent[];
  getKv(key: string): string | undefined;
  setKv(key: string, value: string): void;
  upsertProductionEvent(row: StoredProductionEvent): void;
  getProductionEvent(eventId: string): StoredProductionEvent | undefined;
  getProductionEventByIdempotency(key: string): StoredProductionEvent | undefined;
  pruneProductionEvents(beforeIso: string): number;
  insertCorrelation(row: StoredCorrelation): void;
  listCorrelations(projectId: string, eventId?: string): StoredCorrelation[];
  getCorrelation(id: string): StoredCorrelation | undefined;
  upsertDebugContext(row: StoredDebugContext): void;
  getDebugContext(incidentId: string): StoredDebugContext | undefined;
  upsertImpactAnalysis(row: StoredImpactAnalysis): void;
  getImpactAnalysis(id: string): StoredImpactAnalysis | undefined;
  getImpactByFingerprint(fingerprint: string): StoredImpactAnalysis | undefined;
  listImpactAnalyses(projectId: string, limit?: number): StoredImpactAnalysis[];
  listProductionEvents(projectId: string, limit?: number): StoredProductionEvent[];
  upsertRiskAssessment(row: StoredRiskAssessment): void;
  getRiskAssessment(id: string): StoredRiskAssessment | undefined;
  getRiskByFingerprint(fingerprint: string): StoredRiskAssessment | undefined;
  listRiskAssessments(projectId: string, limit?: number): StoredRiskAssessment[];
  listRiskByMission(projectId: string, missionId: string, limit?: number): StoredRiskAssessment[];
  close(): void;
}
