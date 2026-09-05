import type { Intent, Tier } from './types.js';

/** Human-readable purpose for each tier. */
export const TIER_PURPOSE: Record<Tier, string> = {
  T0: 'Ultra-fast autocomplete',
  T1: 'Coding & inline edits',
  T2: 'Documentation & explanations',
  T3: 'Debugging & reasoning',
  T4: 'Long-context understanding',
  T5: 'Premium coding',
  T6: 'Frontier / edge-case reasoning',
};

/**
 * Default minimum tier for each intent (from architecture category→tier table).
 * UNKNOWN falls back to T1 (general coding chat).
 */
export const INTENT_DEFAULT_TIER: Record<Intent, Tier> = {
  AUTOCOMPLETE: 'T0',
  SEARCH: 'T0',
  INLINE_EDIT: 'T1',
  TERMINAL: 'T1',
  TEST: 'T1',
  EXPLAIN: 'T2',
  DOCUMENTATION: 'T2',
  DEBUG: 'T3',
  AGENT: 'T3',
  ARCHITECTURE: 'T5',
  REFACTOR: 'T5',
  REVIEW: 'T5',
  UNKNOWN: 'T1',
};

/** Default sampling temperature by intent. */
export const INTENT_TEMPERATURE: Record<Intent, number> = {
  AUTOCOMPLETE: 0.0,
  SEARCH: 0.0,
  INLINE_EDIT: 0.1,
  TERMINAL: 0.1,
  TEST: 0.2,
  EXPLAIN: 0.3,
  DOCUMENTATION: 0.3,
  DEBUG: 0.2,
  AGENT: 0.2,
  ARCHITECTURE: 0.3,
  REFACTOR: 0.2,
  REVIEW: 0.2,
  UNKNOWN: 0.2,
};

/** Default max output tokens by intent. */
export const INTENT_MAX_TOKENS: Record<Intent, number> = {
  AUTOCOMPLETE: 256,
  SEARCH: 512,
  INLINE_EDIT: 2048,
  TERMINAL: 1024,
  TEST: 4096,
  EXPLAIN: 2048,
  DOCUMENTATION: 4096,
  DEBUG: 4096,
  AGENT: 8192,
  ARCHITECTURE: 4096,
  REFACTOR: 8192,
  REVIEW: 4096,
  UNKNOWN: 2048,
};

/** System prompt hints keyed by intent. */
export const INTENT_SYSTEM_HINT: Record<Intent, string> = {
  AUTOCOMPLETE: 'Complete the next code tokens briefly and accurately.',
  SEARCH: 'Locate symbols and files; return precise references.',
  INLINE_EDIT: 'Apply a focused edit; preserve surrounding style.',
  TERMINAL: 'Suggest safe, correct shell commands for the user environment.',
  TEST: 'Write or repair tests that match existing project conventions.',
  EXPLAIN: 'Explain clearly with concrete references to the provided code.',
  DOCUMENTATION: 'Produce accurate developer documentation.',
  DEBUG: 'Diagnose root cause from errors, traces, and surrounding code.',
  AGENT: 'Plan and execute multi-step coding tasks carefully.',
  ARCHITECTURE: 'Explain system structure, boundaries, and trade-offs.',
  REFACTOR: 'Refactor for clarity and correctness without changing behavior.',
  REVIEW: 'Review for bugs, security, and maintainability; be specific.',
  UNKNOWN: 'Help with the coding task using the provided context.',
};

export function resolveToolPermissions(
  intent: Intent,
  requiresTools: boolean,
): 'none' | 'read' | 'edit' | 'agent' {
  if (intent === 'AGENT') {
    return 'agent';
  }
  if (intent === 'REFACTOR' || intent === 'INLINE_EDIT' || intent === 'TEST') {
    return 'edit';
  }
  if (intent === 'SEARCH' || intent === 'REVIEW' || intent === 'ARCHITECTURE' || intent === 'DEBUG') {
    return 'read';
  }
  if (requiresTools) {
    return 'read';
  }
  return 'none';
}
