import { describe, expect, it } from 'vitest';
import { ContextBus } from '../src/bus/contextBus.js';
import { filterOwnedDiffs } from '../src/worker/worker.js';

describe('ownership', () => {
  it('rejects diffs outside ownedPaths', () => {
    const owned = new Set(['src/a.ts']);
    const { diffs, rejected, changeRequests } = filterOwnedDiffs(
      [
        { path: 'src/a.ts', newContent: 'ok' },
        { path: 'src/b.ts', newContent: 'nope' },
      ],
      owned,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.path).toBe('src/a.ts');
    expect(rejected).toEqual(['src/b.ts']);
    expect([...changeRequests]).toEqual(['src/b.ts']);
  });

  it('emits ChangeRequest on the bus', () => {
    const bus = new ContextBus();
    bus.emitKind('ChangeRequest', 't1', 'need shared types', {
      path: 'src/types.ts',
    });
    expect(bus.getEvents()).toHaveLength(1);
    expect(bus.getEvents()[0]!.kind).toBe('ChangeRequest');
  });
});
