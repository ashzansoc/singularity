import { describe, expect, it } from 'vitest';
import {
  createSegmentedContext,
  updateContextSegments,
  hashContent,
} from '../src/contextSegments.js';
import {
  decideConversationSwitch,
  escalateCandidateIfNeeded,
  applySwitchToState,
  providerOf,
} from '../src/conversationSwitch.js';

describe('contextSegments', () => {
  it('marks only changed segments dirty', () => {
    const a = updateContextSegments(undefined, 'c1', {
      system: 'sys',
      repository: 'repo-v1',
      conversation: 'hi',
      currentPrompt: 'hello',
    });
    expect(a.segments.system.dirty).toBe(true);
    expect(a.rebuiltTokens).toBe(a.totalTokens);

    const b = updateContextSegments(a, 'c1', {
      system: 'sys',
      repository: 'repo-v1',
      conversation: 'hi\nhello\nhey',
      currentPrompt: 'explain this bug',
    });
    expect(b.segments.system.dirty).toBe(false);
    expect(b.segments.repository.dirty).toBe(false);
    expect(b.segments.conversation.dirty).toBe(true);
    expect(b.segments.currentPrompt.dirty).toBe(true);
    expect(b.unchangedTokens).toBeGreaterThan(0);
    expect(b.rebuiltTokens).toBeLessThan(b.totalTokens);
  });

  it('hashes stably', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
  });

  it('resets when conversation id changes', () => {
    const a = createSegmentedContext('c1');
    const b = updateContextSegments(a, 'c2', { currentPrompt: 'x' });
    expect(b.conversationId).toBe('c2');
    expect(b.segments.currentPrompt.version).toBe(1);
  });
});

describe('conversationSwitch', () => {
  it('switches on first turn', () => {
    const d = decideConversationSwitch(undefined, {
      modelId: 'alibaba/qwen3.7-flash',
      provider: 'alibaba',
      tier: 'T0',
      subTier: 'T0.1',
      intent: 'UNKNOWN',
      confidence: 1,
    });
    expect(d.action).toBe('switch');
    expect(d.reason).toBe('first-turn');
  });

  it('upgrades when intent needs a higher tier', () => {
    const prev = applySwitchToState(
      undefined,
      'c1',
      decideConversationSwitch(undefined, {
        modelId: 'alibaba/qwen3.7-flash',
        provider: 'alibaba',
        tier: 'T0',
        subTier: 'T0.1',
        intent: 'UNKNOWN',
        confidence: 1,
      }),
      'h1',
      100,
    );
    const d = decideConversationSwitch(prev, {
      modelId: 'deepseek/deepseek-r1',
      provider: 'deepseek',
      tier: 'T3',
      subTier: 'T3.1',
      intent: 'DEBUG',
      confidence: 0.9,
      contextTokens: 5000,
    });
    expect(d.action).toBe('switch');
    expect(d.modelId).toBe('deepseek/deepseek-r1');
    expect(d.reason).toMatch(/upgrade|intent/);
  });

  it('downshifts to save cost on trivial follow-ups', () => {
    const prev = {
      conversationId: 'c1',
      turnCount: 2,
      modelId: 'openai/gpt-4.1',
      provider: 'openai',
      tier: 'T3',
      subTier: 'T3.3',
      intent: 'DEBUG',
      confidence: 0.9,
      estimatedContextTokens: 8000,
      lastPromptHash: 'x',
    };
    const d = decideConversationSwitch(prev, {
      modelId: 'alibaba/qwen3.7-flash',
      provider: 'alibaba',
      tier: 'T0',
      subTier: 'T0.1',
      intent: 'UNKNOWN',
      confidence: 1,
      contextTokens: 8200,
    });
    expect(d.action).toBe('switch');
    expect(d.reason).toBe('cost-downshift');
  });

  it('stays for affinity when large context and same provider', () => {
    const prev = {
      conversationId: 'c1',
      turnCount: 3,
      modelId: 'google/gemini-2.5-flash',
      provider: 'google',
      tier: 'T2',
      subTier: 'T2.2',
      intent: 'EXPLAIN',
      confidence: 0.8,
      estimatedContextTokens: 40_000,
      lastPromptHash: 'x',
    };
    const d = decideConversationSwitch(prev, {
      modelId: 'google/gemini-2.0-flash',
      provider: 'google',
      tier: 'T2',
      subTier: 'T2.2',
      intent: 'DOCUMENTATION',
      confidence: 0.85,
      contextTokens: 42_000,
    });
    expect(d.action).toBe('stay');
    expect(d.preservesProviderCache).toBe(true);
    expect(d.cacheReuseTokens).toBeGreaterThan(0);
  });

  it('escalates before stream when confidence is low', () => {
    const { candidate, escalated } = escalateCandidateIfNeeded(
      {
        modelId: 'alibaba/qwen3.7-flash',
        provider: 'alibaba',
        tier: 'T0',
        subTier: 'T0.1',
        intent: 'DEBUG',
        confidence: 0.55,
      },
      () => ({
        modelId: 'openai/gpt-4.1',
        provider: 'openai',
        tier: 'T3',
        subTier: 'T3.3',
        intent: 'DEBUG',
        confidence: 0.8,
      }),
    );
    expect(escalated).toBe(true);
    expect(candidate.modelId).toBe('openai/gpt-4.1');
  });

  it('keeps model only when confidence is up', () => {
    const { escalated } = escalateCandidateIfNeeded(
      {
        modelId: 'alibaba/qwen3.7-flash',
        provider: 'alibaba',
        tier: 'T0',
        subTier: 'T0.1',
        intent: 'UNKNOWN',
        confidence: 0.9,
      },
      () => ({
        modelId: 'openai/gpt-4.1',
        provider: 'openai',
        tier: 'T3',
        subTier: 'T3.3',
        intent: 'UNKNOWN',
        confidence: 0.9,
      }),
    );
    expect(escalated).toBe(false);
  });

  it('providerOf extracts vendor', () => {
    expect(providerOf('alibaba/qwen3.7-flash')).toBe('alibaba');
  });
});
