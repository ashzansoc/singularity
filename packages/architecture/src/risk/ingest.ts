import type { LocalEventBuffer } from '../events/localBuffer.js';
import { newEventId } from '../events/types.js';
import type { ArchitectureFlags } from '../flags.js';
import { isArchitectureMemoryActive } from '../flags.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import { nowIso } from '../domain/adr/schema.js';
import { readArchitectureVersion } from '../impact/fingerprint.js';
import { derivedMissionId, riskFingerprint } from './fingerprint.js';
import { isRiskStale, productionWatermark } from './freshness.js';
import { RISK_ASSESSMENT_VERSION } from './weights.js';
import {
  jobToAssessmentStatus,
  type PromptRiskInput,
  type RiskAssessmentRequest,
  type RiskIngestResult,
  type VerificationInput,
} from './types.js';

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

function parsePrompt(v: unknown): PromptRiskInput | undefined {
  if (typeof v !== 'object' || !v) {
    return undefined;
  }
  const rec = v as Record<string, unknown>;
  const out: PromptRiskInput = {};
  if (typeof rec.predicted_success === 'number') {
    out.predicted_success = rec.predicted_success;
  }
  if (typeof rec.predicted_regeneration === 'number') {
    out.predicted_regeneration = rec.predicted_regeneration;
  }
  if (typeof rec.passed === 'boolean') {
    out.passed = rec.passed;
  }
  if (
    out.predicted_success == null &&
    out.predicted_regeneration == null &&
    out.passed == null
  ) {
    return undefined;
  }
  return out;
}

function parseVerification(v: unknown): VerificationInput | undefined {
  if (typeof v !== 'object' || !v) {
    return undefined;
  }
  const rec = v as Record<string, unknown>;
  return {
    missing_tests: asStringList(rec.missing_tests),
    last_run_failed: typeof rec.last_run_failed === 'boolean' ? rec.last_run_failed : undefined,
    coverage_hint: typeof rec.coverage_hint === 'number' ? rec.coverage_hint : undefined,
  };
}

export function parseRiskRequest(input: unknown): RiskAssessmentRequest {
  const rec = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const files = asStringList(rec.affected_files) ?? asStringList(rec.changed_files) ?? asStringList(rec.files);
  const symbols = asStringList(rec.symbols) ?? asStringList(rec.changed_symbols);
  const services = asStringList(rec.services);
  const change = typeof rec.change === 'string' ? rec.change : undefined;
  const commit_id =
    typeof rec.commit_id === 'string'
      ? rec.commit_id
      : typeof rec.commit === 'string'
        ? rec.commit
        : undefined;
  const repository = typeof rec.repository === 'string' ? rec.repository : undefined;
  const mission_id = typeof rec.mission_id === 'string' && rec.mission_id.trim() ? rec.mission_id : undefined;
  return {
    mission_id,
    change,
    affected_files: files,
    symbols,
    services,
    commit_id,
    repository,
    prompt_risk: parsePrompt(rec.prompt_risk),
    verification: parseVerification(rec.verification),
  };
}

