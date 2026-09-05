/**
 * Global LLM rate control (Phase 13 P0).
 *
 * One shared gate for EVERY outbound LLM request in the process — provider
 * completions, SSE streams, and the Nemotron specialty classifier alike.
 * Under a shared 1–4 RPM gateway, independent callers (parallel DAG workers,
 * planner, verifier, classifier) previously hammered the endpoint and
 * amplified 429s into hard failures. All request *initiations* now pass
 * through this module:
 *
 *   initiation → min-interval spacing → jittered spread
 *   429        → noteRateLimited(Retry-After) → every caller cools down
 *
 * Only start-times are gated; response bodies stream unconstrained, so
 * generation throughput and non-LLM concurrency are untouched.
 */

export interface RateGateConfig {
  /** Gateway requests-per-minute ceiling shared by all callers. */
  rpm: number;
  /** Fixed cooldown applied process-wide after a 429. */
  rateLimitedCooldownMs: number;
  /**
   * Floor on inter-request spacing (default 250ms). Overridable for
   * benchmarks / offline mock transports that measure routing overhead.
   */
  minSpacingMs?: number;
}

const DEFAULT_CONFIG: RateGateConfig = {
  rpm: numberEnv('SINGULARITY_LLM_RPM', underTest() ? 100_000 : 4),
  rateLimitedCooldownMs: numberEnv(
    'SINGULARITY_LLM_429_COOLDOWN_MS',
    underTest() ? 1 : 20_000,
  ),
};

