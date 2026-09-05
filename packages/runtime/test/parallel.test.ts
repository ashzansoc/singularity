import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PARALLEL_IO_LIMIT,
  READONLY_TOOL_CONCURRENCY,
  isParallelIoEnabled,
  isReadOnlyTool,
  parallelLimit,
} from '../src/parallel.js';

describe('parallelLimit', () => {
  let maxObserved = 0;
  let active = 0;

  beforeEach(() => {
    maxObserved = 0;
    active = 0;
    delete process.env.SINGULARITY_PARALLEL_IO;
  });

  afterEach(() => {
    delete process.env.SINGULARITY_PARALLEL_IO;
  });

  const tracked = async <T>(x: T, ms: number): Promise<T> => {
    active++;
    maxObserved = Math.max(maxObserved, active);
    await new Promise((r) => setTimeout(r, ms));
    active--;
    return x;
  };

  it('preserves result order regardless of completion order', async () => {
    const items = [40, 10, 30, 20];
    const out = await parallelLimit(items, 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual(items);
  });

  it('caps concurrency at the limit (default 8)', async () => {
    expect(PARALLEL_IO_LIMIT).toBe(8);
    await parallelLimit(Array.from({ length: 32 }, (_, i) => i), PARALLEL_IO_LIMIT, (i) =>
      tracked(i, 5),
    );
    expect(maxObserved).toBeLessThanOrEqual(PARALLEL_IO_LIMIT);
  });

  it('caps read-only tool concurrency at 4', () => {
    expect(READONLY_TOOL_CONCURRENCY).toBe(4);
  });

  it('rejects when a task rejects', async () => {
    await expect(
      parallelLimit([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error('boom');
        return i;
      }),
    ).rejects.toThrow('boom');
  });

  it('kill-switch restores sequential execution', async () => {
    process.env.SINGULARITY_PARALLEL_IO = '0';
    expect(isParallelIoEnabled()).toBe(false);
    let seqActive = 0;
    let seqMax = 0;
    await parallelLimit([1, 2, 3, 4], 8, async (i) => {
      seqActive++;
      seqMax = Math.max(seqMax, seqActive);
      await new Promise((r) => setTimeout(r, 1));
      seqActive--;
      return i;
    });
    expect(seqMax).toBe(1);
  });

  it('single item never goes concurrent', async () => {
    await parallelLimit([1], 8, (i) => tracked(i, 5));
    expect(maxObserved).toBe(1);
  });
});

describe('isReadOnlyTool', () => {
  it('classifies read-only vs write tools', () => {
    for (const t of ['read_file', 'list_directory', 'search_files', 'git_status', 'git_diff']) {
      expect(isReadOnlyTool(t)).toBe(true);
    }
    for (const t of ['write_file', 'terminal', 'typecheck', 'test', 'unknown_tool']) {
      expect(isReadOnlyTool(t)).toBe(false);
    }
  });
});
