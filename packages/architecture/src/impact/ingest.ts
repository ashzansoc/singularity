import type { LocalEventBuffer } from '../events/localBuffer.js';
import { newEventId } from '../events/types.js';
import type { ArchitectureFlags } from '../flags.js';
import { isArchitectureMemoryActive } from '../flags.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import { nowIso } from '../domain/adr/schema.js';
import { impactFingerprint, readArchitectureVersion } from './fingerprint.js';
import { IMPACT_ANALYSIS_VERSION, type ImpactAnalysisRequest, type ImpactIngestResult } from './types.js';

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) {
    return undefined;
  }
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

export function parseImpactRequest(input: unknown): ImpactAnalysisRequest {
  const rec = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const files = asStringList(rec.affected_files) ?? asStringList(rec.files);
  const symbols = asStringList(rec.symbols);
  const change = typeof rec.change === 'string' ? rec.change : undefined;
  const commit_id = typeof rec.commit_id === 'string' ? rec.commit_id : undefined;
  const repository = typeof rec.repository === 'string' ? rec.repository : undefined;
  const depth = typeof rec.depth === 'number' && Number.isFinite(rec.depth) ? rec.depth : undefined;
  if (!change && !(files?.length) && !(symbols?.length)) {
    return { change: '', affected_files: files ?? [], symbols: symbols ?? [], commit_id, repository, depth };
  }
  return { change, affected_files: files, symbols, commit_id, repository, depth };
}

export function newAnalysisId(): string {
  return `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Validate + enqueue. Never walks graphs, parses code, or calls an LLM.
 */
export function ingestImpactAnalysis(
  input: unknown,
  opts: {
    projectId: string;
    buffer: LocalEventBuffer;
    flags: ArchitectureFlags;
    store: DecisionStore;
    metrics?: ArchitectureMetricsCollector;
    traceId?: string;
  },
): ImpactIngestResult {
  if (!isArchitectureMemoryActive(opts.flags)) {
    return {
      queued: false,
      analysis_id: '',
      status: 'failed',
      fingerprint: '',
      error: 'architecture_memory_disabled',
      code: 'disabled',
    };
  }
  const req = parseImpactRequest(input);
  const architectureVersion = readArchitectureVersion(opts.store, opts.projectId);
  const fingerprint = impactFingerprint(req, architectureVersion);
  const existing = opts.store.getImpactByFingerprint(fingerprint);
  if (existing) {
    if (existing.status === 'completed') {
      opts.metrics?.recordImpactCacheHit();
      return {
        queued: true,
        analysis_id: existing.analysis_id,
        status: 'completed',
        fingerprint,
        duplicate: true,
      };
    }
    if (existing.status === 'queued' || existing.status === 'running') {
      opts.metrics?.recordImpactCacheHit();
      return {
        queued: true,
        analysis_id: existing.analysis_id,
        status: existing.status,
        fingerprint,
        duplicate: true,
      };
    }
    opts.metrics?.recordImpactCacheMiss();
    const ts = nowIso();
    const trace_id = opts.traceId ?? newEventId();
    opts.store.upsertImpactAnalysis({
      ...existing,
      status: 'queued',
      request_json: JSON.stringify(req),
      error: undefined,
      trace_id,
      updated_at: ts,
    });
    opts.buffer.append({
      event_type: 'ARCHITECTURE_IMPACT_ANALYSIS_REQUESTED',
      project_id: opts.projectId,
      commit_id: req.commit_id,
      changed_files: req.affected_files,
      trace_id,
      payload: {
        analysis_id: existing.analysis_id,
        fingerprint,
        request: req,
        architecture_version: architectureVersion,
      },
    });
    opts.metrics?.recordImpactQueued();
    opts.metrics?.setQueueDepth(opts.buffer.peekDepth());
    return { queued: true, analysis_id: existing.analysis_id, status: 'queued', fingerprint };
  }
  opts.metrics?.recordImpactCacheMiss();
  const analysis_id = newAnalysisId();
  const ts = nowIso();
  const trace_id = opts.traceId ?? newEventId();
  try {
    opts.store.upsertImpactAnalysis({
      analysis_id,
      fingerprint,
      project_id: opts.projectId,
      status: 'queued',
      request_json: JSON.stringify(req),
      result_json: '{}',
      analysis_version: IMPACT_ANALYSIS_VERSION,
      trace_id,
      created_at: ts,
      updated_at: ts,
    });
  } catch (e) {
    opts.metrics?.recordImpactFailed();
    return {
      queued: false,
      analysis_id,
      status: 'failed',
      fingerprint,
      error: e instanceof Error ? e.message : 'persist_failed',
      code: 'persist',
    };
  }
  opts.buffer.append({
    event_type: 'ARCHITECTURE_IMPACT_ANALYSIS_REQUESTED',
    project_id: opts.projectId,
    commit_id: req.commit_id,
    changed_files: req.affected_files,
    trace_id,
    payload: {
      analysis_id,
      fingerprint,
      request: req,
      architecture_version: architectureVersion,
    },
  });
  opts.metrics?.recordImpactQueued();
  opts.metrics?.setQueueDepth(opts.buffer.peekDepth());
  return { queued: true, analysis_id, status: 'queued', fingerprint };
}
