import { describe, expect, it } from 'vitest';
import {
  applyDeepSeekUsage,
  applyNeuralRelayResult,
  averageContextReduction,
  compactTokenCount,
  cumulativeDeepSeekRate,
  cumulativeRelayRate,
  emptyCacheStatusSnapshot,
  formatDeepSeekCacheBar,
  formatNeuralRelayBar,
  formatRatePercent,
  formatNeuralRelayRequestStatus,
  formatRequestTelemetryDebug,
  formatSavedBar,
  setPhase,
} from '../src/metrics/cacheStatus.js';

describe('DeepSeek provider cache vs Neural Relay context hits', () => {
  it('does not show 0% when the provider omitted cache fields', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 1000,
      outputTokens: 10,
      cacheReported: false,
    });
    expect(cumulativeDeepSeekRate(snap)).toBeUndefined();
    expect(formatRatePercent(cumulativeDeepSeekRate(snap))).toBe('—');
    expect(formatDeepSeekCacheBar(snap)).toContain('DeepSeek Cache —');
    expect(snap.last?.deepseek.cacheReported).toBe(false);
  });

  it('shows 0% only when the provider reported zero cache-read tokens', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheReported: true,
    });
    expect(cumulativeDeepSeekRate(snap)).toBe(0);
    expect(formatDeepSeekCacheBar(snap)).toContain('DeepSeek Cache 0%');
  });

  it('computes DeepSeek cache rate from provider cache-read / total input', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 1_000_000,
      outputTokens: 1,
      cacheReadTokens: 820_000,
      cacheReported: true,
    });
    expect(snap.last?.deepseek.cacheHitRate).toBeCloseTo(0.82);
    expect(formatDeepSeekCacheBar(snap)).toContain('DeepSeek Cache 82%');
  });

  it('does not increment Neural Relay hits from a DeepSeek cache hit', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 80,
      cacheReported: true,
    });
    expect(snap.neuralRelay.requests).toBe(0);
    expect(snap.neuralRelay.hits).toBe(0);
    expect(cumulativeRelayRate(snap)).toBeUndefined();
    expect(formatNeuralRelayBar(snap)).toContain('Neural Relay —');
  });

  it('does not increment DeepSeek cache from a Neural Relay context hit', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: true,
      candidateFiles: 42,
      selectedFiles: 6,
      contextTokensBefore: 500_000,
      contextTokensAfter: 31_000,
      contextReduction: 93.8,
      model: 'nvidia/nemotron-3-nano-30b-a3b:free',
      tokensPerSecond: 74,
    });
    expect(snap.deepseek.reportedTurns).toBe(0);
    expect(cumulativeDeepSeekRate(snap)).toBeUndefined();
    expect(snap.neuralRelay.hits).toBe(1);
    expect(snap.neuralRelay.requests).toBe(1);
    expect(formatNeuralRelayBar(snap)).toContain('Neural Relay 100%');
    expect(averageContextReduction(snap)).toBeCloseTo(0.938);
    expect(formatRatePercent(averageContextReduction(snap))).not.toBe(
      formatRatePercent(cumulativeRelayRate(snap)),
    );
  });

  it('allows both optimizations on the same request', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY_ITERATIVE',
      usedRelay: true,
      candidateFiles: 10,
      selectedFiles: 4,
      contextTokensBefore: 100_000,
      contextTokensAfter: 10_000,
      contextReduction: 90,
    });
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-pro-0813',
      promptTokens: 10_000,
      outputTokens: 20,
      cacheReadTokens: 7_600,
      cacheReported: true,
    });
    expect(formatDeepSeekCacheBar(snap)).toContain('76%');
    expect(formatNeuralRelayBar(snap)).toContain('100%');
    expect(snap.last?.deepseek.cacheHit).toBe(true);
    expect(snap.last?.neuralRelay.contextHit).toBe(true);
  });

  it('records Neural Relay fallback without a DeepSeek cache change', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: false,
      fallbackReason: 'nemotron_unavailable',
      candidateFiles: 10,
      selectedFiles: 0,
      contextTokensBefore: 1000,
      contextTokensAfter: 1000,
    });
    expect(snap.neuralRelay.misses).toBe(1);
    expect(snap.neuralRelay.hits).toBe(0);
    expect(snap.phase).toBe('Fallback');
    expect(formatNeuralRelayBar(snap, true)).toContain('Fallback');
    expect(snap.deepseek.reportedTurns).toBe(0);
  });

  it('ignores Nemotron usage when applying DeepSeek cache', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyDeepSeekUsage(snap, {
      modelId: 'nvidia/nemotron-3-nano-30b-a3b:free',
      promptTokens: 800,
      outputTokens: 120,
      cacheReadTokens: 0,
      cacheReported: true,
    });
    expect(snap.deepseek.reportedTurns).toBe(0);
    expect(cumulativeDeepSeekRate(snap)).toBeUndefined();
  });

  it('does not count disabled or BASELINE relay as a request', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: false,
      mode: 'BASELINE',
      usedRelay: false,
      candidateFiles: 0,
      selectedFiles: 0,
      contextTokensBefore: 0,
      contextTokensAfter: 0,
    });
    expect(snap.neuralRelay.requests).toBe(0);
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'BASELINE',
      usedRelay: false,
      candidateFiles: 0,
      selectedFiles: 0,
      contextTokensBefore: 100,
      contextTokensAfter: 100,
    });
    expect(snap.neuralRelay.requests).toBe(0);
  });

  it('counts invalid_json recovery as a Neural Relay hit when files are selected', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: true,
      fallbackReason: 'invalid_json',
      candidateFiles: 1,
      selectedFiles: 1,
      contextTokensBefore: 2792,
      contextTokensAfter: 1393,
      contextReduction: 50.1,
      model: 'nvidia/nemotron-3-nano-30b-a3b:free',
    });
    expect(snap.neuralRelay.hits).toBe(1);
    expect(snap.last?.neuralRelay.contextHit).toBe(true);
    expect(formatNeuralRelayRequestStatus(snap.last!.neuralRelay)).toBe(
      'HIT (invalid_json)',
    );
    const debug = formatRequestTelemetryDebug(snap);
    expect(debug).toContain('HIT (invalid_json)');
    expect(debug).toContain('invalid_json');
  });

  it('keeps hit rate independent of context reduction', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: true,
      candidateFiles: 8,
      selectedFiles: 2,
      contextTokensBefore: 200,
      contextTokensAfter: 100,
      contextReduction: 50,
    });
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: false,
      fallbackReason: 'low_confidence',
      candidateFiles: 8,
      selectedFiles: 8,
      contextTokensBefore: 200,
      contextTokensAfter: 200,
      contextReduction: 0,
    });
    expect(cumulativeRelayRate(snap)).toBeCloseTo(0.5);
    expect(formatNeuralRelayBar(snap)).toContain('Neural Relay 50%');
  });

  it('formats saved tokens from Neural Relay, not DeepSeek cache', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 1_000_000,
      outputTokens: 1,
      cacheReadTokens: 900_000,
      cacheReported: true,
    });
    expect(formatSavedBar(snap)).toBeUndefined();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: true,
      candidateFiles: 5,
      selectedFiles: 2,
      contextTokensBefore: 42_800_000,
      contextTokensAfter: 0,
      contextReduction: 100,
    });
    expect(formatSavedBar(snap)).toContain('42.8M');
    expect(compactTokenCount(31_000)).toBe('31K');
  });

  it('debug dump names both systems separately', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: true,
      candidateFiles: 4,
      selectedFiles: 4,
      contextTokensBefore: 512_000,
      contextTokensAfter: 34_000,
      contextReduction: 93.4,
      model: 'nvidia/nemotron-3-nano-30b-a3b:free',
    });
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 520_000,
      outputTokens: 10,
      cacheReadTokens: 410_000,
      cacheReported: true,
    });
    const debug = formatRequestTelemetryDebug(snap);
    expect(debug).toContain('Neural Relay');
    expect(debug).toContain('HIT');
    expect(debug).toContain('DeepSeek Cache');
    expect(debug).not.toContain('Nemotron Cache Hit');
  });

  it('live DeepSeek phase does not reuse Neural Relay hit wording for cache', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = applyNeuralRelayResult(snap, {
      enabled: true,
      mode: 'NEURAL_RELAY',
      usedRelay: true,
      candidateFiles: 4,
      selectedFiles: 4,
      contextTokensBefore: 10,
      contextTokensAfter: 2,
      contextReduction: 80,
    });
    snap = setPhase(snap, 'DeepSeek', 'DeepSeek → Coding…');
    expect(formatDeepSeekCacheBar(snap, true)).toContain('DeepSeek → Coding…');
    expect(formatNeuralRelayBar(snap, true)).toContain('Neural Relay');
    expect(formatDeepSeekCacheBar(snap, true)).not.toContain('Neural Relay');
  });

  it('does not overwrite Verifying with Complete when DeepSeek usage arrives', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = setPhase(snap, 'Verifying', 'Verifier → Running tests');
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 720,
      cacheReported: true,
    });
    expect(snap.phase).toBe('Verifying');
    expect(formatDeepSeekCacheBar(snap, true)).toContain('Verifier → Running tests');
    expect(snap.last?.deepseek.cacheHitRate).toBeCloseTo(0.72);
  });

  it('shows last-request DeepSeek cache hit while coding', () => {
    let snap = emptyCacheStatusSnapshot();
    snap = setPhase(snap, 'DeepSeek', 'DeepSeek → Coding…');
    snap = applyDeepSeekUsage(snap, {
      modelId: 'deepseek/deepseek-v4-flash-0731',
      promptTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 720,
      cacheReported: true,
    });
    expect(snap.phase).toBe('DeepSeek');
    expect(formatDeepSeekCacheBar(snap, true)).toContain('DeepSeek Cache → 72% hit');
  });
});
