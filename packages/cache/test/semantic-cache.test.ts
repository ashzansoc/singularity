import { describe, expect, it } from 'vitest';
import { SemanticPromptCache } from '../src/layers/semantic.js';
import { HashEmbedder } from '../src/storage/vector.js';

describe('SemanticPromptCache', () => {
  const query = {
    promptNormalized: 'Explain how authentication middleware works',
    mode: 'chat' as const,
    intent: 'EXPLAIN',
    fpBucket: 'fp_v1:abcdef',
    workspaceId: 'ws-1',
    templateVersion: '1',
  };

  it('hits when similarity is above threshold (identical prompt)', async () => {
    const cache = new SemanticPromptCache({
      embedder: new HashEmbedder(),
      threshold: 0.92,
    });
    await cache.storeResponse(query, 'Auth middleware validates JWT.', {
      tokenEstimate: 30,
    });
    const hit = await cache.query(query);
    expect(hit?.responseText).toBe('Auth middleware validates JWT.');
  });

  it('rejects below threshold (different prompt)', async () => {
    const cache = new SemanticPromptCache({
      embedder: new HashEmbedder(),
      threshold: 0.92,
    });
    await cache.storeResponse(query, 'Auth middleware validates JWT.');
    const miss = await cache.query({
      ...query,
      promptNormalized: 'Write a kubernetes deployment for redis',
    });
    expect(miss).toBeUndefined();
  });

  it('respects workspace isolation', async () => {
    const cache = new SemanticPromptCache({ embedder: new HashEmbedder() });
    await cache.storeResponse(query, 'secret');
    const miss = await cache.query({ ...query, workspaceId: 'ws-other' });
    expect(miss).toBeUndefined();
  });

  it('ignores tombstoned entries', async () => {
    const cache = new SemanticPromptCache({ embedder: new HashEmbedder() });
    const id = await cache.storeResponse(query, 'bad answer');
    cache.tombstone(id);
    expect(await cache.query(query)).toBeUndefined();
  });
});
