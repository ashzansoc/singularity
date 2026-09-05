/**
 * Coding-plane context exports.
 * MUST NOT re-export workers, sqlite, or extraction.
 */
export {
  ArchitectureContextCache,
  lookupCachedContextBlock,
  guessEntities,
  CONTEXT_BUDGET_DEFAULT,
  CONTEXT_BUDGET_MAX,
  CONTEXT_BUDGET_CRITICAL,
  type CachedArchitectureContext,
} from './cache.js';
