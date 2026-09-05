import { describe, expect, it } from 'vitest';
import { buildContextFingerprint } from '../src/fingerprint.js';
import type { ContextFingerprintInput } from '../src/types.js';

function base(overrides: Partial<ContextFingerprintInput> = {}): ContextFingerprintInput {
  return {
    openFiles: ['b.ts', 'a.ts'],
    activeUri: 'a.ts',
    settingsVersion: '1',
    branch: 'main',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

describe('buildContextFingerprint', () => {
  it('is stable regardless of openFiles order', () => {
    const a = buildContextFingerprint(base({ openFiles: ['a.ts', 'b.ts'] }));
    const b = buildContextFingerprint(base({ openFiles: ['b.ts', 'a.ts'] }));
    expect(a).toBe(b);
    expect(a.startsWith('fp_v1:')).toBe(true);
  });

  it('changes when a file is saved (content hash input changes)', () => {
    const before = buildContextFingerprint(base({ gitDiffHash: 'aaa' }));
    const after = buildContextFingerprint(base({ gitDiffHash: 'bbb' }));
    expect(before).not.toBe(after);
  });

  it('isolates workspaces', () => {
    const a = buildContextFingerprint(base({ workspaceId: 'ws-1' }));
    const b = buildContextFingerprint(base({ workspaceId: 'ws-2' }));
    expect(a).not.toBe(b);
  });

  it('includes memory digest when present', () => {
    const a = buildContextFingerprint(base());
    const b = buildContextFingerprint(base({ memoryDigest: 'deadbeef' }));
    expect(a).not.toBe(b);
  });
});
