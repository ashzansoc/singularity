/**
 * Pattern 1 mid-conversation model switching with conversation affinity
 * and escalate-before-stream (Singularity_Model_Switching_Architecture).
 */

import { tierIndex, type Tier } from './types.js';

export interface TurnRouteCandidate {
  modelId: string;
  provider: string;
  tier: string;
  subTier: string;
  intent: string;
  confidence: number;
  /** Estimated input tokens for this turn's assembled prompt. */
  contextTokens?: number;
}

export interface ConversationTurnState {
  conversationId: string;
  turnCount: number;
  modelId: string;
  provider: string;
  tier: string;
  subTier: string;
  intent: string;
  confidence: number;
  /** Cumulative estimated prompt tokens seen in this conversation. */
  estimatedContextTokens: number;
  lastPromptHash: string;
}

export type SwitchAction = 'stay' | 'switch' | 'escalate';

export interface SwitchDecision {
  action: SwitchAction;
  /** Model to execute with (after affinity / escalate). */
  modelId: string;
  provider: string;
  tier: string;
  subTier: string;
  intent: string;
  confidence: number;
  reason: string;
  /** True when staying preserves provider prompt-cache opportunity. */
  preservesProviderCache: boolean;
  /** Estimated tokens that can reuse provider cache if we stay. */
  cacheReuseTokens: number;
}

const LARGE_CONTEXT_TOKENS = 24_000;
/** Only accept a model pick when confidence is clearly up; otherwise escalate. */
export const MIN_ACCEPT_CONFIDENCE = 0.75;
const MIN_TIER_JUMP_TO_SWITCH = 1;

export function providerOf(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash > 0 ? modelId.slice(0, slash).toLowerCase() : 'unknown';
}

export function parseTier(tier: string): Tier {
  const m = tier.toUpperCase().match(/T([0-6])/);
  if (m) {
    return `T${m[1]}` as Tier;
  }
  return 'T1';
}

/**
 * Escalate-before-stream: bump tier when confidence is low so we never
 * stream a cheap answer then restart mid-generation.
 */
export function escalateCandidateIfNeeded(
  candidate: TurnRouteCandidate,
  escalateModelId: (from: TurnRouteCandidate) => TurnRouteCandidate | undefined,
): { candidate: TurnRouteCandidate; escalated: boolean; reason?: string } {
  if (candidate.confidence >= MIN_ACCEPT_CONFIDENCE) {
    return { candidate, escalated: false };
  }
  const next = escalateModelId(candidate);
  if (!next || next.modelId === candidate.modelId) {
    return { candidate, escalated: false, reason: 'no-escalate-target' };
  }
  return {
    candidate: { ...next, confidence: Math.max(next.confidence, MIN_ACCEPT_CONFIDENCE) },
    escalated: true,
    reason: `low_confidence:${candidate.confidence.toFixed(2)}`,
  };
}

/**
 * Decide whether to stay on the conversation's current model or switch
 * for this turn. Conversation history stays in Singularity either way;
 * only model/provider/pricing change on switch.
 */
export function decideConversationSwitch(
  prev: ConversationTurnState | undefined,
  candidate: TurnRouteCandidate,
): SwitchDecision {
  const provider = candidate.provider || providerOf(candidate.modelId);
  const ctx = candidate.contextTokens ?? prev?.estimatedContextTokens ?? 0;

  if (!prev || prev.turnCount === 0) {
    return {
      action: 'switch',
      modelId: candidate.modelId,
      provider,
      tier: candidate.tier,
      subTier: candidate.subTier,
      intent: candidate.intent,
      confidence: candidate.confidence,
      reason: 'first-turn',
      preservesProviderCache: false,
      cacheReuseTokens: 0,
    };
  }

  if (prev.modelId === candidate.modelId) {
    return {
      action: 'stay',
      modelId: prev.modelId,
      provider: prev.provider,
      tier: prev.tier,
      subTier: prev.subTier,
      intent: candidate.intent,
      confidence: candidate.confidence,
      reason: 'same-model',
      preservesProviderCache: true,
      cacheReuseTokens: ctx,
    };
  }

  const prevTier = parseTier(prev.tier);
  const nextTier = parseTier(candidate.tier);
  const delta = tierIndex(nextTier) - tierIndex(prevTier);
  const sameProvider = prev.provider === provider;
  const intentChanged = prev.intent !== candidate.intent && candidate.intent !== 'UNKNOWN';
  const largeContext = ctx >= LARGE_CONTEXT_TOKENS;

  // Downgrade when the new turn is trivially cheaper (save tokens/cost).
  if (delta <= -MIN_TIER_JUMP_TO_SWITCH && (candidate.intent === 'UNKNOWN' || candidate.intent === 'AUTOCOMPLETE' || nextTier === 'T0')) {
    return {
      action: 'switch',
      modelId: candidate.modelId,
      provider,
      tier: candidate.tier,
      subTier: candidate.subTier,
      intent: candidate.intent,
      confidence: candidate.confidence,
      reason: 'cost-downshift',
      preservesProviderCache: false,
      cacheReuseTokens: 0,
    };
  }

  // Upgrade when quality needs clearly improve.
  if (delta >= MIN_TIER_JUMP_TO_SWITCH) {
    return {
      action: 'switch',
      modelId: candidate.modelId,
      provider,
      tier: candidate.tier,
      subTier: candidate.subTier,
      intent: candidate.intent,
      confidence: candidate.confidence,
      reason: intentChanged ? 'intent-upgrade' : 'tier-upgrade',
      preservesProviderCache: false,
      cacheReuseTokens: 0,
    };
  }

  // Affinity: large prompt + same provider + small quality delta → stay to keep cache.
  if (sameProvider && largeContext && Math.abs(delta) < MIN_TIER_JUMP_TO_SWITCH) {
    return {
      action: 'stay',
      modelId: prev.modelId,
      provider: prev.provider,
      tier: prev.tier,
      subTier: prev.subTier,
      intent: candidate.intent,
      confidence: candidate.confidence,
      reason: 'affinity-cache',
      preservesProviderCache: true,
      cacheReuseTokens: ctx,
    };
  }

  // Intent changed within same band on a different provider → switch (Pattern 1).
  if (intentChanged || !sameProvider) {
    return {
      action: 'switch',
      modelId: candidate.modelId,
      provider,
      tier: candidate.tier,
      subTier: candidate.subTier,
      intent: candidate.intent,
      confidence: candidate.confidence,
      reason: intentChanged ? 'intent-change' : 'provider-change',
      preservesProviderCache: false,
      cacheReuseTokens: 0,
    };
  }

  // Same provider, similar tier, no strong reason → stay (token/cache save).
  return {
    action: 'stay',
    modelId: prev.modelId,
    provider: prev.provider,
    tier: prev.tier,
    subTier: prev.subTier,
    intent: candidate.intent,
    confidence: candidate.confidence,
    reason: 'affinity-stable',
    preservesProviderCache: true,
    cacheReuseTokens: Math.floor(ctx * 0.5),
  };
}

export function applySwitchToState(
  prev: ConversationTurnState | undefined,
  conversationId: string,
  decision: SwitchDecision,
  promptHash: string,
  contextTokens: number,
): ConversationTurnState {
  return {
    conversationId,
    turnCount: (prev?.turnCount ?? 0) + 1,
    modelId: decision.modelId,
    provider: decision.provider,
    tier: decision.tier,
    subTier: decision.subTier,
    intent: decision.intent,
    confidence: decision.confidence,
    estimatedContextTokens: contextTokens,
    lastPromptHash: promptHash,
  };
}
