import { describe, expect, it } from 'vitest';
import { LockManager, LockTimeoutError } from '../src/locks/lockManager.js';

describe('LockManager', () => {
  it('acquires and releases exclusive path locks', async () => {
    const locks = new LockManager({ timeoutMs: 200 });
    const a = await locks.acquire(['src/a.ts'], 't1');
    expect(locks.lockedPaths).toContain('src/a.ts');
    locks.commit(a.id);
    locks.release(a.id);
    expect(locks.lockedPaths).not.toContain('src/a.ts');
  });

  it('queues waiters and grants after release', async () => {
    const locks = new LockManager({ timeoutMs: 1000 });
    const first = await locks.acquire(['shared.ts'], 't1');
    const secondP = locks.acquire(['shared.ts'], 't2');
    // Give waiter a tick to register
    await new Promise((r) => setTimeout(r, 10));
    locks.release(first.id);
    const second = await secondP;
    expect(second.taskId).toBe('t2');
    locks.release(second.id);
  });

  it('times out when lock is never released', async () => {
    const locks = new LockManager({ timeoutMs: 50 });
    await locks.acquire(['x.ts'], 'holder');
    await expect(locks.acquire(['x.ts'], 'waiter', 40)).rejects.toBeInstanceOf(
      LockTimeoutError,
    );
  });
});
