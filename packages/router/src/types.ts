/** Model capability / cost tiers from the Singularity routing architecture. */
export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';

/** Sub-slot within a tier (T0.1 … T6.5). */
export type SubTier =
  | 'T0.1' | 'T0.2' | 'T0.3' | 'T0.4' | 'T0.5'
  | 'T1.1' | 'T1.2' | 'T1.3' | 'T1.4' | 'T1.5'
  | 'T2.1' | 'T2.2' | 'T2.3' | 'T2.4' | 'T2.5'
  | 'T3.1' | 'T3.2' | 'T3.3' | 'T3.4' | 'T3.5'
  | 'T4.1' | 'T4.2' | 'T4.3' | 'T4.4' | 'T4.5'
  | 'T5.1' | 'T5.2' | 'T5.3' | 'T5.4' | 'T5.5'
  | 'T6.1' | 'T6.2' | 'T6.3' | 'T6.4' | 'T6.5';

/** Classified user intents for routing. */
export type Intent =
  | 'AUTOCOMPLETE'
  | 'INLINE_EDIT'
  | 'EXPLAIN'
  | 'DEBUG'
  | 'REVIEW'
  | 'TEST'
  | 'SEARCH'
  | 'TERMINAL'
  | 'AGENT'
  | 'DOCUMENTATION'
  | 'REFACTOR'
  | 'ARCHITECTURE'
  | 'UNKNOWN';

export type InteractionMode = 'chat' | 'agent' | 'inline' | 'autocomplete' | 'terminal';

export type ProviderKind = 'openrouter' | 'local' | 'direct';

export type ToolPermissions = 'none' | 'read' | 'edit' | 'agent';

export type FallbackReason = 'timeout' | 'low_quality' | 'tool_failure' | 'provider_error' | 'quality_score_low';

export type SpeedClass = 'ultra_fast' | 'fast' | 'balanced' | 'premium';
export type CostClass = 'very_low' | 'low' | 'medium' | 'high';
export type ContextWindowClass = '128k' | '256k' | '1m';
export type ModelVendor =
  | 'alibaba'
  | 'deepseek'
  | 'google'
  | 'zai'
  | 'moonshotai'
  | 'poolside'
  | 'mistral'
  | 'xai'
  | 'openai'
  | 'anthropic'
  | 'sakana'
  | 'local';

/** Input context collected from the IDE / client before routing. */
export interface RouteContext {
  prompt: string;
  mode: InteractionMode;
  language?: string;
  openFileCount?: number;
  repoFileCount?: number;
  selectionLength?: number;
  contextTokens?: number;
  hasImages?: boolean;
  hasTerminalOutput?: boolean;
  requiresTools?: boolean;
  requiresJson?: boolean;
  requiresStreaming?: boolean;
  /** Prefer these model ids when scoring (0–1 boost applied via preference weight). */
  userPreferenceModelIds?: string[];
  /**
   * Optional specialty lane override (e.g. runtime worker pins `frontend`).
   * Frontend lane is owned by Qwen 3.6 27B.
   */
  specialty?: import('./specialty.js').SpecialtyLane;
  /**
   * Caller-forced model id (e.g. workers/retries). When set, the async
   * Nemotron specialty classification is skipped — the lane decision cannot
   * change the outcome.
   */
  modelId?: string;
  /** Caller-forced minimum tier; also suppresses the classification hop. */
  preferredTier?: import('./types.js').Tier;
}

/** Extracted features used by intent classification and scoring. */
export interface RouteFeatures {
  promptLength: number;
  promptCharCount: number;
  containsCode: boolean;
  estimatedOutputTokens: number;
  contextTokens: number;
  mode: InteractionMode;
  hasImages: boolean;
  hasTerminalOutput: boolean;
  requiresTools: boolean;
  requiresJson: boolean;
  requiresStreaming: boolean;
  openFileCount: number;
  repoFileCount: number;
  selectionLength: number;
  language?: string;
  keywords: {
    bug: boolean;
    refactor: boolean;
    explain: boolean;
    test: boolean;
    review: boolean;
    security: boolean;
    docker: boolean;
    kubernetes: boolean;
    git: boolean;
    commit: boolean;
    search: boolean;
    architecture: boolean;
    document: boolean;
    performance: boolean;
    fix: boolean;
    why: boolean;
    plan: boolean;
    migrate: boolean;
    screenshot: boolean;
    frontend: boolean;
    backend: boolean;
    regex: boolean;
    bash: boolean;
    brainstorm: boolean;
    critical: boolean;
  };
}

