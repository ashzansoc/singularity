import { describe, expect, it } from 'vitest';
import {
  FRONTEND_OWNER_MODEL_ID,
  createDefaultDna,
  formatDnaForPrompt,
  mergeDesignDna,
  extractDnaSignalsFromFiles,
  sourcesForQuery,
  buildFrontendContext,
  inferSpecialtyFromPaths,
} from '../src/index.js';

describe('@singularity/design', () => {
  it('owns frontend with Qwen 3.6 27B', () => {
    expect(FRONTEND_OWNER_MODEL_ID).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('formats Design DNA for prompts', () => {
    const dna = createDefaultDna('ws');
    const block = formatDnaForPrompt(dna);
    expect(block).toContain('Design DNA');
    expect(block).toContain('Syne');
    expect(block).toContain('4px base grid');
  });

  it('retrieves tremor for dashboard queries', () => {
    const sources = sourcesForQuery('analytics dashboard with charts and KPIs');
    expect(sources.some((s) => s.id === 'tremor')).toBe(true);
  });

  it('builds frontend context bundle with taste rules', () => {
    const bundle = buildFrontendContext({
      task: 'Build a SaaS dashboard UI to upload CSVs and show analytics',
      dna: createDefaultDna('demo'),
    });
    expect(bundle.modelId).toBe(FRONTEND_OWNER_MODEL_ID);
    expect(bundle.systemPrompt).toContain('Frontend Implementer');
    expect(bundle.systemPrompt).toContain('ART DIRECTION AUTHORITY');
    expect(bundle.systemPrompt).toContain('DO NOT AUTOMATICALLY DEFAULT');
    expect(bundle.knowledgeBlock.length).toBeGreaterThan(100);
  });

  it('merges DNA from generated files', () => {
    const dna = createDefaultDna('ws');
    const patch = extractDnaSignalsFromFiles([
      {
        path: 'src/components/ui/button.tsx',
        content: `import * as React from 'react'\nimport { Slot } from '@radix-ui/react-slot'\nclassName="rounded-lg font-sans Inter duration-200"`,
      },
    ]);
    const next = mergeDesignDna(dna, patch);
    expect(next.components).toContain('Radix');
    expect(next.radiusPx).toBe(8);
  });

  it('infers frontend specialty from paths', () => {
    expect(inferSpecialtyFromPaths(['src/components/Dashboard.tsx', 'src/index.css'])).toBe(
      'frontend',
    );
    expect(inferSpecialtyFromPaths(['api/server.ts', 'prisma/schema.prisma'])).toBe('backend');
  });
});
