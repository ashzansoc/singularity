import { DEFAULT_CODING_MODEL, DEFAULT_NEURAL_RELAY_MODEL } from '../flags.js';

/** TokenRouter-aligned rates ($ / 1M). Nemotron Nano free = $0. */
export interface ModelTokenPrice {
  inputPer1M: number;
  outputPer1M: number;
  cachePer1M: number;
}

const PRICE: Record<string, ModelTokenPrice> = {
  'nvidia/nemotron-3-nano-30b-a3b:free': { inputPer1M: 0, outputPer1M: 0, cachePer1M: 0 },
  'nvidia/nemotron-3-nano-30b-a3b': { inputPer1M: 0, outputPer1M: 0, cachePer1M: 0 },
  'deepseek/deepseek-v4-flash-0731': {
    inputPer1M: 0.09,
    outputPer1M: 0.18,
    cachePer1M: 0.009,
  },
  'deepseek/deepseek-v4-pro-0813': {
    inputPer1M: 0.55,
    outputPer1M: 2.19,
    cachePer1M: 0.055,
  },
  'deepseek/deepseek-v4-pro': {
    inputPer1M: 0.55,
    outputPer1M: 2.19,
    cachePer1M: 0.055,
  },
};

export function priceFor(modelId: string): ModelTokenPrice {
  const raw = modelId.trim().toLowerCase();
  return (
    PRICE[raw] ??
    PRICE[raw.split('/').pop() ?? ''] ?? {
      inputPer1M: 0.09,
      outputPer1M: 0.18,
      cachePer1M: 0.009,
    }
  );
}

/**
 * Cost in USD for a model call.
 * Cached input tokens are billed at the cache rate (DeepSeek cache reads are
 * ~10x cheaper than fresh input) — this is what makes the relay's stable-prefix
 * cache-reuse premise measurable.
 */
export function costUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number {
  const p = priceFor(modelId);
  const fresh = Math.max(0, inputTokens - cachedInputTokens);
  const cached = Math.min(Math.max(0, cachedInputTokens), Math.max(0, inputTokens));
  return (
    (fresh * p.inputPer1M) / 1_000_000 +
    (cached * p.cachePer1M) / 1_000_000 +
    (Math.max(0, outputTokens) * p.outputPer1M) / 1_000_000
  );
}

export function contextReduction(
  original: number,
  relay: number,
): number {
  if (original <= 0) {
    return 0;
  }
  // Honest reduction — may be negative when the relay sends MORE context than
  // baseline. Clamping to 0 hid real regressions and skewed the benchmark.
  return 1 - relay / original;
}

export { DEFAULT_CODING_MODEL, DEFAULT_NEURAL_RELAY_MODEL };