/**
 * Design vs Implementation knowledge retrieval.
 * Design knowledge informs art direction; implementation knowledge informs how to build —
 * never the reverse (libraries are not art directors).
 */

import { retrieveDesignKnowledge, retrieveDesignKnowledgeForSources } from './knowledge.js';
import { sourcesForQuery } from './catalog.js';
import {
  specConcept,
  specDesignLanguage,
  specDisplayFamily,
  specHeroVisual,
  specImageryStrategy,
  specPersonality,
  specProductCategory,
  specSignaturePurpose,
  specSignatureType,
  specVisualMetaphor,
  type DesignSpecification,
} from './designSpec.js';
import type { DesignSource } from './types.js';

export type KnowledgeKind = 'design' | 'implementation';

export interface DesignReferenceCard {
  pattern: string;
  why_relevant: string;
  visual_characteristics: string[];
  implementation_reference?: string;
  source: string;
  kind: KnowledgeKind;
}

export interface KnowledgeRetrievalQuery {
  productCategory?: string;
  personality?: string;
  artDirection?: string;
  visualMetaphor?: string;
  layoutType?: string;
  typography?: string;
  interactionStyle?: string;
  requiredComponent?: string;
  technologyStack?: string;
  /** Free-text fallback. */
  rawQuery?: string;
  /** From Design Spec when available. */
  spec?: DesignSpecification;
}

const DESIGN_SOURCE_IDS = new Set([
  'react-bits',
  'godui',
  'aceternity',
  'magic-ui',
  'tailwind-patterns',
  'threejs',
  'shadcn-taxonomy',
  'website-cloner',
]);

const IMPLEMENTATION_SOURCE_IDS = new Set([
  'react-bits',
  'godui',
  'shadcn',
  'radix',
  'mantine',
  'tremor',
  'heroui',
  'nextui',
  'headlessui',
]);

/**
 * Build a retrieval query string from structured design intent (not "beautiful React UI").
 */
