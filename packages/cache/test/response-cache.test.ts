import { describe, expect, it } from 'vitest';
import { ResponseCache } from '../src/layers/response.js';
import { buildResponseCacheKey, normalizePrompt } from '../src/keys.js';
import { MemoryStore } from '../src/storage/memory.js';

describe('ResponseCache', () => {
  it('stores and retrieves by exact key', () => {
    const cache = new ResponseCache({ store: new MemoryStore() });
    const key = buildResponseCacheKey({
      templateVersion: '1',
      modelId: 'model-a',
      temperature: 0,
      fingerprint: 'fp_v1:abc',
      promptNormalized: normalizePrompt('Explain auth'),
      workspaceId: 'ws-1',
    });

    cache.set({
      key,
      modelId: 'model-a',
      promptNormalized: 'Explain auth',
      fingerprint: 'fp_v1:abc',
      templateVersion: '1',
      responseText: 'Auth uses JWT.',
      confidence: 1,
      tokenEstimate: 20,
      workspaceId: 'ws-1',
    });

    expect(cache.get(key)?.responseText).toBe('Auth uses JWT.');
  });

  it('expires entries after TTL', () => {
    const cache = new ResponseCache({ store: new MemoryStore(), ttlMs: 1 });
    cache.set({
      key: 'resp:temp',
      modelId: 'm',
      promptNormalized: 'x',
      fingerprint: 'fp',
      templateVersion: '1',
      responseText: 'gone',
      confidence: 1,
      tokenEstimate: 1,
      workspaceId: 'ws',
      expiresAt: Date.now() - 1,
    });
    expect(cache.get('resp:temp')).toBeUndefined();
  });

  it('uses different keys for different models', () => {
    const a = buildResponseCacheKey({
      templateVersion: '1',
      modelId: 'a',
      temperature: 0,
      fingerprint: 'fp',
      promptNormalized: 'same',
      workspaceId: 'ws',
    });
    const b = buildResponseCacheKey({
      templateVersion: '1',
      modelId: 'b',
      temperature: 0,
      fingerprint: 'fp',
      promptNormalized: 'same',
      workspaceId: 'ws',
    });
    expect(a).not.toBe(b);
  });
});
