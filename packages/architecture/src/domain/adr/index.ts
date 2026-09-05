export type * from './schema.js';
export { parseAdr, safeParseAdr, embedText, nowIso, AdrSchema } from './schema.js';
export { canTransition, transitionAdr, isActiveStatus, applySupersession } from './lifecycle.js';
export { validateAdrDeep, type ValidationResult } from './validation.js';
export {
  scoreConfidence,
  confidenceAction,
  inferFactorsFromText,
  type ConfidenceAction,
} from './confidence.js';
export {
  classifySignificance,
  shouldEnterAdrPipeline,
  type SignificanceLevel,
} from './significance.js';
