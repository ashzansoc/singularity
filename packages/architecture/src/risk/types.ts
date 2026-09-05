export const RISK_ASSESSMENT_VERSION = 1;

export type RiskJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type RiskAssessmentStatus = 'PENDING' | 'READY' | 'STALE' | 'FAILED';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RiskFactorType =
  | 'change_blast_radius'
  | 'architecture'
  | 'adr_documented_risk'
  | 'production'
  | 'historical'
  | 'verification'
  | 'complexity'
  | 'prompt'
  | 'mitigation_tests'
  | 'mitigation_recent_deploy';

export interface PromptRiskInput {
  predicted_success?: number;
  predicted_regeneration?: number;
  passed?: boolean;
}

export interface VerificationInput {
  missing_tests?: string[];
  last_run_failed?: boolean;
  coverage_hint?: number;
}

export interface RiskAssessmentRequest {
  mission_id?: string;
  change?: string;
  repository?: string;
  commit_id?: string;
  affected_files?: string[];
  symbols?: string[];
  services?: string[];
  prompt_risk?: PromptRiskInput;
  verification?: VerificationInput;
}

export interface RiskSourceVersions {
  architecture_version: number;
  impact_analysis_id?: string;
  production_watermark: string;
}

export interface RiskFactor {
  type: RiskFactorType;
  score: number;
  weight: number;
  contribution: number;
  severity: RiskLevel;
  explanation: string;
  evidence_refs: string[];
}

export interface RiskRecommendation {
  text: string;
  factor_types: RiskFactorType[];
  evidence_refs: string[];
}

export interface RiskAssessment {
  assessment_id: string;
  mission_id: string;
  fingerprint: string;
  project_id: string;
  job_status: RiskJobStatus;
  assessment_status: RiskAssessmentStatus;
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  factors: RiskFactor[];
  recommendations: RiskRecommendation[];
  evidence_refs: string[];
  affected_services: string[];
  affected_symbols: string[];
  affected_adrs: string[];
  constraints: string[];
  conflicts: string[];
  drifts: string[];
  assessment_version: number;
  source_versions: RiskSourceVersions;
  computed_at?: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  trace_id?: string;
  error?: string;
  impact_analysis_id?: string;
  outcome_json?: string;
}

export interface StoredRiskAssessment {
  assessment_id: string;
  fingerprint: string;
  mission_id: string;
  project_id: string;
  status: RiskJobStatus;
  assessment_status: RiskAssessmentStatus;
  request_json: string;
  result_json: string;
  risk_score?: number;
  risk_level?: string;
  confidence?: number;
  source_versions?: string;
  error?: string;
  trace_id?: string;
  assessment_version: number;
  outcome_json?: string;
  created_at: string;
  updated_at: string;
}

export interface RiskIngestResult {
  queued: boolean;
  assessment_id: string;
  mission_id: string;
  status: RiskJobStatus;
  assessment_status: RiskAssessmentStatus;
  fingerprint: string;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

export function jobToAssessmentStatus(job: RiskJobStatus, stale = false): RiskAssessmentStatus {
  if (job === 'failed') {
    return 'FAILED';
  }
  if (job === 'queued' || job === 'running') {
    return 'PENDING';
  }
  if (stale) {
    return 'STALE';
  }
  return 'READY';
}
