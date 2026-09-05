export const IMPACT_ANALYSIS_VERSION = 1;

export type ImpactAnalysisStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ImpactSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ImpactRecommendation =
  | 'SAFE_TO_PROCEED'
  | 'PROCEED_WITH_TESTS'
  | 'REVIEW_REQUIRED'
  | 'ARCHITECTURE_REVIEW_REQUIRED'
  | 'DO_NOT_PROCEED';

export interface ImpactAnalysisRequest {
  change?: string;
  affected_files?: string[];
  symbols?: string[];
  commit_id?: string;
  repository?: string;
  depth?: number;
}

export interface CodeImpactSlice {
  symbols: string[];
  callers: string[];
  callees: string[];
  files: string[];
  tests: string[];
  implementations?: string[];
  interfaces?: string[];
  error?: string;
}

export interface CodeImpactProvider {
  impactForSymbols(symbols: string[], depth?: number): CodeImpactSlice;
  impactForFiles?(files: string[], depth?: number): CodeImpactSlice;
}

export interface ImpactAnalysisResult {
  analysis_id: string;
  status: ImpactAnalysisStatus;
  fingerprint: string;
  project_id: string;
  repository?: string;
  commit_id?: string;
  analysis_version: number;
  change?: string;
  affected_symbols: string[];
  affected_files: string[];
  affected_packages: string[];
  affected_services: string[];
  affected_decisions: string[];
  affected_adrs: string[];
  constraints: string[];
  risks: string[];
  conflicts: string[];
  drifts: string[];
  severity: ImpactSeverity;
  recommendation: ImpactRecommendation;
  reasons: string[];
  confidence: number;
  error?: string;
  trace_id?: string;
  created_at: string;
  updated_at: string;
}

export interface StoredImpactAnalysis {
  analysis_id: string;
  fingerprint: string;
  project_id: string;
  status: ImpactAnalysisStatus;
  request_json: string;
  result_json: string;
  severity?: string;
  recommendation?: string;
  confidence?: number;
  error?: string;
  trace_id?: string;
  analysis_version: number;
  created_at: string;
  updated_at: string;
}

export interface ImpactIngestResult {
  queued: boolean;
  analysis_id: string;
  status: ImpactAnalysisStatus;
  fingerprint: string;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

export function emptyCodeImpact(): CodeImpactSlice {
  return {
    symbols: [],
    callers: [],
    callees: [],
    files: [],
    tests: [],
  };
}

export function mergeCodeImpact(parts: CodeImpactSlice[]): CodeImpactSlice {
  const symbols = new Set<string>();
  const callers = new Set<string>();
  const callees = new Set<string>();
  const files = new Set<string>();
  const tests = new Set<string>();
  const implementations = new Set<string>();
  const interfaces = new Set<string>();
  const errors: string[] = [];
  for (const p of parts) {
    for (const s of p.symbols) {
      symbols.add(s);
    }
    for (const s of p.callers) {
      callers.add(s);
    }
    for (const s of p.callees) {
      callees.add(s);
    }
    for (const s of p.files) {
      files.add(s);
    }
    for (const s of p.tests) {
      tests.add(s);
    }
    for (const s of p.implementations ?? []) {
      implementations.add(s);
    }
    for (const s of p.interfaces ?? []) {
      interfaces.add(s);
    }
    if (p.error) {
      errors.push(p.error);
    }
  }
  return {
    symbols: [...symbols],
    callers: [...callers],
    callees: [...callees],
    files: [...files],
    tests: [...tests],
    implementations: [...implementations],
    interfaces: [...interfaces],
    error: errors.length ? errors.join('; ') : undefined,
  };
}