/** Test environments start unthrottled; explicit env always wins. */
function underTest(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

let config: RateGateConfig = { ...DEFAULT_CONFIG };

/** Min spacing between request initiations, derived from the RPM ceiling. */
function minIntervalMs(): number {
  const rpm = Math.max(0.01, config.rpm);
  return Math.max(config.minSpacingMs ?? 250, Math.ceil(60_000 / rpm));
}

export function getRateGateConfig(): RateGateConfig {
  return { ...config };
}

/** Override config (tests, benchmarks, embedders). */
export function setRateGateConfig(patch: Partial<RateGateConfig>): void {
  config = { ...config, ...patch };
}

export function resetRateGate(): void {
  config = { ...DEFAULT_CONFIG };
  lastStartAt = 0;
  rateLimitedUntil = 0;
  queueTail = Promise.resolve();
}

let lastStartAt = 0;
let rateLimitedUntil = 0;
let queueTail: Promise<unknown> = Promise.resolve();

/** Measurement-only observability (Phase 14): where wall-clock goes in the gate. */
export interface RateGateStats {
  initiations: number;
  /** Total ms requests spent waiting for a slot: queue spacing + cooldowns. */
  queuedWaitMs: number;
  cooldownWaitMs: number;
  spacingWaitMs: number;
  observed429s: number;
  retriesAfter429: number;
  retryBackoffMs: number;
}

const emptyStats = (): RateGateStats => ({
  initiations: 0,
  queuedWaitMs: 0,
  cooldownWaitMs: 0,
  spacingWaitMs: 0,
  observed429s: 0,
  retriesAfter429: 0,
  retryBackoffMs: 0,
});

let stats: RateGateStats = emptyStats();

/** Cumulative since last reset. Safe to read at any time. */
export function getRateGateStats(): RateGateStats {
  return { ...stats };
}

export function resetRateGateStats(): void {
  stats = emptyStats();
}

/**
 * Gate options for a single initiation.
 *
 * - `lane: 'interactive'` — chat/UI-initiated requests. They still respect the
 *   429 cooldown and a soft spacing floor, but do NOT serialize behind the
 *   global `queueTail` used by background workers. Without this, one
 *   interactive chat request can sit minutes behind parallel agent/worker LLM
 *   calls queued at 15s spacing (4 RPM default), which looks like a hang
 *   ("Evaluating" for 10 minutes) while the UI waits for a slot.
 * - `slotTimeoutMs` — hard deadline (ms) for obtaining a slot on the
 *   interactive lane. If the slot does not open in time, the initiation
 *   proceeds best-effort instead of waiting indefinitely. 0/undefined keeps
 *   the legacy unbounded wait (existing tests / default lane unchanged).
 */
export interface GateLlmOptions {
  lane?: 'interactive' | 'default';
  slotTimeoutMs?: number;
}

/**
 * Run `fn` (the actual fetch/initiation) through the global gate: queued,
 * spaced by min-interval, delayed by any active 429 cooldown, abort-aware.
 * The gate releases as soon as `fn` resolves (response headers received) —
 * body consumption is never serialized.
 */
async function gateInitiation<T>(fn: () => Promise<T>, signal?: AbortSignal, opts: GateLlmOptions = {}): Promise<T> {
  const interactive = opts.lane === 'interactive';
  if (interactive) {
    // Interactive lane: never chain behind the background queue tail. Only the
    // shared 429 cooldown + a soft spacing floor apply, bounded by the caller's
    // slot deadline so a congested gateway cannot wedge chat indefinitely.
    const deadline = opts.slotTimeoutMs && opts.slotTimeoutMs > 0 ? Date.now() + opts.slotTimeoutMs : undefined;
    try {
      await waitForSlot(signal, { deadline, interactive });
      stats.initiations += 1;
      lastStartAt = Date.now();
      return await fn();
    } finally {
      /* no queue release needed on the interactive lane */
    }
  }
  const prev = queueTail;
  let release!: () => void;
  queueTail = new Promise<void>((r) => {
    release = r;
  });
  await prev.catch(() => undefined);
  const queuedAt = Date.now();
  try {
    await waitForSlot(signal);
    stats.initiations += 1;
    stats.queuedWaitMs += Date.now() - queuedAt;
    lastStartAt = Date.now();
    return await fn();
  } finally {
    release();
  }
}

async function waitForSlot(
  signal?: AbortSignal,
  opts: { deadline?: number; interactive?: boolean } = {},
): Promise<void> {
  for (;;) {
    throwIfAborted(signal);
    const waitStart = Date.now();
    const now = Date.now();
    const earliest = Math.max(lastStartAt + minIntervalMs(), rateLimitedUntil);
    const waitMs = earliest - now;
    if (waitMs <= 0) {
      stats.queuedWaitMs += Date.now() - waitStart;
      return;
    }
    // Interactive lane slot deadline: if we can't get a slot in time, proceed
    // best-effort rather than block chat indefinitely. The 429 cooldown is
    // still honored — exceeding the deadline only skips *spacing*, never the
    // cooldown.
    if (opts.deadline !== undefined && now + waitMs > opts.deadline) {
      if (now >= rateLimitedUntil) {
        stats.queuedWaitMs += Date.now() - waitStart;
        return;
      }
      // Inside an active cooldown: keep waiting (cooldown is mandatory),
      // but only up to the deadline, then proceed regardless.
      if (now + (rateLimitedUntil - now) > opts.deadline) {
        stats.queuedWaitMs += Date.now() - waitStart;
        return;
      }
    }
    if (now < rateLimitedUntil) {
      stats.cooldownWaitMs += Math.min(waitMs, rateLimitedUntil - now);
    } else {
      stats.spacingWaitMs += waitMs;
    }
    await sleepAbortable(waitMs, signal);
  }
}

/** Record a 429: cool the whole process down for at least `retryAfterMs`. */
export function noteRateLimited(retryAfterMs?: number): void {
  stats.observed429s += 1;
  const cooldown =
    Number.isFinite(retryAfterMs) && (retryAfterMs as number) > 0
      ? Math.min((retryAfterMs as number) + jitter(500), 120_000)
      : config.rateLimitedCooldownMs + jitter(1_000);
  const until = Date.now() + cooldown;
  if (until > rateLimitedUntil) {
    rateLimitedUntil = until;
  }
}

export function rateLimitedUntilTs(): number {
  return rateLimitedUntil;
}

/**
 * Exponential backoff with jitter for one retry.
 * `attempt` is 0-based. Honors server-supplied waits (never retries sooner),
 * caps the total, and adds ±25% jitter to avoid thundering herds.
 */
export function computeBackoffMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; retryAfterMs?: number } = {},
): number {
  const base = opts.baseMs ?? 1_000;
  const max = opts.maxMs ?? 30_000;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  const backoff = Math.min(max, exp) + jitter(Math.min(1_000, exp / 2));
  const ra = opts.retryAfterMs ?? 0;
  return Number.isFinite(ra) && ra > 0 ? Math.max(ra, backoff) : backoff;
}

function jitter(spanMs: number): number {
  return spanMs > 0 ? Math.floor(Math.random() * spanMs) : 0;
}

/**
 * Parse a Retry-After hint from response headers and/or an error/body string.
 * Handles seconds form, HTTP-date form, and common JSON shapes
 * (`retry_after`, `error.metadata.headers['retry-after']`, `rate_limit.reset`).
 */
