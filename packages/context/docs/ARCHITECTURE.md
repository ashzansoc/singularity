# Singularity Context Engine

Structured, grounded project state for Singularity agents — powered by Google LangExtract behind a provider-agnostic adapter.

## Role

The Context Engine is **not** the planner or coding agent. It transforms unstructured conversation/documents into durable Project State that agents retrieve by relevance.

```
User → Conversation/Files → Context Engine → LangExtract sidecar
  → Project State → Relevant Context → Planner / Workers / Verifier
```

## Packages

| Path | Role |
|------|------|
| [`packages/context`](../) | `@singularity/context` — schema, merge, store, retrieval, Node adapter |
| [`services/langextract-sidecar`](../../../services/langextract-sidecar) | Python stdio sidecar wrapping `langextract==1.6.0` |

## Feature flags

| Flag | Default | Meaning |
|------|---------|---------|
| `SINGULARITY_CONTEXT_ENGINE` / `singularity.ai.contextEngine.enabled` | `true` | Master switch (Agent, Ask, Edit, DAG, Complete) |
| `SINGULARITY_LANGEXTRACT_ENABLED` | `true` | Use sidecar (else heuristic) |
| `SINGULARITY_CONTEXT_RETRIEVAL_ENABLED` | `true` | Relevance filtering |
| `SINGULARITY_CONTEXT_AGENT_INTEGRATION_ENABLED` | `true` | Inject into planner/workers/prompts |

When the engine is disabled, Singularity behaves exactly as before.

## Mode coverage

| Mode | Integration |
|------|-------------|
| Agent / Ask / Edit | Singularity `maybeEnrichMessagesWithPromptEngine` → ingest + `compilePromptContext` injects Project Context into system messages |
| DAG / Runtime | `runRuntime` / DAG chat always attaches `structuredContext` |
| Complete command | `prepareContextForPrompt` prefixes structured context |
| Project Context UI | Inspect / override / archive |

## Configuration

```bash
SINGULARITY_CONTEXT_ENGINE=true
SINGULARITY_CONTEXT_PROVIDER=langextract
SINGULARITY_CONTEXT_MODEL=gemini-2.0-flash
SINGULARITY_CONTEXT_TEMPERATURE=0
SINGULARITY_CONTEXT_MAX_OUTPUT_TOKENS=4096
LANGEXTRACT_API_KEY=...   # or OPENAI_API_KEY
SINGULARITY_CONTEXT_PYTHON=python3
```

Install sidecar deps:

```bash
pip install -r services/langextract-sidecar/requirements.txt
```

## Persistence

`<workspace>/.singularity/project-context/`

- Normalized JSON collections (`requirements.json`, `constraints.json`, …)
- Version snapshots under `versions/v{N}.json`
- User overrides (`source_type=user_override`) are never silently overwritten

## Public API (TypeScript)

```ts
import { createContextEngine } from '@singularity/context';

const engine = createContextEngine({
  workspaceRoot,
  flags: { context_engine_enabled: true },
});

await engine.ingestMessage('Use PostgreSQL. Do not use Firebase.');
const relevant = engine.getRelevant('Implement Stripe cancellation');
engine.override('technology', 'PostgreSQL', { category: 'database' });
```

Agents should call `getRelevant(task)` — not dump full state.

## Failure handling

LangExtract failures fall back to the heuristic extractor, then continue the normal agent pipeline. Circuit breaker opens after repeated sidecar failures.

## Privacy

Secrets are redacted before persistence. Do not store API keys in project context.
