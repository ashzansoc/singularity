/**
 * Independent DeepSeek provider-cache vs Neural Relay context-hit metrics.
 * These must never share a counter.
 */

export type RequestPhase =
  | 'Idle'
  | 'Resolving Context'
  | 'Neural Relay'
  | 'Building Context'
  | 'DeepSeek'
  | 'Verifying'
  | 'Expanding Context'
  | 'Complete'
  | 'Error'
  | 'Fallback';

export interface DeepSeekCacheSlice {
  used: boolean;
  inputTokens: number;
  cacheReadTokens: number;
  freshInputTokens: number;
  /** True only when the provider reported cache fields for this request. */
  cacheReported: boolean;
  cacheHit?: boolean;
  cacheHitRate?: number;
  model?: string;
}

export interface NeuralRelaySlice {
  used: boolean;
  contextHit: boolean;
  fallback: boolean;
  fallbackReason?: string;
  candidateFiles: number;
  selectedFiles: number;
  contextTokensBefore: number;
  contextTokensAfter: number;
  /** Token reduction vs baseline corpus — NOT the request hit rate. */
  contextReduction?: number;
  model?: string;
  tokensPerSecond: number;
  nemotronTokens: number;
  testsPassed?: boolean;
  retryCount: number;
  expansionCount: number;
}

export interface RequestTelemetry {
  requestId: string;
  phase: RequestPhase;
  liveLabel?: string;
  deepseek: DeepSeekCacheSlice;
  neuralRelay: NeuralRelaySlice;
  estimatedCost?: number;
  baselineCost?: number;
  savings?: number;
}

export interface DeepSeekCacheTotals {
  /** Turns where the provider explicitly reported cache fields. */
  reportedTurns: number;
  cacheReadTokens: number;
  freshInputTokens: number;
  outputTokens: number;
}

export interface NeuralRelayTotals {
  requests: number;
  hits: number;
  misses: number;
  tokensAvoided: number;
  contextReductionSum: number;
  contextReductionCount: number;
}

export interface CacheStatusSnapshot {
  deepseek: DeepSeekCacheTotals;
  neuralRelay: NeuralRelayTotals;
  last?: RequestTelemetry;
  phase: RequestPhase;
  liveLabel?: string;
}

export function emptyDeepSeekSlice(): DeepSeekCacheSlice {
  return {
    used: false,
    inputTokens: 0,
    cacheReadTokens: 0,
    freshInputTokens: 0,
    cacheReported: false,
  };
}

export function emptyNeuralRelaySlice(): NeuralRelaySlice {
  return {
    used: false,
    contextHit: false,
    fallback: false,
    candidateFiles: 0,
    selectedFiles: 0,
    contextTokensBefore: 0,
    contextTokensAfter: 0,
    tokensPerSecond: 0,
    nemotronTokens: 0,
    retryCount: 0,
    expansionCount: 0,
  };
}

export function emptyCacheStatusSnapshot(): CacheStatusSnapshot {
  return {
    deepseek: {
      reportedTurns: 0,
      cacheReadTokens: 0,
      freshInputTokens: 0,
      outputTokens: 0,
    },
    neuralRelay: {
      requests: 0,
      hits: 0,
      misses: 0,
      tokensAvoided: 0,
      contextReductionSum: 0,
      contextReductionCount: 0,
    },
    phase: 'Idle',
  };
}

export function isDeepSeekModel(modelId?: string): boolean {
  if (!modelId) {
    return true;
  }
  return /deepseek/i.test(modelId);
}

export function isNeuralRelayContextModel(modelId?: string): boolean {
  return /nemotron-3-nano/i.test(modelId ?? '');
}

/**
 * Provider cache rate. Undefined when the provider did not report cache fields.
 * 0 is valid only when reportedTurns / cacheReported is true.
 */
export function deepseekCacheHitRate(
  cacheReadTokens: number,
  totalInputTokens: number,
  reported: boolean,
): number | undefined {
  if (!reported) {
    return undefined;
  }
  if (totalInputTokens <= 0) {
    return undefined;
  }
  return cacheReadTokens / totalInputTokens;
}

export function relayHitRate(hits: number, requests: number): number | undefined {
  if (requests <= 0) {
    return undefined;
  }
  return hits / requests;
}

/** True when relay produced usable file context for DeepSeek (even after Nemotron recovery). */
export function neuralRelayResolved(opts: {
  usedRelay: boolean;
  selectedFiles: number;
  fallbackReason?: string;
}): boolean {
  if (!opts.usedRelay || opts.selectedFiles <= 0) {
    return false;
  }
  if (
    opts.fallbackReason === 'nemotron_unavailable' ||
    opts.fallbackReason === 'disabled'
  ) {
    return false;
  }
  return true;
}