export function newAssessmentId(): string {
  return `rsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isMissionRiskActive(flags: ArchitectureFlags): boolean {
  return isArchitectureMemoryActive(flags) && flags.mission_risk_scoring_enabled !== false;
}

/**
 * Validate + enqueue. Never scores, walks graphs, or calls an LLM.
 */
export function ingestRiskAssessment(
  input: unknown,
  opts: {
    projectId: string;
    buffer: LocalEventBuffer;
    flags: ArchitectureFlags;
    store: DecisionStore;
    metrics?: ArchitectureMetricsCollector;
    traceId?: string;
  },
): RiskIngestResult {
  if (!isMissionRiskActive(opts.flags)) {
    return {
      queued: false,
      assessment_id: '',
      mission_id: '',
      status: 'failed',
      assessment_status: 'FAILED',
      fingerprint: '',
      error: 'mission_risk_scoring_disabled',
      code: 'disabled',
    };
  }
  const req = parseRiskRequest(input);
  const architectureVersion = readArchitectureVersion(opts.store, opts.projectId);
  const fingerprint = riskFingerprint(req, architectureVersion);
  const mission_id = req.mission_id ?? derivedMissionId(fingerprint);
  const reqStored = { ...req, mission_id };
  const existing = opts.store.getRiskByFingerprint(fingerprint);
  if (existing) {
    if (existing.status === 'completed') {
      const stale = isRiskStale(
        existing,
        architectureVersion,
        productionWatermark(opts.store.listProductionEvents(opts.projectId)),
      );
      if (!stale) {
        opts.metrics?.recordRiskCacheHit();
        return {
          queued: true,
          assessment_id: existing.assessment_id,
          mission_id: existing.mission_id,
          status: 'completed',
          assessment_status: 'READY',
          fingerprint,
          duplicate: true,
        };
      }
      opts.metrics?.recordRiskCacheMiss();
      opts.metrics?.recordRiskRecompute();
      const ts = nowIso();
      const trace_id = opts.traceId ?? newEventId();
      const assessment_id = newAssessmentId();
      try {
        opts.store.upsertRiskAssessment({
          assessment_id,
          fingerprint: `${fingerprint}:stale:${ts}`,
          mission_id,
          project_id: opts.projectId,
          status: 'queued',
          assessment_status: 'PENDING',
          request_json: JSON.stringify(reqStored),
          result_json: '{}',
          assessment_version: RISK_ASSESSMENT_VERSION,
          trace_id,
          created_at: ts,
          updated_at: ts,
        });
      } catch (e) {
        opts.metrics?.recordRiskFailed();
        return {
          queued: false,
          assessment_id,
          mission_id,
          status: 'failed',
          assessment_status: 'FAILED',
          fingerprint,
          error: e instanceof Error ? e.message : 'persist_failed',
          code: 'persist',
        };
      }
      opts.buffer.append({
        event_type: 'ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED',
        project_id: opts.projectId,
        commit_id: req.commit_id,
        changed_files: req.affected_files,
        trace_id,
        payload: {
          assessment_id,
          mission_id,
          fingerprint,
          request: reqStored,
          architecture_version: architectureVersion,
        },
      });
      opts.metrics?.recordRiskQueued();
      opts.metrics?.setQueueDepth(opts.buffer.peekDepth());
      return {
        queued: true,
        assessment_id,
        mission_id,
        status: 'queued',
        assessment_status: 'PENDING',
        fingerprint,
      };
    }
    if (existing.status === 'queued' || existing.status === 'running') {
      opts.metrics?.recordRiskCacheHit();
      return {
        queued: true,
        assessment_id: existing.assessment_id,
        mission_id: existing.mission_id,
        status: existing.status,
        assessment_status: 'PENDING',
        fingerprint,
        duplicate: true,
      };
    }
    opts.metrics?.recordRiskCacheMiss();
    const ts = nowIso();
    const trace_id = opts.traceId ?? newEventId();
    opts.store.upsertRiskAssessment({
      ...existing,
      status: 'queued',
      assessment_status: 'PENDING',
      request_json: JSON.stringify(reqStored),
      error: undefined,
      trace_id,
      updated_at: ts,
    });
    opts.buffer.append({
      event_type: 'ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED',
      project_id: opts.projectId,
      commit_id: req.commit_id,
      changed_files: req.affected_files,
      trace_id,
      payload: {
        assessment_id: existing.assessment_id,
        mission_id,
        fingerprint,
        request: reqStored,
        architecture_version: architectureVersion,
      },
    });
    opts.metrics?.recordRiskQueued();
    opts.metrics?.setQueueDepth(opts.buffer.peekDepth());
    return {
      queued: true,
      assessment_id: existing.assessment_id,
      mission_id,
      status: 'queued',
      assessment_status: 'PENDING',
      fingerprint,
    };
  }
  opts.metrics?.recordRiskCacheMiss();
  const assessment_id = newAssessmentId();
  const ts = nowIso();
  const trace_id = opts.traceId ?? newEventId();
  try {
    opts.store.upsertRiskAssessment({
      assessment_id,
      fingerprint,
      mission_id,
      project_id: opts.projectId,
      status: 'queued',
      assessment_status: 'PENDING',
      request_json: JSON.stringify(reqStored),
      result_json: '{}',
      assessment_version: RISK_ASSESSMENT_VERSION,
      trace_id,
      created_at: ts,
      updated_at: ts,
    });
  } catch (e) {
    opts.metrics?.recordRiskFailed();
    return {
      queued: false,
      assessment_id,
      mission_id,
      status: 'failed',
      assessment_status: 'FAILED',
      fingerprint,
      error: e instanceof Error ? e.message : 'persist_failed',
      code: 'persist',
    };
  }
  opts.buffer.append({
    event_type: 'ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED',
    project_id: opts.projectId,
    commit_id: req.commit_id,
    changed_files: req.affected_files,
    trace_id,
    payload: {
      assessment_id,
      mission_id,
      fingerprint,
      request: reqStored,
      architecture_version: architectureVersion,
    },
  });
  opts.metrics?.recordRiskQueued();
  opts.metrics?.setQueueDepth(opts.buffer.peekDepth());
  return {
    queued: true,
    assessment_id,
    mission_id,
    status: 'queued',
    assessment_status: jobToAssessmentStatus('queued'),
    fingerprint,
  };
}
