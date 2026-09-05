import { describe, expect, it } from 'vitest';
import {
  STAGE_DEFAULT_DEADLINES,
  signalWithTimeout,
  stageDeadlineMs,
  withDeadline,
} from '../src/parallel.js';

describe('withDeadline', () => {
  it('resolves when the promise wins the race', async () => {
    const result = await withDeadline(
      new Promise<string>((r) => setTimeout(() => r('ok'), 10)),
      1_000,
      'Test',
    );
    expect(result).toBe('ok');
  });

  it('rejects with a labeled error on timeout', async () => {
    await expect(
      withDeadline(
        new Promise<string>((r) => setTimeout(() => r('late'), 200)),
        20,
        'Planner',
      ),
    ).rejects.toThrow(/Planner timed out after 20ms/);
  });

  it('clears the timer after resolution (no dangling handles)', async () => {
    const before = process.getActiveResourcesInfo?.().length ?? 0;
    await withDeadline(Promise.resolve('fast'), 5_000, 'Fast');
    await new Promise((r) => setTimeout(r, 0));
    const after = process.getActiveResourcesInfo?.().length ?? 0;
    if (process.getActiveResourcesInfo) {
      expect(after).toBeLessThanOrEqual(before);
    }
  });
});

describe('stageDeadlineMs', () => {
  it('returns defaults and honors env overrides', () => {
    delete process.env.SINGULARITY_PLANNER_DEADLINE_MS;
    expect(stageDeadlineMs('SINGULARITY_PLANNER_DEADLINE_MS', 30_000)).toBe(30_000);
    process.env.SINGULARITY_PLANNER_DEADLINE_MS = '5000';
    expect(stageDeadlineMs('SINGULARITY_PLANNER_DEADLINE_MS', 30_000)).toBe(5_000);
    delete process.env.SINGULARITY_PLANNER_DEADLINE_MS;
  });

  it('kill-switch SINGULARITY_DEADLINES=0 disables deadlines', () => {
    process.env.SINGULARITY_DEADLINES = '0';
    expect(stageDeadlineMs('SINGULARITY_VERIFY_DEADLINE_MS', 15_000)).toBeUndefined();
    delete process.env.SINGULARITY_DEADLINES;
  });

  it('documents the spec defaults', () => {
    expect(STAGE_DEFAULT_DEADLINES).toEqual({
      planner: 90_000,
      integrator: 20_000,
      requirementVerifier: 15_000,
    });
  });
});

describe('signalWithTimeout', () => {
  it('aborts the controller when the timeout fires', async () => {
    const { signal, cancelTimeout } = signalWithTimeout(undefined, 20);
    await new Promise((r) => setTimeout(r, 50));
    expect(signal.aborted).toBe(true);
    cancelTimeout();
  });

  it('aborts immediately when the external signal is already aborted', () => {
    const ac = new AbortController();
    ac.abort();
    const { signal, cancelTimeout } = signalWithTimeout(ac.signal, 5_000);
    expect(signal.aborted).toBe(true);
    cancelTimeout();
  });

  it('propagates external aborts before the timeout', () => {
    const ac = new AbortController();
    const { signal, cancelTimeout } = signalWithTimeout(ac.signal, 60_000);
    ac.abort();
    expect(signal.aborted).toBe(true);
    cancelTimeout();
  });

  it('cancelTimeout prevents timeout abort', async () => {
    const { signal, cancelTimeout } = signalWithTimeout(undefined, 30);
    cancelTimeout();
    await new Promise((r) => setTimeout(r, 60));
    expect(signal.aborted).toBe(false);
  });
});
