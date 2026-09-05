import { createHash } from 'node:crypto';
import type { DecisionStore } from '../memory/decisionStore.js';
import { IMPACT_ANALYSIS_VERSION, type ImpactAnalysisRequest } from './types.js';

export function architectureVersionKey(projectId: string): string {
  return `architecture_version:${projectId}`;
}

export function readArchitectureVersion(store: DecisionStore, projectId: string): number {
  const n = Number(store.getKv(architectureVersionKey(projectId)) ?? '0');
  return Number.isFinite(n) ? n : 0;
}

export function bumpArchitectureVersion(store: DecisionStore, projectId: string): number {
  const next = readArchitectureVersion(store, projectId) + 1;
  store.setKv(architectureVersionKey(projectId), String(next));
  return next;
}

function normList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.replace(/\\/g, '/').trim()).filter(Boolean))].sort();
}

export function impactFingerprint(
  req: ImpactAnalysisRequest,
  architectureVersion: number,
  analysisVersion = IMPACT_ANALYSIS_VERSION,
): string {
  const payload = JSON.stringify({
    v: analysisVersion,
    architecture_version: architectureVersion,
    repository: req.repository ?? '',
    commit_id: req.commit_id ?? '',
    files: normList(req.affected_files),
    symbols: normList(req.symbols?.map((s) => s.toLowerCase())),
    change: (req.change ?? '').trim().toLowerCase(),
  });
  return createHash('sha256').update(payload).digest('hex');
}
