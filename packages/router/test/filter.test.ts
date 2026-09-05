import { describe, expect, it } from 'vitest';
import { CapabilityFilter, buildRequirements } from '../src/filter.js';
import { DEFAULT_MODEL_CATALOG } from '../src/models/catalog.js';
import { extractFeatures } from '../src/features.js';

describe('CapabilityFilter', () => {
  const filter = new CapabilityFilter();

  it('drops non-vision models when images are required', () => {
    const features = extractFeatures({
      prompt: 'describe this screenshot',
      mode: 'chat',
      hasImages: true,
    });
    const req = buildRequirements('EXPLAIN', features);
    expect(req.requiresVision).toBe(true);

    const passed = filter.filter(DEFAULT_MODEL_CATALOG, req);
    expect(passed.length).toBeGreaterThan(0);
    expect(passed.every((m) => m.supportsVision)).toBe(true);
  });

  it('drops models whose context window is too small', () => {
    const features = extractFeatures({
      prompt: 'summarize',
      mode: 'chat',
      contextTokens: 500_000,
    });
    const req = buildRequirements('EXPLAIN', features);
    const passed = filter.filter(DEFAULT_MODEL_CATALOG, req);
    expect(passed.every((m) => m.maxContext >= 500_000)).toBe(true);
    expect(passed.some((m) => m.id.includes('kimi-k3') || m.id.includes('gemini'))).toBe(true);
  });

  it('requires tools for agent mode', () => {
    const features = extractFeatures({
      prompt: 'implement feature',
      mode: 'agent',
      requiresTools: true,
    });
    const req = buildRequirements('AGENT', features);
    const passed = filter.filter(DEFAULT_MODEL_CATALOG, req);
    expect(passed.every((m) => m.supportsTools)).toBe(true);
    expect(passed.every((m) => m.tier !== 'T0' || m.supportsTools)).toBe(true);
  });
});
