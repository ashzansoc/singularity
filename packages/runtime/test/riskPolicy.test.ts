import { describe, expect, it, afterEach } from 'vitest';
import {
  scoreRisk,
  verificationPolicyFor,
} from '../src/tools/riskPolicy.js';
import type { DiffHunk } from '../src/types.js';

function diff(path: string, body = '+const x = 1;', isNew = false): DiffHunk {
  return { path, unifiedDiff: body, ...(isNew ? { isNew: true } : {}) };
}

describe('scoreRisk', () => {
  afterEach(() => {
    delete process.env.SINGULARITY_RISK_MEDIUM;
    delete process.env.SINGULARITY_RISK_HIGH;
  });

  it('small benign change is low risk', () => {
    const r = scoreRisk([diff('src/utils/format.ts')]);
    expect(r.tier).toBe('low');
    expect(r.score).toBeLessThan(4);
  });

  it('auth path raises risk', () => {
    const r = scoreRisk([diff('src/auth/login.ts')]);
    expect(r.signals.some((s) => s.startsWith('auth:'))).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  it('dependency manifest changes are high risk', () => {
    const r = scoreRisk([diff('package.json', '+{\n+  "new": "dep"\n}')]);
    expect(r.tier).toBe('high');
  });

  it('.env changes are high risk', () => {
    const r = scoreRisk([diff('.env.local')]);
    expect(r.tier).toBe('high');
  });

  it('destructive SQL in a diff escalates', () => {
    const r = scoreRisk([diff('migrations/001.sql', '+DROP TABLE users;')]);
    expect(r.signals.some((s) => s.startsWith('destructive:'))).toBe(true);
    expect(r.tier).toBe('high');
  });

  it('many files and large diffs accumulate', () => {
    const many = Array.from({ length: 8 }, (_, i) => diff(`src/mod${i}.ts`));
    const bigBody = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join('\n');
    const big = diff('src/big.ts', bigBody);
    const r = scoreRisk([...many, big]);
    expect(r.score).toBeGreaterThanOrEqual(6);
    expect(r.tier === 'medium' || r.tier === 'high').toBe(true);
  });

  it('empty input is uncertain ⇒ high (fail safe)', () => {
    const r = scoreRisk([]);
    expect(r.tier).toBe('high');
    expect(r.signals).toContain('no-signal-uncertain');
  });

  it('tests available soften the score by one', () => {
    const base = scoreRisk([diff('src/auth/session.ts'), diff('src/auth/jwt.ts')]);
    const softened = scoreRisk([diff('src/auth/session.ts'), diff('src/auth/jwt.ts')], {
      testsAvailable: true,
    });
    expect(softened.score).toBe(base.score - 1);
  });

  it('public API barrel edits are at least MEDIUM (Phase 13 P1)', () => {
    const r = scoreRisk([
      diff('src/index.ts', '+export { helper } from "./helper.js";'),
    ]);
    expect(r.tier === 'medium' || r.tier === 'high').toBe(true);
  });

  it('3+ modified files are at least MEDIUM', () => {
    const r = scoreRisk([
      diff('src/a.ts'),
      diff('src/b.ts'),
      diff('src/c.ts'),
    ]);
    expect(r.tier === 'medium' || r.tier === 'high').toBe(true);
  });

  it('public API surface + multi-file change is HIGH', () => {
    const r = scoreRisk([
      diff('src/index.ts', '-export { a };\n+export { a, b };'),
      diff('src/impl/a.ts'),
      diff('src/impl/b.ts'),
    ]);
    expect(r.tier).toBe('high');
  });

  it('destructive SQL is HIGH even on an innocuous path', () => {
    const r = scoreRisk([diff('src/cleanup.ts', '+await db.query("DROP TABLE users");')]);
    expect(r.tier).toBe('high');
    expect(r.signals).toContain('floor:destructive-high');
  });

  it('floors survive tests-present softening', () => {
    const r = scoreRisk(
      [diff('src/index.ts', '+export type Foo = string;'), diff('src/x.ts')],
      { testsAvailable: true },
    );
    expect(r.tier === 'medium' || r.tier === 'high').toBe(true);
  });

  it('thresholds configurable via env', () => {
    process.env.SINGULARITY_RISK_MEDIUM = '1';
    process.env.SINGULARITY_RISK_HIGH = '2';
    const r = scoreRisk([diff('src/a.ts'), diff('src/b.ts'), diff('src/c.ts')]);
    // multi-file:+1 → medium at threshold 1... but high requires ≥2.
    expect(r.tier).not.toBe('low');
  });
});

describe('verificationPolicyFor', () => {
  it('low risk skips only the LLM checklist verifier', () => {
    const p = verificationPolicyFor('low');
    expect(p.runDeterministicChecks).toBe(true);
    expect(p.runChecklistVerifier).toBe(false);
    expect(p.runFullVerification).toBe(false);
  });

  it('medium runs checklist verifier without full path', () => {
    const p = verificationPolicyFor('medium');
    expect(p.runChecklistVerifier).toBe(true);
    expect(p.runFullVerification).toBe(false);
  });

  it('high keeps current full behavior', () => {
    const p = verificationPolicyFor('high');
    expect(p).toEqual({
      runDeterministicChecks: true,
      runChecklistVerifier: true,
      runFullVerification: true,
    });
  });

  it('Phase 13 semantics: risky changes can never land in the low-risk plan', () => {
    const risky: Array<[string, DiffHunk[]]> = [
      ['public API barrel', [diff('src/index.ts', '+export { api };')]],
      ['3-file refactor', [diff('src/a.ts'), diff('src/b.ts'), diff('src/c.ts')]],
      ['auth', [diff('src/auth/login.ts')]],
      ['db migration', [diff('db/migrations/007.sql', '+CREATE TABLE t (id int);', true)]],
      ['dependency', [diff('package.json', '+{\n+  "dep": "1.0.0"\n}')]],
      ['.env', [diff('.env')]],
      ['destructive SQL', [diff('scripts/clean.ts', '+TRUNCATE TABLE users;')]],
    ];
    for (const [name, diffs] of risky) {
      const tier = scoreRisk(diffs).tier;
      const plan = verificationPolicyFor(tier);
      expect(
        plan.runFullVerification || plan.runChecklistVerifier,
        `${name} (tier=${tier}) must receive checks`,
      ).toBe(true);
      expect(tier, `${name} must not be low risk`).not.toBe('low');
    }
  });

  it('LOW really is low: benign single-file comment edit skips the checklist verifier', () => {
    const r = scoreRisk([diff('src/util.ts', '-const x = 1;\n+const x = 1; // tweak')]);
    expect(r.tier).toBe('low');
    const p = verificationPolicyFor(r.tier);
    expect(p.runChecklistVerifier).toBe(false);
    expect(p.runDeterministicChecks).toBe(true);
  });
});
