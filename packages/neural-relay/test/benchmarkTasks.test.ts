import { describe, expect, it } from 'vitest';
import { BENCHMARK_TASKS } from '../benchmark/tasks.js';

describe('benchmark task catalog', () => {
  it('has 100 tasks with the required split', () => {
    expect(BENCHMARK_TASKS).toHaveLength(100);
    const simple = BENCHMARK_TASKS.filter((t) => t.difficulty === 'simple');
    const medium = BENCHMARK_TASKS.filter((t) => t.difficulty === 'medium');
    const complex = BENCHMARK_TASKS.filter((t) => t.difficulty === 'complex');
    expect(simple).toHaveLength(30);
    expect(medium).toHaveLength(40);
    expect(complex).toHaveLength(30);
  });

  it('includes the Apple Sign-In acceptance task', () => {
    const t = BENCHMARK_TASKS.find((x) => x.id === 'oauth-apple-signin');
    expect(t?.prompt).toMatch(/Apple Sign-In/);
    expect(t?.expectedFiles).toContain('src/auth/google.ts');
  });
});
