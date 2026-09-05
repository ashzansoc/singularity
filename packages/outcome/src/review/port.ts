import type { ReviewEvidenceItem } from '../domain/types.js';

export interface ArchitectureSignals {
  architecture_version?: string | number;
  evidence_watermark?: string;
  risk_level?: string;
  risk_score?: number;
  architecture_impact?: string;
  impact_recommendation?: string;
  affects_production?: boolean;
  affected_services?: string[];
  proposed_adrs?: ReviewEvidenceItem[];
  commits?: ReviewEvidenceItem[];
  prs?: ReviewEvidenceItem[];
  tests?: ReviewEvidenceItem[];
  deployments?: ReviewEvidenceItem[];
  incidents?: ReviewEvidenceItem[];
  adrs?: ReviewEvidenceItem[];
  architecture_changes?: ReviewEvidenceItem[];
  conflicts?: ReviewEvidenceItem[];
  risk_refs?: string[];
}

export interface ArchitectureReviewPort {
  collectSignals(input: {
    mission_id: string;
    project_id: string;
    code_revision?: string;
    changed_files?: string[];
  }): ArchitectureSignals;
}

export const EMPTY_ARCHITECTURE_SIGNALS: ArchitectureSignals = {};
