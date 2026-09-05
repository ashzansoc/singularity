# Singularity Prompt & Context Architecture

## Philosophy

**Treat prompts as compiled artifacts, not strings.**

## Level 1 --- Canonical Context Object

-   Single source of truth
-   Stores system prompt, conversation, repository, retrieval,
    diagnostics, terminal, memories, agent state, user preferences.

Flow: IDE → Context Builder → Canonical Context Object

## Level 2 --- Incremental Context Builder

Only update changed files: - AST - Symbols - Embeddings - Dependency
graph

Never rebuild the whole repository.

## Level 3 --- Context Segmentation

Split into immutable segments: - System - Repository - Conversation -
Retrieval - Terminal - Diagnostics - Memory - Agent

Each segment has: - Hash - Version - Token count - Cache metadata

## Level 4 --- Prompt Compiler

Canonical Context → Prompt Compiler → Prompt IR

The compiler: - Deduplicates - Orders context - Applies token budgets -
Compresses history - Produces provider-independent Prompt IR

## Level 5 --- Local Prompt Cache

Cache Prompt IR instead of raw prompt strings.

Benefits: - Provider agnostic - Fast reconstruction - Maximum reuse

## Level 6 --- Provider Adapters

Prompt IR is rendered by: - Claude Adapter - GPT Adapter - Gemini
Adapter - Qwen Adapter - Local Adapter

## Level 7 --- Provider Prompt Cache

Use provider prompt caching as a final optimization only.

Never depend on it.

## Level 8 --- Semantic Compression

Old conversation → Summary + Recent Turns

Keeps context size stable.

## Level 9 --- Routing-Aware Context

Different intents build different prompts.

Rename: - Selection - Current file

Debug: - Logs - Diagnostics - Terminal - Current file

Architecture: - Repository summary - Dependency graph - Retrieved
files - Memory

## Level 10 --- Context Budget Optimizer

Priority: 1. User prompt 2. Selection 3. Current file 4. Retrieved files
5. Diagnostics 6. Recent conversation 7. Summaries 8. Repository
overview 9. Long-term memory

Compress or remove lower-priority items when exceeding the budget.

## Overall Pipeline

IDE → Context Builder → Canonical Context → Segment Cache → Prompt
Compiler → Prompt IR → Provider Adapter → Provider Prompt Cache → LLM

## Benefits

-   Provider independent
-   Lower latency
-   Lower token cost
-   Easier model switching
-   Better cache reuse
-   Better telemetry

## Roadmap

Phase 1: - Context Object - Incremental Builder - Segmentation

Phase 2: - Prompt Compiler - Prompt IR - Local Cache

Phase 3: - Provider Adapters - Routing-aware Context - Provider Cache

Phase 4: - Semantic Compression - Budget Optimizer - Telemetry -
Adaptive optimization

## Core Principle

Optimize once, render many times.

Repository → Canonical Context → Prompt IR → Claude / GPT / Gemini /
Qwen / Local
