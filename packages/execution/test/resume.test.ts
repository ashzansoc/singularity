import { describe, expect, it } from 'vitest';
import { MemoryExecutionStore } from '../src/persistence/memory.js';
import { saveCheckpoint, loadCheckpoint, canResume } from '../src/checkpoint.js';

describe('checkpoint/resume', () => {
  it('saves and loads checkpoint state', () => {
    const store = new MemoryExecutionStore();
    store.upsertExecution({
      id: 'exec-1',
      objective: 'test',
      status: 'running',
      workspaceRoot: '/tmp',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    saveCheckpoint(store, 'exec-1', {
      batchIndex: 2,
      completedTaskIds: ['A', 'B'],
      inFlightTaskIds: ['C'],
      status: 'running',
    });

    const loaded = loadCheckpoint(store, 'exec-1');
    expect(loaded?.batchIndex).toBe(2);
    expect(loaded?.completedTaskIds).toEqual(['A', 'B']);
    expect(canResume(store, 'exec-1')).toBe(true);
  });
});