export function formatNeuralRelayRequestStatus(nr: NeuralRelaySlice): string {
  if (!nr.used) {
    return '—';
  }
  if (
    neuralRelayResolved({
      usedRelay: true,
      selectedFiles: nr.selectedFiles,
      fallbackReason: nr.fallbackReason,
    })
  ) {
    return nr.fallbackReason ? `HIT (${nr.fallbackReason})` : 'HIT';
  }
  if (nr.fallback) {
    return 'FALLBACK';
  }
  return 'MISS';
}

export function formatRatePercent(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) {
    return '—';
  }
  return `${Math.round(rate * 100)}%`;
}

export function compactTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return '0';
  }
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const v = n / 1_000_000;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}M`;
}

export function applyDeepSeekUsage(
  snap: CacheStatusSnapshot,
  opts: {
    requestId?: string;
    modelId?: string;
    promptTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheReported: boolean;
  },
): CacheStatusSnapshot {
  const next = cloneSnapshot(snap);
  if (isNeuralRelayContextModel(opts.modelId) || !isDeepSeekModel(opts.modelId)) {
    return next;
  }
  const total = Math.max(0, Math.floor(opts.promptTokens));
  const cached = opts.cacheReported
    ? Math.min(Math.max(0, Math.floor(opts.cacheReadTokens ?? 0)), total)
    : 0;
  const fresh = opts.cacheReported ? Math.max(0, total - cached) : total;
  const rate = deepseekCacheHitRate(cached, total, opts.cacheReported);

  if (opts.cacheReported) {
    next.deepseek.reportedTurns += 1;
    next.deepseek.cacheReadTokens += cached;
    next.deepseek.freshInputTokens += fresh;
  }
  next.deepseek.outputTokens += Math.max(0, Math.floor(opts.outputTokens));

  const last = ensureLast(next, opts.requestId);
  last.deepseek = {
    used: true,
    inputTokens: total,
    cacheReadTokens: opts.cacheReported ? cached : 0,
    freshInputTokens: opts.cacheReported ? fresh : total,
    cacheReported: opts.cacheReported,
    cacheHit: opts.cacheReported ? cached > 0 : undefined,
    cacheHitRate: rate,
    model: opts.modelId,
  };
  const cacheLabel = opts.cacheReported
    ? `DeepSeek Cache → ${formatRatePercent(rate)} hit`
    : undefined;
  if (next.phase !== 'Verifying' && next.phase !== 'Complete' && next.phase !== 'Error') {
    last.phase = 'DeepSeek';
    next.phase = 'DeepSeek';
    next.liveLabel = cacheLabel ?? 'DeepSeek → Coding…';
  }
  last.liveLabel = next.liveLabel;
  return next;
}

export function applyNeuralRelayResult(
  snap: CacheStatusSnapshot,
  opts: {
    requestId?: string;
    enabled: boolean;
    mode?: string;
    usedRelay: boolean;
    fallbackReason?: string;
    candidateFiles: number;
    selectedFiles: number;
    contextTokensBefore: number;
    contextTokensAfter: number;
    contextReduction?: number;
    model?: string;
    tokensPerSecond?: number;
    nemotronTokens?: number;
    testsPassed?: boolean;
    retryCount?: number;
    expansionCount?: number;
    estimatedCost?: number;
    baselineCost?: number;
    /** When false, update last-request details without changing hit/miss totals. */
    countAsRequest?: boolean;
  },
): CacheStatusSnapshot {
  const next = cloneSnapshot(snap);
  const counted =
    (opts.countAsRequest ?? true) && opts.enabled && opts.mode !== 'BASELINE';
  const hit = counted && neuralRelayResolved(opts);
  if (counted) {
    next.neuralRelay.requests += 1;
    if (hit) {
      next.neuralRelay.hits += 1;
    } else {
      next.neuralRelay.misses += 1;
    }
    const avoided = Math.max(0, opts.contextTokensBefore - opts.contextTokensAfter);
    next.neuralRelay.tokensAvoided += avoided;
    if (typeof opts.contextReduction === 'number' && Number.isFinite(opts.contextReduction)) {
      const reduction =
        opts.contextReduction > 1 ? opts.contextReduction / 100 : opts.contextReduction;
      next.neuralRelay.contextReductionSum += reduction;
      next.neuralRelay.contextReductionCount += 1;
    }
  }

  const last = ensureLast(next, opts.requestId);
  last.neuralRelay = {
    used: counted,
    contextHit: hit,
    fallback: Boolean(opts.fallbackReason) || (counted && !opts.usedRelay),
    fallbackReason: opts.fallbackReason,
    candidateFiles: opts.candidateFiles,
    selectedFiles: opts.selectedFiles,
    contextTokensBefore: opts.contextTokensBefore,
    contextTokensAfter: opts.contextTokensAfter,
    contextReduction:
      typeof opts.contextReduction === 'number'
        ? opts.contextReduction > 1
          ? opts.contextReduction / 100
          : opts.contextReduction
        : undefined,
    model: opts.model,
    tokensPerSecond: opts.tokensPerSecond ?? 0,
    nemotronTokens: opts.nemotronTokens ?? 0,
    testsPassed: opts.testsPassed,
    retryCount: opts.retryCount ?? 0,
    expansionCount: opts.expansionCount ?? 0,
  };
  last.estimatedCost = opts.estimatedCost;
  last.baselineCost = opts.baselineCost;
  last.savings =
    opts.baselineCost !== undefined && opts.estimatedCost !== undefined
      ? opts.baselineCost - opts.estimatedCost
      : undefined;
  if (neuralRelayResolved(opts)) {
    last.phase = 'Neural Relay';
    next.phase = 'Neural Relay';
    next.liveLabel =
      opts.selectedFiles > 0
        ? `Neural Relay → ${opts.selectedFiles} files found`
        : 'Neural Relay → Context found';
  } else if (opts.fallbackReason || (counted && !opts.usedRelay)) {
    last.phase = 'Fallback';
    next.phase = 'Fallback';
    next.liveLabel = 'Neural Relay → Fallback';
  }
  return next;
}

export function cumulativeDeepSeekRate(snap: CacheStatusSnapshot): number | undefined {
  const total = snap.deepseek.cacheReadTokens + snap.deepseek.freshInputTokens;
  return deepseekCacheHitRate(
    snap.deepseek.cacheReadTokens,
    total,
    snap.deepseek.reportedTurns > 0,
  );
}

export function cumulativeRelayRate(snap: CacheStatusSnapshot): number | undefined {
  return relayHitRate(snap.neuralRelay.hits, snap.neuralRelay.requests);
}

export function averageContextReduction(snap: CacheStatusSnapshot): number | undefined {
  if (snap.neuralRelay.contextReductionCount <= 0) {
    return undefined;
  }
  return snap.neuralRelay.contextReductionSum / snap.neuralRelay.contextReductionCount;
}

export function formatDeepSeekCacheBar(snap: CacheStatusSnapshot, live?: boolean): string {
  if (live) {
    if (snap.phase === 'Verifying') {
      return `$(sync~spin) ${snap.liveLabel ?? 'Verifier → Running tests'}`;
    }
    if (snap.phase === 'Complete') {
      return `$(check) ${snap.liveLabel ?? 'Complete'}`;
    }
    if (snap.phase === 'Error') {
      return `$(error) ${snap.liveLabel ?? 'Error'}`;
    }
    if (snap.phase === 'DeepSeek') {
      const last = snap.last?.deepseek;
      if (last?.cacheReported && last.cacheHitRate !== undefined) {
        return `$(circle-filled) DeepSeek Cache → ${formatRatePercent(last.cacheHitRate)} hit`;
      }
      return '$(sync~spin) DeepSeek → Coding…';
    }
  }
  const rate = cumulativeDeepSeekRate(snap);
  const icon = rate === undefined ? '$(circle-outline)' : '$(circle-filled)';
  return `${icon} DeepSeek Cache ${formatRatePercent(rate)}`;
}

export function formatNeuralRelayBar(snap: CacheStatusSnapshot, live?: boolean): string {
  if (live) {
    if (snap.phase === 'Resolving Context') {
      return '$(sync~spin) Neural Relay → Finding context…';
    }
    if (snap.phase === 'Building Context') {
      return `$(circle-filled) ${snap.liveLabel ?? 'Neural Relay → Context found'}`;
    }
    if (snap.phase === 'Expanding Context') {
      return '$(sync~spin) Neural Relay → Expanding…';
    }
    if (snap.phase === 'Fallback') {
      return '$(warning) Neural Relay Fallback';
    }
    if (snap.phase === 'Neural Relay' && snap.liveLabel) {
      return `$(circle-filled) ${snap.liveLabel}`;
    }
    if (snap.phase === 'DeepSeek' || snap.phase === 'Verifying') {
      const rate = cumulativeRelayRate(snap);
      if (snap.last?.neuralRelay.contextHit) {
        return `$(check) Neural Relay ${formatRatePercent(rate)}`;
      }
    }
  }
  const rate = cumulativeRelayRate(snap);
  const icon =
    snap.phase === 'Fallback'
      ? '$(warning)'
      : rate === undefined
        ? '$(circle-outline)'
        : '$(circle-filled)';
  return `${icon} Neural Relay ${formatRatePercent(rate)}`;
}

export function formatSavedBar(snap: CacheStatusSnapshot): string | undefined {
  if (snap.neuralRelay.tokensAvoided <= 0) {
    return undefined;
  }
  return `$(arrow-down) ${compactTokenCount(snap.neuralRelay.tokensAvoided)} ctx`;
}

export function formatDeepSeekCacheTooltip(snap: CacheStatusSnapshot): string {
  const last = snap.last?.deepseek;
  const sessionRate = cumulativeDeepSeekRate(snap);
  const sessionTotal = snap.deepseek.cacheReadTokens + snap.deepseek.freshInputTokens;
  const lines = ['DeepSeek Provider Cache', ''];
  if (last?.cacheReported) {
    lines.push(
      `Cache read: ${last.cacheReadTokens.toLocaleString()} tokens`,
      `Fresh input: ${last.freshInputTokens.toLocaleString()} tokens`,
      `Total input: ${last.inputTokens.toLocaleString()} tokens`,
      `Cache read rate: ${formatRatePercent(last.cacheHitRate)}`,
      '',
      'Source: DeepSeek/OpenRouter provider',
      last.model ? `Model: ${last.model}` : '',
      '',
      'Session',
      `  Cache read: ${snap.deepseek.cacheReadTokens.toLocaleString()} tokens`,
      `  Fresh input: ${snap.deepseek.freshInputTokens.toLocaleString()} tokens`,
      `  Total input: ${sessionTotal.toLocaleString()} tokens`,
      `  Cache read rate: ${formatRatePercent(sessionRate)}`,
    );
  } else {
    lines.push(
      `Cache read: ${snap.deepseek.cacheReadTokens.toLocaleString()} tokens`,
      `Fresh input: ${snap.deepseek.freshInputTokens.toLocaleString()} tokens`,
      `Total input: ${sessionTotal.toLocaleString()} tokens`,
      `Cache read rate: ${formatRatePercent(sessionRate)}`,
      `Reported turns: ${snap.deepseek.reportedTurns}`,
      '',
      'Source: DeepSeek/OpenRouter provider',
    );
    if (last?.used && !last.cacheReported) {
      lines.push('', 'Last request did not report provider cache fields (shown as —).');
    }
  }
  lines.push('', 'This is not Neural Relay / context resolution.');
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

export function formatNeuralRelayTooltip(snap: CacheStatusSnapshot): string {
  const last = snap.last?.neuralRelay;
  const hitRate = cumulativeRelayRate(snap);
  const reduction = averageContextReduction(snap);
  const lines = [
    'Singularity Neural Relay',
    '',
    `Context resolutions: ${snap.neuralRelay.hits} / ${snap.neuralRelay.requests}`,
    `Successful resolutions: ${snap.neuralRelay.hits}`,
    `Context misses: ${snap.neuralRelay.misses}`,
    `DeepSeek context avoided: ${compactTokenCount(snap.neuralRelay.tokensAvoided)} tokens`,
    `Context reduction: ${formatRatePercent(reduction)}`,
    `Request hit rate: ${formatRatePercent(hitRate)}`,
  ];
  if (last?.model) {
    lines.push(
      '',
      'Context Intelligence Model',
      'NVIDIA Nemotron 3 Nano 30B A3B',
      `Provider: OpenRouter`,
      `Model: ${last.model}`,
      `Observed throughput: ${last.tokensPerSecond.toFixed(0)} TPS`,
    );
  }
  if (last?.fallback) {
    lines.push(
      '',
      'Context resolution failed.',
      'Falling back to existing DeepSeek context pipeline.',
      last.fallbackReason ? `Reason: ${last.fallbackReason}` : '',
    );
  }
  lines.push('', 'Source: Singularity Context Engine');
  lines.push('This is not a DeepSeek provider cache hit.');
  return lines.filter(Boolean).join('\n');
}

export function formatRequestTelemetryDebug(snap: CacheStatusSnapshot): string {
  const last = snap.last;
  const ds = last?.deepseek ?? emptyDeepSeekSlice();
  const nr = last?.neuralRelay ?? emptyNeuralRelaySlice();
  const dsRate = cumulativeDeepSeekRate(snap);
  const nrRate = cumulativeRelayRate(snap);
  const reduction = nr.contextReduction ?? averageContextReduction(snap);
  const pad = (k: string, v: string) => `${k.padEnd(20)}${v}`;
  return [
    'SINGULARITY REQUEST TELEMETRY',
    '──────────────────────────────────────',
    pad('Request ID', last?.requestId ?? '—'),
    pad('Phase', snap.phase + (snap.liveLabel ? ` · ${snap.liveLabel}` : '')),
    '',
    pad('Neural Relay', formatNeuralRelayRequestStatus(nr)),
    pad('Context Model', nr.model ?? '—'),
    pad('Relay note', nr.fallbackReason ?? '—'),
    pad('Candidate files', String(nr.candidateFiles || '—')),
    pad('Selected files', String(nr.selectedFiles || '—')),
    pad('Context Before', nr.contextTokensBefore ? compactTokenCount(nr.contextTokensBefore) : '—'),
    pad('Context After', nr.contextTokensAfter ? compactTokenCount(nr.contextTokensAfter) : '—'),
    pad('Reduction', formatRatePercent(reduction)),
    pad('Nemotron tokens', nr.nemotronTokens ? compactTokenCount(nr.nemotronTokens) : '—'),
    pad('Nemotron TPS', nr.tokensPerSecond ? nr.tokensPerSecond.toFixed(0) : '—'),
    pad('Session hit rate', formatRatePercent(nrRate)),
    '',
    pad(
      'DeepSeek Cache',
      ds.cacheReported ? (ds.cacheHit ? 'HIT' : 'MISS') : '—',
    ),
    pad('DeepSeek model', ds.model ?? '—'),
    pad('Cache Read', ds.cacheReported ? compactTokenCount(ds.cacheReadTokens) : '—'),
    pad('Fresh Input', ds.cacheReported ? compactTokenCount(ds.freshInputTokens) : '—'),
    pad('Cache Rate', ds.cacheReported ? formatRatePercent(ds.cacheHitRate) : '—'),
    pad('Session cache rate', formatRatePercent(dsRate)),
    pad('DeepSeek tokens', ds.inputTokens ? compactTokenCount(ds.inputTokens) : '—'),
    '',
    pad('Estimated cost', last?.estimatedCost !== undefined ? `$${last.estimatedCost.toFixed(4)}` : '—'),
    pad('Baseline cost', last?.baselineCost !== undefined ? `$${last.baselineCost.toFixed(4)}` : '—'),
    pad('Savings', last?.savings !== undefined ? `$${last.savings.toFixed(4)}` : '—'),
    pad('Tests', nr.testsPassed === true ? 'PASS' : nr.testsPassed === false && nr.retryCount > 0 ? 'FAIL' : '—'),
    pad('Retry count', String(nr.retryCount)),
    pad('Context expansions', String(nr.expansionCount)),
    pad('Tokens avoided', compactTokenCount(snap.neuralRelay.tokensAvoided)),
  ].join('\n');
}

function ensureLast(snap: CacheStatusSnapshot, requestId?: string): RequestTelemetry {
  if (!snap.last || (requestId && snap.last.requestId !== requestId)) {
    snap.last = {
      requestId: requestId ?? snap.last?.requestId ?? newRequestId(),
      phase: snap.phase,
      deepseek: emptyDeepSeekSlice(),
      neuralRelay: emptyNeuralRelaySlice(),
    };
  }
  return snap.last;
}

function newRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneSnapshot(snap: CacheStatusSnapshot): CacheStatusSnapshot {
  return {
    deepseek: { ...snap.deepseek },
    neuralRelay: { ...snap.neuralRelay },
    last: snap.last
      ? {
          ...snap.last,
          deepseek: { ...snap.last.deepseek },
          neuralRelay: { ...snap.last.neuralRelay },
        }
      : undefined,
    phase: snap.phase,
    liveLabel: snap.liveLabel,
  };
}

export function setPhase(
  snap: CacheStatusSnapshot,
  phase: RequestPhase,
  liveLabel?: string,
  requestId?: string,
): CacheStatusSnapshot {
  const next = cloneSnapshot(snap);
  next.phase = phase;
  next.liveLabel = liveLabel;
  const last = ensureLast(next, requestId);
  last.phase = phase;
  last.liveLabel = liveLabel;
  return next;
}

export { newRequestId };
