# Singularity LLM Wiki

Persistent, compounding markdown knowledge base — Karpathy’s [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern, first-class in Singularity.

## Why not just RAG?

RAG re-discovers knowledge from raw chunks on every question. The wiki **compiles once and stays current**: entity pages, cross-references, contradictions, and synthesis are already there.

## Three layers

| Layer | Path | Who writes |
|-------|------|------------|
| Raw sources | `<wiki-root>/raw/` | Human (immutable) |
| Wiki pages | `<wiki-root>/wiki/` | LLM |
| Schema | `<wiki-root>/SCHEMA.md` | Human + LLM co-evolve |

Default wiki root: `.singularity/wiki` (override with `SINGULARITY_WIKI_ROOT` or `singularity.ai.wiki.root`, e.g. `wiki` for an Obsidian vault).

## Operations

- **Ingest** — copy source into `raw/`, write/update source + entity + concept pages, rebuild `index.md`, append `log.md`
- **Query** — search index/pages, cite, optionally file the answer as `wiki/queries/`
- **Lint** — orphans, broken wikilinks, missing frontmatter, self-grounding, stubs, open contradictions

## Agent integration

- Prompt inject: index + relevant pages (same path as Project Context)
- Tool: `llm_wiki` (`init` / `ingest` / `query` / `search` / `lint` / `file` / `status`)
- Chat mode: **Wiki**
- UI: Singularity AI → Open LLM Wiki

## Flags

| Flag | Default |
|------|---------|
| `SINGULARITY_WIKI` / `singularity.ai.wiki.enabled` | `true` |
| `SINGULARITY_WIKI_AGENT_INTEGRATION` / `singularity.ai.wiki.agentIntegrationEnabled` | `true` |
| `SINGULARITY_WIKI_ROOT` / `singularity.ai.wiki.root` | `.singularity/wiki` |
