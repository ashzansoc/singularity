# @singularity/cache

Intelligent AI input/output caching engine for the Singularity IDE.

Layers: context fingerprint (L1), prompt prefix (L2), semantic prompt (L3),
response (L4), routing (L7), plus a thin MemoryHub (L8).

See [DESIGN.md](./DESIGN.md) for the full engineering design.

## Install & develop

```bash
cd packages/cache
npm install
npm test
npm run build
```

## Quick start

```ts
import { createCacheManager, buildContextFingerprint } from '@singularity/cache';

const cache = createCacheManager({ workspaceId: 'ws-1' });

const result = await cache.lookup({
  prompt: 'Explain how auth middleware works',
  mode: 'chat',
  intent: 'EXPLAIN',
  modelId: 'anthropic/claude-sonnet-4',
  temperature: 0,
  context: {
    openFiles: ['src/auth.ts'],
    settingsVersion: '1',
    branch: 'main',
    workspaceId: 'ws-1',
  },
});

if (result.hit) {
  console.log(result.responseText, result.layer);
} else {
  // call provider, then:
  await cache.writeThrough(result, {
    responseText: '...',
    tokenEstimate: 400,
  });
}
```

## Out of scope (v1)

- Repository AST cache (L0), CLI tool cache (L5), retrieval cache (L6)
- Wiring into VS Code / Singularity
- Real embedding models (inject your own `Embedder`)
