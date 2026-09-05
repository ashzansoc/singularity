/**
 * SCHEMA.md — the agent contract for Singularity LLM Wiki.
 * Karpathy's "schema layer": conventions + workflows so the model is a
 * disciplined wiki maintainer rather than a generic chatbot.
 */

export const WIKI_SCHEMA_MD = `# Singularity LLM Wiki — SCHEMA

This file is the schema layer. The LLM owns the wiki. Humans curate sources,
ask questions, and steer emphasis. Follow these rules in every session.

Inspired by Andrej Karpathy's LLM Wiki pattern: a persistent, compounding
markdown wiki between you and the raw sources — not RAG-from-scratch on
every question.

## Layers

1. **Raw sources** (\`raw/\`) — immutable. Never modify, rename, or delete.
   This is the only grounding authority.
2. **Wiki pages** (\`wiki/\`) — LLM-written markdown. Derivative. Update freely
   to keep synthesis current, but every claim must trace to a raw source.
3. **This schema** — the contract. Co-evolve it with the human when the
   domain needs new conventions. Do not silently ignore it.

## Directory map

\`\`\`
<wiki-root>/
  SCHEMA.md              ← this file
  meta.json
  raw/                   ← immutable sources + raw/assets/
  wiki/
    index.md             ← catalog (read this first on query)
    log.md               ← append-only timeline
    overview.md          ← high-level picture
    synthesis.md         ← evolving thesis
    contradictions.md    ← open disagreements (never auto-resolve)
    sources/             ← one summary page per ingested source
    entities/            ← people, products, orgs, systems
    concepts/            ← ideas, themes, mechanisms
    queries/             ← filed answers worth keeping
\`\`\`

## Page format

Every wiki page (except index.md / log.md) uses YAML frontmatter:

\`\`\`yaml
---
title: PostgreSQL
category: entity          # overview | synthesis | source | entity | concept | query | contradiction
about: PostgreSQL
derived_from:
  - raw/using-postgres.md
origin: asserted          # asserted (in a source) | inferred (synthesis across sources)
status: active            # active | stub | review-due | superseded
updated: 2026-08-12
source_count: 1
summary: Relational database used by the project
tags: [database]
---
\`\`\`

Body conventions:

- Use Obsidian-style wikilinks: \`[[PostgreSQL]]\`, \`[[Connection pooling]]\`.
- Cite raw sources inline, e.g. \`(raw/using-postgres.md)\`.
- Never use another wiki page as the *only* grounding for a new claim.
- Mark inferred synthesis explicitly (\`origin: inferred\`).
- Record contradictions on \`contradictions.md\` and leave them open.

## Operations

### Ingest

When the human drops a source or asks to ingest:

1. Call \`llm_wiki\` with \`operation=ingest\` (or copy the file into \`raw/\` yourself
   without editing it). Raw files are immutable after write.
2. Read the source. Discuss key takeaways with the human when they are involved.
3. Write/update:
   - \`wiki/sources/<slug>.md\` summary
   - relevant \`wiki/entities/\` and \`wiki/concepts/\` pages
   - \`wiki/overview.md\` / \`wiki/synthesis.md\` if the big picture shifted
   - \`wiki/contradictions.md\` if new data conflicts with old claims
4. Rebuild \`wiki/index.md\` and append \`wiki/log.md\`:
   \`## [YYYY-MM-DD] ingest | Title\`
5. A single source may touch 10–15 pages. Prefer updating existing pages over
   creating near-duplicates.

Do not invent entities that are not in the source. Prefer asking one clarifying
question over guessing.

### Query

1. Read \`wiki/index.md\` first, then drill into relevant pages.
2. Use \`llm_wiki\` \`operation=query\` or \`search\` to find pages quickly.
3. Answer with citations to wiki pages **and** the underlying \`raw/\` sources.
4. If retrieval is thin, say so — do **not** fabricate a confident answer, and
   do **not** file it back into the wiki.
5. Good answers (comparisons, analyses, connections) **should** be filed with
   \`operation=file\` or a new \`wiki/queries/<slug>.md\` page so exploration
   compounds. Only file when the answer is grounded.

### Lint

Periodically, or when asked:

1. Call \`llm_wiki\` \`operation=lint\`.
2. Fix what you can: missing wikilinks, stub pages that now have enough
   material, index drift.
3. Report orphans, broken links, missing concept pages, stale claims, and
   open contradictions. Suggest new questions and sources.
4. Never silently resolve a contradiction the sources still hold open.

## Hard rules

- Never modify \`raw/\`.
- Every page declares \`about\` and at least one \`derived_from\` (except index/log).
- A wiki page must not be the sole \`derived_from\` of another wiki page.
- Do not auto-resolve contradictions; record them.
- Do not dump the whole wiki into chat — read the index, then a few pages.
- After ingest/query/file, keep \`index.md\` and \`log.md\` current.
- The human steers emphasis; you do the bookkeeping.

## Index and log

**index.md** is content-oriented: every page with a wikilink, one-line summary,
optional date / source count, grouped by category.

**log.md** is chronological and parseable. Each entry starts with:

\`## [YYYY-MM-DD] <op> | <Title>\`

where \`<op>\` is \`init\` | \`ingest\` | \`query\` | \`lint\` | \`file\` | \`update\`.
`;

export const DEFAULT_OVERVIEW_MD = `---
title: Overview
category: overview
about: this wiki
derived_from: []
origin: inferred
status: stub
updated: PLACEHOLDER_DATE
summary: High-level picture of this knowledge base
---

# Overview

This wiki is empty. Ingest a source or ask a question to start compounding knowledge.

Link new hub pages here as they appear.
`;

export const DEFAULT_SYNTHESIS_MD = `---
title: Synthesis
category: synthesis
about: evolving thesis
derived_from: []
origin: inferred
status: stub
updated: PLACEHOLDER_DATE
summary: Evolving thesis across ingested sources
---

# Synthesis

No thesis yet. After a few sources, summarize what the corpus currently claims,
where it agrees, and where it disagrees.
`;

export const DEFAULT_CONTRADICTIONS_MD = `---
title: Contradictions
category: contradiction
about: open disagreements
derived_from: []
origin: inferred
status: active
updated: PLACEHOLDER_DATE
summary: Claims that cannot all be true at once — left open on purpose
---

# Contradictions

None recorded yet. When two grounded claims conflict, add a bullet with both
citations and do **not** pick a winner.
`;

export const DEFAULT_INDEX_MD = `# Wiki Index

Catalog of this LLM wiki. Updated on every ingest. Read this first when querying.

## Overview

- [[Overview]] — high-level picture of this knowledge base
- [[Synthesis]] — evolving thesis
- [[Contradictions]] — open disagreements

## Sources

_(none yet)_

## Entities

_(none yet)_

## Concepts

_(none yet)_

## Queries

_(none yet)_
`;

export const DEFAULT_LOG_MD = `# Wiki Log

Append-only timeline. Each entry starts with \`## [YYYY-MM-DD] <op> | <Title>\`.

`;

export const AGENTS_MD_POINTER = `## LLM Wiki

This workspace has a Singularity LLM Wiki (Karpathy pattern): a persistent,
interlinked markdown knowledge base the agent maintains.

- Schema: \`.singularity/wiki/SCHEMA.md\` (or the configured wiki root)
- Raw sources (immutable): \`<wiki-root>/raw/\`
- Wiki pages: \`<wiki-root>/wiki/\`
- Start with \`wiki/index.md\`. Ingest sources, answer from the wiki, lint periodically.
- Never modify \`raw/\`. File good answers back as query pages.
`;
