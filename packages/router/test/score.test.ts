import { describe, expect, it } from 'vitest';
import { scoreCandidates } from '../src/score.js';
import { extractFeatures } from '../src/features.js';
import type { ModelSpec } from '../src/types.js';

function model(partial: Partial<ModelSpec> & Pick<ModelSpec, 'id' | 'costPer1MInput' | 'costPer1MOutput'>): ModelSpec {
  return {
    displayName: partial.id,
    provider: 'openrouter',
    tier: 'T1',
    subTier: 'T1.1',
    primaryPurpose: 'test',
    callWhen: [],
    doNotCall: [],
    capabilities: {
      speed: 'fast',
      coding: 7,
      reasoning: 6,
      longContext: 5,
      toolUse: 6,
      cost: 'low',
      context: '128k',
      vision: false,
      vendor: 'alibaba',
    },
    maxContext: 128_000,
    supportsTools: true,
    supportsVision: false,
    supportsJson: true,
    supportsStreaming: true,
    latencyMsP50: 500,
    reliability: 0.9,
    qualityByIntent: { INLINE_EDIT: 0.8, UNKNOWN: 0.8 },
    ...partial,
  };
}

const features = extractFeatures({ prompt: 'edit this function', mode: 'inline' });

describe('scoreCandidates', () => {
  it('prefers the cheaper model when quality is equal', () => {
    const cheap = model({
      id: 'cheap',
      costPer1MInput: 0.1,
      costPer1MOutput: 0.4,
      capabilities: {
        speed: 'fast',
        coding: 7,
        reasoning: 6,
        longContext: 5,
        toolUse: 6,
        cost: 'very_low',
        context: '128k',
        vision: false,
        vendor: 'deepseek',
      },
      qualityByIntent: { INLINE_EDIT: 0.8 },
    });
    const expensive = model({
      id: 'expensive',
      costPer1MInput: 3,
      costPer1MOutput: 15,
      capabilities: {
        speed: 'premium',
        coding: 7,
        reasoning: 6,
        longContext: 5,
        toolUse: 6,
        cost: 'high',
        context: '128k',
        vision: false,
        vendor: 'anthropic',
      },
      qualityByIntent: { INLINE_EDIT: 0.8 },
    });

    const scored = scoreCandidates([expensive, cheap], { intent: 'INLINE_EDIT', features });
    expect(scored[0]!.model.id).toBe('cheap');
  });

  it('applies user preference boost', () => {
    const a = model({
      id: 'a',
      costPer1MInput: 0.1,
      costPer1MOutput: 0.4,
      qualityByIntent: { INLINE_EDIT: 0.8 },
    });
    const b = model({
      id: 'b',
      costPer1MInput: 0.12,
      costPer1MOutput: 0.45,
      qualityByIntent: { INLINE_EDIT: 0.8 },
    });

    const withoutPref = scoreCandidates([a, b], { intent: 'INLINE_EDIT', features });
    expect(withoutPref[0]!.model.id).toBe('a');

    const withPref = scoreCandidates([a, b], {
      intent: 'INLINE_EDIT',
      features,
      userPreferenceModelIds: ['b'],
    });
    expect(withPref[0]!.model.id).toBe('b');
  });
});
