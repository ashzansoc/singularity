# SINGULARITY CURRENT-STATE ARCHITECTURE MAP (synthesis of cluster inventories)

> Synthesized from 5 cluster inventory reports + direct reads + dependency scan.
> Reports: architecture-and-outcome.md, context-cluster.md, runtime.md, tmp-bridges.md, tools-sidecars.md.
> Status: memory-cluster (brain/memory/neural-relay) and router-cluster (router) pending final read → fill §M/§R.

## 0. The current top-level "engines" (13 packages + services + extension surface)
| Package | Dir | Purpose (one-line) |
|---|---|---|
| @singularity/router | packages/router | Cost-aware model router + `SingularityAI` unified hot-path hub (route→cache→prompt→provider→stream) |
| @singularity/prompt | packages/prompt | Prompt Engine v3 — adaptive context compilation (Builder→Segments→Compiler→IR→adapters), learning |
| @singularity/cache | packages/cache | Multi-layer AI I/O cache (L1 fingerprint, L2 prefix, L3 semantic, L4 response, L7 routing) |
| @singularity/context | packages/context | Context Engine (LangExtract) — project-state intake + retrieval |
| @singularity/wiki | packages/wiki | LLM Wiki — compounding markdown knowledge base |
| @singularity/intelligence | packages/intelligence | Project Intelligence daemon — graph store + SCIP/Tree-sitter index + hybrid retrieval |
| @singularity/architecture | packages/architecture | Architecture Intelligence — ADR/decisions/impact/risk/drift + graph + production observation |
| @singularity/outcome | packages/outcome | Outcome / Requirement Verification Engine — extract→compile→plan→verify→judge→review gate |
| @singularity/memory | packages/memory | Memory Engine — async project memory workers + sqlite/postgres + mem0/graph providers |
| @singularity/brain | packages/brain | Brain — persistent USER-level memory graph (entities/relationships/episodes) + cognitive runtime |
| @singularity/neural-relay | packages/neural-relay | Neural Relay — Nemotron "context intelligence" : compression of DeepSeek context (NOT an event fabric) |
| @singularity/runtime | packages/runtime | Runtime v4 — DAG scheduler + ownership-locked parallel workers + fast-path |
| @singularity/design | packages/design | Design Intelligence — frontend design director/spec/critic/DNA (specialized agent lane) |

Plus services/: langextract-sidecar (Python extraction), agent-framework-sidecar (STUB), project-intelligence (intelligence daemon wiring everything), qwen-router-sidecar (optional local router classifier).

## 2. Dependency graph (canonical cross-package)
See DEPENDENCY-GRAPH.md. Key structure:
- router = hot-path center (wires cache+prompt+providers); runtime → router/prompt/design/context.
- intelligence = deep-path center (depends on architecture+memory+outcome+prompt); daemon in project-intelligence.
- brain = isolated (no pkg deps); consumed only by extension bridge.
- architecture/memory/outcome each roll their own InMemoryEventBus+OutboxPublisher+WAL.

## 3. Critical cross-cutting overlaps (see per-cluster reports for detail & file paths)
1. **Triplicated event fabric** — architecture/memory/outcome each re-implement InMemoryEventBus+OutboxPublisher+LocalEventBuffer/WAL. → ONE Neural Relay transport.
2. **Four independent retrieval+ranking+assembly** (context, prompt, intelligence, wiki) + host string-concatenation. → ONE Context Engine decides relevance.
3. **Two live verifiers** — runtime tools/verifier+requirementVerifier vs outcome verification/runner+adapters. → Verification Engine (outcome authority).
4. **Two mission-state sources** — runtime in-memory mission/workflow vs outcome durable mission/controller. → Mission Engine canonical durable mission.
5. **Fastpath classifier vs router classifier** — both decide "single-call?" → Model Router canonical.
6. **Neural Relay naming mismatch** — the actual `@singularity/neural-relay` is context-compression, NOT the event fabric. The mission's "Neural Relay" (nervous system) = the event bus layer; the package named neural-relay = a Context/Model-Router concern (which model+context to serve a compressed block).
7. **Brain vs memory vs intelligence graph vs wiki** — overlapping knowledge stores. → Brain owns knowledge.
8. **architecture_decisions in context + memory ARCHITECTURAL_DECISION vs architecture ADR** → architecture owns decisions; context/memory project.

## Classification quick-table (from reports; brain/runtime/router pending refinement)
(Detailed per-component in the cluster reports. KEEP/ MERGE/MOVE/REPLACE per report below.)
