/**
 * Deterministic attention scoring — infrastructure, not an AI agent.
 */

import {
  DEFAULT_ATTENTION_THRESHOLDS,
  type AttentionDecision,
  type AttentionScore,
  type AttentionThresholds,
  type BackgroundLevel,
  type RuntimeEvent,
  type UltrathinkSetting,
} from './types.js';

const KIND_WEIGHT: Record<string, number> = {
  css_edit: 0.05,
  format: 0.05,
  chat_trivial: 0.08,
  file_save: 0.25,
  chat: 0.4,
  dependency: 0.55,
  decision: 0.85,
  architecture: 0.9,
  test_failure: 0.92,
  production_failure: 0.98,
  repeated_failure: 0.95,
  new_project: 0.8,
  major_refactor: 0.82,
  learning: 0.75,
  commit: 0.45,
  test_success: 0.35,
  project_switch: 0.5,
  idle_reflection: 0.65,
  sync: 0.55,
  user_feedback: 0.7,
};

export function scoreAttention(
  event: RuntimeEvent,
  opts?: {
    thresholds?: AttentionThresholds;
    backgroundLevel?: BackgroundLevel;
    ultrathink?: UltrathinkSetting;
    recentSimilarCount?: number;
  },
): AttentionScore {
  const thresholds = opts?.thresholds ?? DEFAULT_ATTENTION_THRESHOLDS;
  const kind = event.kind || 'chat';
  let score = KIND_WEIGHT[kind] ?? 0.35;

  const text = (event.text ?? '').toLowerCase();
  if (/decided|architecture|migrat|instead of|tradeoff/.test(text)) {
    score = Math.max(score, 0.82);
  }
  if (/fail(ed|ure)|error|crash|outage|incident/.test(text)) {
    score = Math.max(score, 0.88);
  }
  if (/^\s*(hi|hello|thanks|ok|continue)\b/.test(text) && text.length < 40) {
    score = Math.min(score, 0.08);
  }
  if (/\.(css|scss|less)\b/.test(event.sourceRef ?? '') || kind === 'css_edit') {
    score = Math.min(score, 0.1);
  }
  if ((opts?.recentSimilarCount ?? 0) >= 3) {
    score = Math.min(1, score + 0.15);
  }

  if (opts?.backgroundLevel === 'low') {
    score *= 0.75;
  } else if (opts?.backgroundLevel === 'high') {
    score = Math.min(1, score * 1.1);
  }

  let decision: AttentionDecision = 'IGNORE';
  let reason = 'below store threshold';
  if (score >= thresholds.ultrathink) {
    decision = opts?.ultrathink === 'off' ? 'REFLECT' : 'ULTRATHINK';
    reason = 'high-signal event warrants deep reasoning';
  } else if (score >= thresholds.reflect) {
    decision = 'REFLECT';
    reason = 'meaningful pattern — wake Brain LLM';
  } else if (score >= thresholds.consolidate) {
    decision = 'CONSOLIDATE';
    reason = 'durable enough for local consolidation';
  } else if (score >= thresholds.store) {
    decision = 'STORE';
    reason = 'worth remembering without LLM';
  }

  if (decision === 'ULTRATHINK' && opts?.ultrathink === 'manual') {
    decision = 'REFLECT';
    reason = 'ultrathink manual-only; reflect instead';
  }

  return { score, decision, reason };
}
