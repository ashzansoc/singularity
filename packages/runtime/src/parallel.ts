/**
 * Bounded parallel I/O helpers (Step 6).
 *
 * All parallelization funnels through `parallelLimit` so concurrency stays
 * capped even when callers pass unbounded input. Kill-switch:
 * `SINGULARITY_PARALLEL_IO=0` restores sequential execution everywhere.
 */

export function isParallelIoEnabled(): boolean {
  return process.env.SINGULARITY_PARALLEL_IO !== '0';
}

/** Default in-flight I/O cap per fan-out site. */
export const PARALLEL_IO_LIMIT = 8;

/**
 * Map over items with at most `limit` concurrent invocations.
 * Order of results matches order of items; a rejected promise rejects the
 * whole batch after all started work settles (same contract as Promise.all).
 */
export async function parallelLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!isParallelIoEnabled() || items.length <= 1 || limit <= 1) {
    const out: R[] = [];
    for (let i = 0; i < items.length; i++) {
      out.push(await fn(items[i]!, i));
    }
    return out;
  }
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'git_status',
  'git_diff',
]);

/** Read-only tools are ordering-insensitive and safe to run concurrently. */
export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

/** Concurrency for read-only agent tools. */
export const READONLY_TOOL_CONCURRENCY = 4;

/**
 * Deadline wrapper (Step 7): race a promise against a configurable timeout.
 * On timeout the returned error message is stable so existing catch/fallback
 * paths can classify it; the underlying promise keeps running but its result
 * is ignored (callers degrade gracefully).
 */
export async function withDeadline<T>(
  p: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** Env-tunable stage deadline; returns undefined when disabled/invalid. */
export function stageDeadlineMs(
  envVar: string,
  defaultMs: number,
): number | undefined {
  const raw = Number(process.env[envVar]);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return process.env.SINGULARITY_DEADLINES === '0' ? undefined : defaultMs;
}

/** Default deadlines per unbounded LLM stage (Step 7). */
export const STAGE_DEFAULT_DEADLINES = {
  planner: 90_000,
  integrator: 20_000,
  requirementVerifier: 15_000,
} as const;

/**
 * Combine an external signal with a timeout into a single AbortSignal.
 * Resolves with `{ signal, cancelTimeout }`; callers MUST call cancelTimeout
 * when done to avoid keeping the event loop alive.
 */
export function signalWithTimeout(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cancelTimeout: () => void } {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(new Error(`aborted after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cancelTimeout: () => {
      clearTimeout(timer);
      if (external) {
        external.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}
