# @singularity/prompt — Prompt Engine v3

Adaptive, self-learning prompt compilation for Singularity.

```
Indexer → Graph → Retrieval → Context Intelligence
  → Multi-stage Compiler → Prompt IR (graph) → Cache/Snapshots
  → Adapter → LLM → Telemetry → Learning Engine ↺
```

## Quick start

```ts
import { createPromptEngine } from '@singularity/prompt';

const engine = createPromptEngine({ workspaceId: 'ws' });
const result = await engine.run({
  sessionId: 's1',
  prompt: 'Explain createUser',
  intent: 'DEBUG',
  provider: 'openai',
  files: [{ uri: 'file:///a.ts', content: '…', version: 1, languageId: 'typescript' }],
});

engine.recordOutcome(result.telemetry.requestId, 'accepted');
```

## Scripts

```bash
npm run build -w @singularity/prompt
npm run test -w @singularity/prompt
npm run bench -w @singularity/prompt
```
