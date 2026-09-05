import type { Intent, IntentClassification, RouteFeatures } from '../types.js';

export interface IntentRule {
  name: string;
  /** Higher runs first within the same priority band. */
  priority: number;
  confidence: number;
  match: (features: RouteFeatures) => boolean;
  intent: Intent;
}

/**
 * Ordered rule set: mode overrides first, then keyword heuristics.
 */
export const INTENT_RULES: IntentRule[] = [
  {
    name: 'mode-autocomplete',
    priority: 100,
    confidence: 1,
    intent: 'AUTOCOMPLETE',
    match: (f) => f.mode === 'autocomplete',
  },
  {
    name: 'mode-agent',
    priority: 100,
    confidence: 1,
    intent: 'AGENT',
    match: (f) => f.mode === 'agent',
  },
  {
    name: 'mode-inline',
    priority: 95,
    confidence: 0.95,
    intent: 'INLINE_EDIT',
    match: (f) => f.mode === 'inline',
  },
  {
    name: 'mode-terminal',
    priority: 95,
    confidence: 0.9,
    intent: 'TERMINAL',
    match: (f) => f.mode === 'terminal',
  },
  {
    name: 'kw-security-review',
    priority: 80,
    confidence: 0.9,
    intent: 'REVIEW',
    match: (f) => f.keywords.security || (f.keywords.review && f.keywords.security),
  },
  {
    name: 'kw-review',
    priority: 75,
    confidence: 0.88,
    intent: 'REVIEW',
    match: (f) => f.keywords.review,
  },
  {
    name: 'kw-architecture',
    priority: 75,
    confidence: 0.88,
    intent: 'ARCHITECTURE',
    match: (f) => f.keywords.architecture,
  },
  {
    name: 'kw-refactor',
    priority: 75,
    confidence: 0.9,
    intent: 'REFACTOR',
    match: (f) => f.keywords.refactor,
  },
  {
    name: 'kw-debug',
    priority: 70,
    confidence: 0.9,
    intent: 'DEBUG',
    match: (f) => f.keywords.bug || f.keywords.fix,
  },
  {
    name: 'kw-debug-terminal',
    priority: 68,
    confidence: 0.85,
    intent: 'DEBUG',
    match: (f) => f.hasTerminalOutput && (f.keywords.bug || f.keywords.fix),
  },
  {
    name: 'kw-test',
    priority: 65,
    confidence: 0.85,
    intent: 'TEST',
    match: (f) => f.keywords.test,
  },
  {
    name: 'kw-document',
    priority: 60,
    confidence: 0.85,
    intent: 'DOCUMENTATION',
    match: (f) => f.keywords.document || f.keywords.commit,
  },
  {
    name: 'kw-explain',
    priority: 55,
    confidence: 0.85,
    intent: 'EXPLAIN',
    match: (f) => f.keywords.explain,
  },
  {
    name: 'kw-search',
    priority: 50,
    confidence: 0.8,
    intent: 'SEARCH',
    match: (f) => f.keywords.search,
  },
  {
    name: 'kw-docker-k8s',
    priority: 48,
    confidence: 0.75,
    intent: 'TERMINAL',
    match: (f) => f.keywords.docker || f.keywords.kubernetes,
  },
  {
    name: 'multi-file-edit',
    priority: 45,
    confidence: 0.7,
    intent: 'REFACTOR',
    match: (f) => f.openFileCount >= 3 && f.mode === 'chat' && f.containsCode,
  },
];

export function applyIntentRules(features: RouteFeatures): IntentClassification {
  const sorted = [...INTENT_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (rule.match(features)) {
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        matchedRule: rule.name,
      };
    }
  }
  return {
    intent: 'UNKNOWN',
    confidence: 0.3,
    matchedRule: 'default',
  };
}