export interface ModelCapabilities {
  speed: SpeedClass;
  /** Coding strength 1–10. */
  coding: number;
  /** Reasoning strength 1–10. */
  reasoning: number;
  /** Long-context strength 1–10. */
  longContext: number;
  /** Tool-use strength 1–10. */
  toolUse: number;
  cost: CostClass;
  context: ContextWindowClass;
  vision: boolean;
  vendor: ModelVendor;
}

export interface ModelSpec {
  id: string;
  displayName: string;
  provider: ProviderKind;
  tier: Tier;
  subTier: SubTier;
  primaryPurpose: string;
  /** Situations this model should be preferred. */
  callWhen: string[];
  /** Situations that should disqualify / heavily penalize this model. */
  doNotCall: string[];
  capabilities: ModelCapabilities;
  maxContext: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsJson: boolean;
  supportsStreaming: boolean;
  /** USD per 1M input tokens (for relative cost scoring). */
  costPer1MInput: number;
  /** USD per 1M output tokens. */
  costPer1MOutput: number;
  /** Static p50 latency estimate in ms. */
  latencyMsP50: number;
  /** Prior reliability in [0, 1]. */
  reliability: number;
  qualityByIntent: Partial<Record<Intent, number>>;
}

export interface IntentClassification {
  intent: Intent;
  confidence: number;
  matchedRule?: string;
}

export interface ScoredCandidate {
  model: ModelSpec;
  score: number;
  breakdown: {
    quality: number;
    cost: number;
    latency: number;
    reliability: number;
    preference: number;
    callWhen: number;
  };
}

export interface RouteDecision {
  model: ModelSpec;
  tier: Tier;
  subTier: SubTier;
  intent: Intent;
  intentConfidence: number;
  temperature: number;
  maxTokens: number;
  systemPromptHint: string;
  toolPermissions: ToolPermissions;
  score: number;
  candidates: Array<{ modelId: string; score: number; subTier?: SubTier }>;
  fallbackChain: string[];
  fromCache: boolean;
  /** Specialty lane that influenced routing (frontend → Qwen 3.6 27B). */
  specialty?: import('./specialty.js').SpecialtyLane;
}

export interface RouteDecisionCache {
  get(key: string): RouteDecision | undefined;
  set(key: string, decision: RouteDecision): void;
  clear(): void;
}

export interface RoutingEngineConfig {
  models?: ModelSpec[];
  cacheTtlMs?: number;
  /** Optional external route cache (e.g. @singularity/cache RoutingCache adapter). */
  routeCache?: RouteDecisionCache;
  userPreferenceModelIds?: string[];
  onTelemetry?: (event: TelemetryEvent) => void;
  /**
   * Nemotron specialty classifier config (used by routeAsync).
   * Understands intent beyond keywords; falls back to heuristics on timeout.
   */
  specialtyClassifier?: import('./specialtyClassifier.js').SpecialtyClassifierConfig;
}

export interface TelemetryEvent {
  type: 'route' | 'cache_hit' | 'escalate' | 'filter' | 'intent';
  timestamp: number;
  payload: Record<string, unknown>;
}

export const TIERS: readonly Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'] as const;

export function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

export function nextTier(tier: Tier): Tier | undefined {
  const i = tierIndex(tier);
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : undefined;
}

export function subTierIndex(sub: SubTier): number {
  const [major, minor] = sub.slice(1).split('.').map(Number);
  return (major ?? 0) * 10 + (minor ?? 0);
}

export function contextClassToTokens(ctx: ContextWindowClass): number {
  switch (ctx) {
    case '128k':
      return 128_000;
    case '256k':
      return 256_000;
    case '1m':
      return 1_000_000;
  }
}
