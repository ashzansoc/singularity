import type { ConfidenceFactors } from './schema.js';

export type ConfidenceAction = 'create_candidate' | 'queue_review' | 'observation';

export function scoreConfidence(factors: ConfidenceFactors): number {
  const weights = {
    explicit_decision: 0.35,
    reasoning_present: 0.25,
    code_evidence: 0.25,
    alternative_discussion: 0.15,
  };
  const raw =
    factors.explicit_decision * weights.explicit_decision +
    factors.reasoning_present * weights.reasoning_present +
    factors.code_evidence * weights.code_evidence +
    factors.alternative_discussion * weights.alternative_discussion;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

export function confidenceAction(confidence: number): ConfidenceAction {
  if (confidence >= 0.9) {
    return 'create_candidate';
  }
  if (confidence >= 0.7) {
    return 'queue_review';
  }
  return 'observation';
}

export function inferFactorsFromText(text: string): ConfidenceFactors {
  const t = text.toLowerCase();
  const explicit = /\b(we (decided|chose|selected|picked)|decision:|we're moving|we are moving)\b/.test(
    t,
  )
    ? 0.95
    : /\b(use|switch to|migrate to|replace .+ with)\b/.test(t)
      ? 0.7
      : 0.2;
  const reasoning = /\b(because|due to|so that|in order to|rationale|reason)\b/.test(t)
    ? 0.9
    : 0.25;
  const alternatives = /\b(instead of|rather than|we rejected|we previously tried|alternative)\b/.test(
    t,
  )
    ? 0.85
    : 0.15;
  const code = /\b(commit|pr\b|pull request|src\/|implemented|migration)\b/.test(t)
    ? 0.8
    : 0.2;
  return {
    explicit_decision: explicit,
    reasoning_present: reasoning,
    code_evidence: code,
    alternative_discussion: alternatives,
  };
}
