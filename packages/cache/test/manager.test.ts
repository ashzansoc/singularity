import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCacheManager } from '../src/manager.js';
import type { CacheRequest, ContextFingerprintInput } from '../src/types.js';
import { InvalidationController } from '../src/invalidation.js';
import { SqliteStore } from '../src/storage/sqlite.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function ctx(overrides: Partial<ContextFingerprintInput> = {}): ContextFingerprintInput {
  return {
    openFiles: ['src/auth.ts'],
    settingsVersion: '1',
    branch: 'main',
    workspaceId: 'ws-1',
    ...overrides,
  };
}

function req(overrides: Partial<CacheRequest> = {}): CacheRequest {
  return {
    prompt: 'Explain how auth middleware works',
    mode: 'chat',
    intent: 'EXPLAIN',
    modelId: 'anthropic/claude-sonnet-4',
    temperature: 0,
    context: ctx(),
    ...overrides,
  };
}

describe('CacheManager', () => {
  it('lookup miss then write-through then hit (L4)', async () => {
    const cache = createCacheManager({ workspaceId: 'ws-1' });
    const r = req();
    const miss = await cache.lookup(r);
    expect(miss.hit).toBe(false);

    await cache.writeThrough(miss, r, {
      responseText: 'It validates JWTs on each request.',
      tokenEstimate: 40,
      routingDecision: { modelId: r.modelId, tier: 'T2' },
      latencyMs: 120,
      outcome: 'success',
    });

    const hit = await cache.lookup(r);
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(hit.layer).toBe('L4');
      expect(hit.responseText).toContain('JWT');
    }
    expect(cache.metrics.hitRate('L4')).toBeGreaterThan(0);
  });

  it('skips cache when temperature > 0', async () => {
    const cache = createCacheManager({ workspaceId: 'ws-1' });
    const r = req({ temperature: 0.7 });
    const miss = await cache.lookup(r);
    expect(miss.hit).toBe(false);
    if (!miss.hit) {
      expect(miss.cacheable).toBe(false);
    }
  });

  it('invalidates via template version bump without full clear of unrelated logic', async () => {
    const cache = createCacheManager({ workspaceId: 'ws-1', templateVersion: '1' });
    const r = req();
    const miss = await cache.lookup(r);
    await cache.writeThrough(miss, r, {
      responseText: 'v1 answer',
      tokenEstimate: 10,
    });
    expect((await cache.lookup(r)).hit).toBe(true);

    cache.invalidate({ scope: 'template_change' });
    const after = await cache.lookup(r);
    // New template version → new key → miss
    expect(after.hit).toBe(false);
  });

  it('persists durable responses to SqliteStore directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sing-cache-'));
    dirs.push(dir);
    const cache = createCacheManager({ workspaceId: 'ws-1', durableDir: dir });
    const r = req();
    const miss = await cache.lookup(r);
    await cache.writeThrough(miss, r, {
      responseText: 'durable',
      tokenEstimate: 5,
    });

    const cache2 = createCacheManager({ workspaceId: 'ws-1', durableDir: dir });
    const hit = await cache2.lookup(r);
    expect(hit.hit).toBe(true);
    if (hit.hit) {
      expect(hit.responseText).toBe('durable');
    }
  });

  it('routing adapter get/set works', () => {
    const cache = createCacheManager({ workspaceId: 'ws-1' });
    const adapter = cache.routingAdapter();
    adapter.set('route:test', { modelId: 'm1', tier: 'T0' });
    expect(adapter.get('route:test')?.modelId).toBe('m1');
    expect(adapter.get('route:test')?.fromCache).toBe(true);
  });
});

describe('InvalidationController', () => {
  it('bumps versions for settings and provider changes', () => {
    const ctrl = new InvalidationController({
      templateVersion: '1',
      prefixVersion: '1',
      settingsVersion: '1',
      depsVersion: '1',
      branch: 'main',
      workspaceId: 'ws',
    });
    ctrl.apply({ scope: 'settings_change' });
    ctrl.apply({ scope: 'provider_change' });
    ctrl.apply({ scope: 'branch_switch', value: 'feat' });
    const s = ctrl.getState();
    expect(s.settingsVersion).toBe('2');
    expect(s.prefixVersion).toBe('2');
    expect(s.branch).toBe('feat');
  });
});

describe('SqliteStore corruption recovery', () => {
  it('starts empty on corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sing-cache-bad-'));
    dirs.push(dir);
    const store = new SqliteStore({ dir });
    store.set({
      key: 'k',
      value: 'v',
      expiresAt: Date.now() + 10_000,
      meta: {
        layer: 'L4',
        workspaceId: 'ws',
        createdAt: Date.now(),
        expiresAt: Date.now() + 10_000,
      },
    });
    // Overwrite with garbage
    writeFileSync(join(dir, 'singularity-cache.json'), '{not-json', 'utf8');
    const store2 = new SqliteStore({ dir });
    expect(store2.size).toBe(0);
  });
});