export function parseRetryAfterMs(
  res: { headers?: Headers; status?: number } | undefined,
  bodyText?: string,
): number | undefined {
  const header = res?.headers?.get('retry-after') ?? res?.headers?.get('x-retry-after');
  const fromHeader = parseRetryAfterValue(header);
  if (fromHeader !== undefined) {
    return fromHeader;
  }
  if (bodyText) {
    const fromBody = parseRetryAfterFromBody(bodyText);
    if (fromBody !== undefined) {
      return fromBody;
    }
  }
  return undefined;
}

export function parseRetryAfterValue(value: string | undefined | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.ceil(Number(trimmed) * 1_000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

function parseRetryAfterFromBody(bodyText: string): number | undefined {
  try {
    const json = JSON.parse(bodyText) as Record<string, unknown>;
    const candidates = [
      json['retry_after'],
      json['retry-after'],
      (json['rate_limit'] as Record<string, unknown> | undefined)?.['reset'],
      ((json['error'] as Record<string, unknown> | undefined)?.['metadata'] as
        | Record<string, unknown>
        | undefined)?.['headers'] as Record<string, unknown> | undefined
        ? (((json['error'] as Record<string, unknown>)['metadata'] as Record<string, unknown>)[
            'headers'
          ] as Record<string, unknown>)['retry-after']
        : undefined,
    ];
    for (const c of candidates) {
      const ms = parseRetryAfterValue(
        typeof c === 'number' ? String(c) : typeof c === 'string' ? c : undefined,
      );
      if (ms !== undefined) {
        return ms;
      }
    }
  } catch {
    /* not JSON — no hint available */
  }
  return undefined;
}

/**
 * Best-effort Retry-After extraction from an error message/body produced
 * upstream (scheduler retries, classifier probes).
 */
export function extractRetryAfterFromText(text: string | undefined): number | undefined {
  if (!text) {
    return undefined;
  }
  const m =
    /retry[- ]after["'\s:=]+(\d+(?:\.\d+)?)\s*(s|sec|seconds)?/i.exec(text) ??
    /retry[- ]after["'\s:=]+(\d+(?:\.\d+)?)\s*(ms|milliseconds)/i.exec(text);
  if (!m) {
    return undefined;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  if (m[2] && /ms/i.test(m[2])) {
    return Math.ceil(n);
  }
  return Math.ceil(n * 1_000);
}

export function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError();
  }
}

export function abortError(): Error {
  const e = new Error('LLM request aborted');
  e.name = 'AbortError';
  return e;
}

function numberEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Gate + bounded retry around one initiation closure. Retries ONLY on
 * `shouldRetry` (429 by convention); each wait honors Retry-After, feeds the
 * global cooldown, and propagates cancellation.
 */
export async function fetchWithRateRetry<T>(args: {
  initiate: () => Promise<T>;
  classify: (result: T) =>
    { retry: boolean; retryAfterMs?: number; status?: number } | Promise<{ retry: boolean; retryAfterMs?: number; status?: number }>;
  maxRetries?: number;
  signal?: AbortSignal;
  /** Route this initiation through the interactive lane (see GateLlmOptions). */
  gateOptions?: GateLlmOptions;
}): Promise<T> {
  const maxRetries = args.maxRetries ?? maxRetriesFromEnv();
  let attempt = 0;
  for (;;) {
    const result = await gateInitiation(args.initiate, args.signal, args.gateOptions);
    const verdict = await args.classify(result);
    if (!verdict.retry || attempt >= maxRetries) {
      if (verdict.status === 429) {
        noteRateLimited(verdict.retryAfterMs);
      }
      return result;
    }
    noteRateLimited(verdict.retryAfterMs);
    const waitMs = computeBackoffMs(attempt, { retryAfterMs: verdict.retryAfterMs });
    stats.retriesAfter429 += 1;
    stats.retryBackoffMs += waitMs;
    await sleepAbortable(waitMs, args.signal);
    attempt += 1;
  }
}

function maxRetriesFromEnv(): number {
  const raw = Number(process.env.SINGULARITY_LLM_MAX_RETRIES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
}

/**
 * Public entry used by non-provider LLM callers (specialty classifier):
 * same spacing/cooldown discipline without retry semantics.
 *
 * Pass `{ lane: 'interactive', slotTimeoutMs }` to opt chat/UI requests into
 * the non-serializing interactive lane with a bounded slot wait.
 */
export function gateLlmRequest<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  opts: GateLlmOptions = {},
): Promise<T> {
  return gateInitiation(fn, signal, opts);
}
