export {
  IMPACT_ANALYSIS_VERSION,
  emptyCodeImpact,
  mergeCodeImpact,
  type ImpactAnalysisStatus,
  type ImpactSeverity,
  type ImpactRecommendation,
  type ImpactAnalysisRequest,
  type CodeImpactSlice,
  type CodeImpactProvider,
  type ImpactAnalysisResult,
  type StoredImpactAnalysis,
  type ImpactIngestResult,
} from './types.js';
export {
  architectureVersionKey,
  readArchitectureVersion,
  bumpArchitectureVersion,
  impactFingerprint,
} from './fingerprint.js';
export { scoreImpact, type ImpactEvidence } from './severity.js';
export { ingestImpactAnalysis, parseImpactRequest, newAnalysisId } from './ingest.js';
export {
  computeImpactAnalysis,
  runStoredImpactAnalysis,
  persistImpactResult,
  storedToResult,
} from './worker.js';
