/**
 * Brain configuration — independent of user-facing chat model selection.
 */

import {
  DEFAULT_BRAIN_CONFIG,
  type BackgroundLevel,
  type BrainConfig,
  type UltrathinkSetting,
} from './types.js';

export type BrainConfigPartial = {
  enabled?: boolean;
  model?: Partial<BrainConfig['model']>;
  reasoning?: Partial<BrainConfig['reasoning']>;
  contextLimit?: number;
  maxBackgroundCallsPerDay?: number;
  maxTokensPerCall?: number;
  idleMs?: number;
  backgroundLevel?: BackgroundLevel;
  ultrathink?: UltrathinkSetting;
  dailyBudgetUsd?: number;
  estimatedUsdPer1kTokens?: number;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Merge VS Code / host settings with env fallbacks into a BrainConfig. */
export function resolveBrainConfig(partial?: BrainConfigPartial): BrainConfig {
  const base = structuredClone(DEFAULT_BRAIN_CONFIG);
  const p = partial ?? {};

  base.enabled = p.enabled ?? base.enabled;
  base.model = {
    provider: 'openai-compatible',
    baseUrl:
      p.model?.baseUrl
      || env('SINGULARITY_BRAIN_BASE_URL')
      || env('SINGULARITY_DECISION_BASE_URL')
      || env('OPENROUTER_BASE_URL')
      || base.model.baseUrl,
    apiKey:
      p.model?.apiKey
      || env('SINGULARITY_BRAIN_API_KEY')
      || env('SINGULARITY_DECISION_API_KEY')
      || env('OPENROUTER_API_KEY')
      || base.model.apiKey,
    model:
      p.model?.model
      || env('SINGULARITY_BRAIN_MODEL')
      || env('SINGULARITY_DECISION_MODEL')
      || base.model.model,
    timeoutMs: p.model?.timeoutMs ?? Number(env('SINGULARITY_BRAIN_TIMEOUT_MS') ?? base.model.timeoutMs),
  };
  base.reasoning = {
    default: p.reasoning?.default ?? env('SINGULARITY_BRAIN_REASONING') ?? base.reasoning.default,
    ultrathink: p.reasoning?.ultrathink ?? env('SINGULARITY_BRAIN_ULTRATHINK_REASONING') ?? base.reasoning.ultrathink,
  };
  base.contextLimit = p.contextLimit ?? Number(env('SINGULARITY_BRAIN_CONTEXT_LIMIT') ?? base.contextLimit);
  base.maxBackgroundCallsPerDay = p.maxBackgroundCallsPerDay
    ?? Number(env('SINGULARITY_BRAIN_MAX_CALLS_PER_DAY') ?? base.maxBackgroundCallsPerDay);
  base.maxTokensPerCall = p.maxTokensPerCall ?? Number(env('SINGULARITY_BRAIN_MAX_TOKENS') ?? base.maxTokensPerCall);
  base.idleMs = p.idleMs ?? Number(env('SINGULARITY_BRAIN_IDLE_MS') ?? base.idleMs);
  base.backgroundLevel = p.backgroundLevel ?? (env('SINGULARITY_BRAIN_BACKGROUND') as BackgroundLevel | undefined) ?? base.backgroundLevel;
  base.ultrathink = p.ultrathink ?? (env('SINGULARITY_BRAIN_ULTRATHINK') as UltrathinkSetting | undefined) ?? base.ultrathink;
  base.dailyBudgetUsd = p.dailyBudgetUsd ?? Number(env('SINGULARITY_BRAIN_DAILY_BUDGET_USD') ?? base.dailyBudgetUsd);
  base.estimatedUsdPer1kTokens = p.estimatedUsdPer1kTokens ?? base.estimatedUsdPer1kTokens;

  if (base.backgroundLevel === 'low') {
    base.maxBackgroundCallsPerDay = Math.min(base.maxBackgroundCallsPerDay, 12);
    base.idleMs = Math.max(base.idleMs, 15 * 60_000);
  } else if (base.backgroundLevel === 'high') {
    base.maxBackgroundCallsPerDay = Math.max(base.maxBackgroundCallsPerDay, 96);
  }

  return base;
}

export function brainModelConfigured(cfg: BrainConfig): boolean {
  return Boolean(cfg.enabled && cfg.model.apiKey && cfg.model.baseUrl && cfg.model.model);
}
