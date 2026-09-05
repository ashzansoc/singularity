# Memory Engine — Implementation Report

## What shipped

An asynchronous Memory Engine (`@singularity/memory`) that records durable project knowledge without touching the coding LLM hot path.

Canonical local store is SQLite (`<workspace>/.singularity/memory/memory.sqlite`). PostgreSQL + pgvector is a real `MemoryRepository` when `MEMORY_DATABASE_URL` is set. Neo4j, Redis, and Mem0 are optional adapters.

## Hot-path contract

Coding request:

1. `LocalMemoryBuffer.append` (void, never awaited)
2. `lookup` / snapshot cache only
3. Coding LLM

Never on the coding path: extraction, embeddings, Postgres, Neo4j, Mem0, consolidation, hybrid search.

## Flags

| Flag / setting | Default |
|---|---|
| `MEMORY_ENGINE_ENABLED` / `singularity.ai.memory.enabled` | true |
| `MEMORY_EXTRACTION_ENABLED` | true |
| `MEMORY_GRAPH_ENABLED` | true |
| `MEMORY_VECTOR_SEARCH_ENABLED` | true |
| `MEMORY_CONTEXT_ENABLED` | true |
| `MEMORY_DATABASE_URL` | unset (SQLite) |
| `NEO4J_URI` | unset (JSON graph) |
| `MEM0_API_KEY` | unset (local provider) |

## API (intelligence daemon)

- `POST/GET/PATCH /projects/{id}/memories`
- `POST /projects/{id}/memories/search`
- `POST /projects/{id}/memory/events` (enqueue)
- `POST /projects/{id}/memory/extract` (enqueue)
- `POST /projects/{id}/memory/consolidate`
- `GET /projects/{id}/memory/snapshot`
- `GET /projects/{id}/memory/decisions`
- `GET /projects/{id}/memory/relationships`

## Tests

```bash
npm run test -w @singularity/memory
```
