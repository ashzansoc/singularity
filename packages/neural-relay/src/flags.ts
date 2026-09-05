/**
 * Feature flags for Neural Relay.
 * Default ON — Nemotron resolves project context for DeepSeek coding.
 * Disable with SINGULARITY_NEURAL_RELAY=0 or the VS Code setting.
 */

export type NeuralRelayMode =
  | 'BASELINE'
  | 'NEURAL_RELAY'
  | 'NEURAL_RELAY_ITERATIVE';

export interface NeuralRelayFlags {
  enabled: boolean;
  mode: NeuralRelayMode;
  model: string;
  confidenceHigh: number;
  confidenceLow: number;
  candidateLimit: number;
  /** Max files surfaced to the coding model — lower = more cache reuse. */
  maxRelayFiles: number;
  maxDeepSeekContextTokens: number;
  timeoutMs: number;
  codingModel: string;
}

/** Free Nemotron on OpenRouter — fast/cheap context intelligence only. */
export const DEFAULT_NEURAL_RELAY_MODEL =
  'nvidia/nemotron-3-nano-30b-a3b:free' as const;

export const DEFAULT_CODING_MODEL = 'deepseek/deepseek-v4-flash-0731' as const;

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return !/^(0|false|off|no)$/i.test(v.trim());
}

function envNum(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function envMode(defaultValue: NeuralRelayMode): NeuralRelayMode {
  const v = (process.env.NEURAL_RELAY_MODE ?? '').trim().toUpperCase();
  if (
    v === 'BASELINE' ||
    v === 'NEURAL_RELAY' ||
    v === 'NEURAL_RELAY_ITERATIVE'
  ) {
    return v;
  }
  return defaultValue;
}

/**
 * Enabled unless SINGULARITY_NEURAL_RELAY / NEURAL_RELAY_ENABLED is 0/false/off.
 */
export function isNeuralRelayEnabled(): boolean {
  if (process.env.SINGULARITY_NEURAL_RELAY !== undefined && process.env.SINGULARITY_NEURAL_RELAY !== '') {
    return envBool('SINGULARITY_NEURAL_RELAY', true);
  }
  if (process.env.NEURAL_RELAY_ENABLED !== undefined && process.env.NEURAL_RELAY_ENABLED !== '') {
    return envBool('NEURAL_RELAY_ENABLED', true);
  }
  return true;
}

export function readNeuralRelayFlags(
  overrides?: Partial<NeuralRelayFlags>,
): NeuralRelayFlags {
  const enabled = isNeuralRelayEnabled();
  const base: NeuralRelayFlags = {
    enabled,
    mode: envMode(enabled ? 'NEURAL_RELAY_ITERATIVE' : 'BASELINE'),
    model:
      process.env.NEURAL_RELAY_MODEL?.trim() || DEFAULT_NEURAL_RELAY_MODEL,
    confidenceHigh: envNum('NEURAL_RELAY_CONFIDENCE_HIGH', 0.65),
    confidenceLow: envNum('NEURAL_RELAY_CONFIDENCE_LOW', 0.25),
    candidateLimit: envNum('NEURAL_RELAY_CANDIDATE_LIMIT', 40),
    maxRelayFiles: envNum('NEURAL_RELAY_MAX_FILES', 8),
    maxDeepSeekContextTokens: envNum(
      'NEURAL_RELAY_MAX_DEEPSEEK_CONTEXT_TOKENS',
      24_000,
    ),
    timeoutMs: envNum('NEURAL_RELAY_TIMEOUT_MS', 20_000),
    codingModel:
      process.env.NEURAL_RELAY_CODING_MODEL?.trim() || DEFAULT_CODING_MODEL,
  };
  const merged = { ...base, ...overrides };
  if (!merged.enabled && overrides?.mode === undefined) {
    merged.mode = 'BASELINE';
  }
  return merged;
}
