import { describe, expect, it } from 'vitest';
import { createRoutingEngine } from '../src/engine.js';
import {
  DEFAULT_MODEL_CATALOG,
  TIER_RECOMMENDED_MODELS,
  assertCatalogCoversRecommendations,
  findBySubTier,
  isModelEligibleForTier,
} from '../src/models/catalog.js';
import { callWhenScore } from '../src/modelMatcher.js';
import { extractFeatures } from '../src/features.js';

describe('Vercel tier catalog + sub-tiers', () => {
  it('covers every recommended model id', () => {
    expect(() => assertCatalogCoversRecommendations()).not.toThrow();
  });

  it('defines primary DeepSeek Flash / Pro-0813 slots used by Auto', () => {
    expect(TIER_RECOMMENDED_MODELS.T0[0]).toBe('deepseek/deepseek-v4-flash-0731');
    expect(TIER_RECOMMENDED_MODELS.T0[3]).toBe('google/gemini-2.5-flash');
    expect(TIER_RECOMMENDED_MODELS.T1[0]).toBe('deepseek/deepseek-v4-pro-0813');
    expect(TIER_RECOMMENDED_MODELS.T2[0]).toBe('deepseek/deepseek-v4-pro-0813');
    expect(findBySubTier(DEFAULT_MODEL_CATALOG, 'T0.4')?.capabilities.vision).toBe(true);
    expect(findBySubTier(DEFAULT_MODEL_CATALOG, 'T2.1')?.id).toBe(
      'deepseek/deepseek-v4-pro-0813',
    );
  });

  it('routes autocomplete to T0.1 flash model', () => {
    const decision = createRoutingEngine().route({
      prompt: 'const x =',
      mode: 'autocomplete',
    });
    expect(decision.tier).toBe('T0');
    expect(decision.subTier).toMatch(/^T0\./);
    expect(isModelEligibleForTier(decision.model, 'T0')).toBe(true);
    expect(decision.model.capabilities.speed).toBe('ultra_fast');
  });

  it('prefers vision-capable T0.4 when images are present', () => {
    const decision = createRoutingEngine().route({
      prompt: 'explain this UI screenshot',
      mode: 'chat',
      hasImages: true,
    });
    expect(decision.model.supportsVision).toBe(true);
  });

  it('scores callWhen tags for regex / bash toward T0.2', () => {
    const features = extractFeatures({ prompt: 'write a regex for emails', mode: 'chat' });
    const flash = findBySubTier(DEFAULT_MODEL_CATALOG, 'T0.2')!;
    const score = callWhenScore(flash, features, 'INLINE_EDIT');
    expect(score).toBeGreaterThan(0);
  });

  it('routes explain to T2 documentation models', () => {
    const decision = createRoutingEngine().route({
      prompt: 'explain what this function does',
      mode: 'chat',
    });
    expect(decision.tier).toBe('T2');
    expect(isModelEligibleForTier(decision.model, 'T2')).toBe(true);
  });

  it('routes debug to T3 DeepSeek Pro-0813', () => {
    const decision = createRoutingEngine().route({
      prompt: 'fix the bug in this stack trace',
      mode: 'chat',
    });
    expect(decision.tier).toBe('T3');
    expect(isModelEligibleForTier(decision.model, 'T3')).toBe(true);
  });

  it('routes refactor to T5 DeepSeek Pro-0813', () => {
    const decision = createRoutingEngine().route({
      prompt: 'refactor the auth module across files',
      mode: 'chat',
      openFileCount: 4,
    });
    expect(decision.tier).toBe('T5');
    expect(isModelEligibleForTier(decision.model, 'T5')).toBe(true);
  });

  it('exposes capability fields on every catalog model', () => {
    for (const m of DEFAULT_MODEL_CATALOG) {
      expect(m.capabilities.coding).toBeGreaterThanOrEqual(1);
      expect(m.capabilities.coding).toBeLessThanOrEqual(10);
      expect(m.capabilities.reasoning).toBeGreaterThanOrEqual(1);
      expect(['ultra_fast', 'fast', 'balanced', 'premium']).toContain(m.capabilities.speed);
      expect(['very_low', 'low', 'medium', 'high']).toContain(m.capabilities.cost);
      expect(['128k', '256k', '1m']).toContain(m.capabilities.context);
      expect(m.subTier).toMatch(/^T[0-6]\.[1-5]$/);
    }
  });
});