export function buildIntentQuery(q: KnowledgeRetrievalQuery): string {
  if (q.spec) {
    return [
      specProductCategory(q.spec),
      specPersonality(q.spec),
      specConcept(q.spec),
      specVisualMetaphor(q.spec),
      specDesignLanguage(q.spec),
      q.spec.layout_system.max_width,
      specDisplayFamily(q.spec),
      specHeroVisual(q.spec),
      specSignatureType(q.spec),
      specImageryStrategy(q.spec),
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    q.productCategory,
    q.personality,
    q.artDirection,
    q.visualMetaphor,
    q.layoutType,
    q.typography,
    q.interactionStyle,
    q.requiredComponent,
    q.technologyStack,
    q.rawQuery,
  ]
    .filter(Boolean)
    .join(' ');
}

export function classifySourceKind(sourceId: string): KnowledgeKind {
  if (IMPLEMENTATION_SOURCE_IDS.has(sourceId)) return 'implementation';
  if (DESIGN_SOURCE_IDS.has(sourceId)) return 'design';
  // Default: treat unknown curated guides as design if "layout/pattern", else implementation
  if (/layout|pattern|motion|effect|visual|three/i.test(sourceId)) return 'design';
  return 'implementation';
}

/**
 * Retrieve and transform references into concise DesignReferenceCards.
 * Does NOT dump repositories into context.
 */
export function retrieveSplitKnowledge(
  query: KnowledgeRetrievalQuery,
  options: { limit?: number; maxChars?: number } = {},
): {
  queryText: string;
  design: DesignReferenceCard[];
  implementation: DesignReferenceCard[];
  designBlock: string;
  implementationBlock: string;
  sources: DesignSource[];
} {
  const queryText = buildIntentQuery(query);
  const limit = options.limit ?? 5;
  const maxChars = options.maxChars ?? 6_000;
  const sources = sourcesForQuery(queryText || 'ui layout typography', limit);
  const retrieved = retrieveDesignKnowledgeForSources(
    sources.map((s) => s.id),
    { query: queryText, maxChars },
  );

  const design: DesignReferenceCard[] = [];
  const implementation: DesignReferenceCard[] = [];

  for (const hit of retrieved.hits) {
    const kind = classifySourceKind(hit.sourceId);
    const card = hitToCard(hit, kind, query);
    if (kind === 'design') design.push(card);
    else implementation.push(card);
  }

  // Always include a synthetic card from the Design Spec signature when present
  if (query.spec && specSignaturePurpose(query.spec)) {
    design.unshift({
      pattern: specSignatureType(query.spec) || 'Product signature visual',
      why_relevant: specSignaturePurpose(query.spec),
      visual_characteristics: [
        specVisualMetaphor(query.spec),
        specDesignLanguage(query.spec),
        'product-specific (not decorative)',
      ].filter(Boolean),
      implementation_reference:
        'Prefer custom SVG / CSS composition / diagram; avoid MeshDistort blobs',
      source: 'design-specification',
      kind: 'design',
    });
  }

  return {
    queryText,
    design,
    implementation,
    designBlock: formatCardsBlock('DESIGN KNOWLEDGE (composition / type / metaphor)', design),
    implementationBlock: formatCardsBlock(
      'IMPLEMENTATION KNOWLEDGE (React / Tailwind / components — not art direction)',
      implementation,
    ),
    sources: retrieved.sources,
  };
}

function hitToCard(
  hit: { sourceId: string; sourceName: string; path: string; snippet: string },
  kind: KnowledgeKind,
  query: KnowledgeRetrievalQuery,
): DesignReferenceCard {
  const chars = extractVisualCharacteristics(hit.snippet);
  return {
    pattern: `${hit.sourceName} — ${hit.path.split('/').pop()}`,
    why_relevant: whyRelevant(query, hit.sourceName),
    visual_characteristics: chars,
    implementation_reference: truncate(hit.snippet, 400),
    source: `${hit.sourceId}:${hit.path}`,
    kind,
  };
}

function whyRelevant(query: KnowledgeRetrievalQuery, sourceName: string): string {
  if (query.spec) {
    return `Supports ${specProductCategory(query.spec)} / ${specVisualMetaphor(query.spec)} via ${sourceName}`;
  }
  return `Relevant to ${buildIntentQuery(query) || 'frontend task'} via ${sourceName}`;
}

function extractVisualCharacteristics(snippet: string): string[] {
  const out: string[] = [];
  if (/mono|font-mono|plex/i.test(snippet)) out.push('monospace labels / technical type');
  if (/grid|flex|max-w/i.test(snippet)) out.push('structured layout rhythm');
  if (/border|hairline|divide/i.test(snippet)) out.push('restrained borders');
  if (/motion|animate|transition/i.test(snippet)) out.push('intentional motion hooks');
  if (/svg|path|diagram/i.test(snippet)) out.push('vector / diagram affordances');
  if (!out.length) out.push('reusable UI pattern');
  return out.slice(0, 5);
}

function formatCardsBlock(title: string, cards: DesignReferenceCard[]): string {
  if (!cards.length) {
    return `${title}\n(none retrieved)`;
  }
  return [
    title,
    ...cards.map(
      (c) =>
        JSON.stringify(
          {
            pattern: c.pattern,
            why_relevant: c.why_relevant,
            visual_characteristics: c.visual_characteristics,
            implementation_reference: c.implementation_reference
              ? truncate(c.implementation_reference, 280)
              : undefined,
            source: c.source,
          },
          null,
          2,
        ),
    ),
  ].join('\n\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

/** Convenience: design-intent retrieval for Design Director (design cards only). */
export function retrieveDesignReferencesForDirector(
  query: KnowledgeRetrievalQuery,
): string {
  const { designBlock } = retrieveSplitKnowledge(query, { limit: 4, maxChars: 4_000 });
  return designBlock;
}

export { retrieveDesignKnowledge };
