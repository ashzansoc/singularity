import { describe, expect, it } from 'vitest';
import { applyIntentRules } from '../src/intent/rules.js';
import { extractFeatures } from '../src/features.js';
import { INTENT_DEFAULT_TIER } from '../src/tiers.js';
import type { RouteContext } from '../src/types.js';

function featuresFrom(partial: Partial<RouteContext> & Pick<RouteContext, 'prompt' | 'mode'>) {
  return extractFeatures(partial);
}

describe('RuleIntentClassifier', () => {
  it('maps autocomplete mode to AUTOCOMPLETE with full confidence', () => {
    const f = featuresFrom({ prompt: 'const x =', mode: 'autocomplete' });
    const result = applyIntentRules(f);
    expect(result.intent).toBe('AUTOCOMPLETE');
    expect(result.confidence).toBe(1);
    expect(INTENT_DEFAULT_TIER[result.intent]).toBe('T0');
  });

  it('maps agent mode to AGENT', () => {
    const f = featuresFrom({ prompt: 'fix the login bug', mode: 'agent' });
    const result = applyIntentRules(f);
    expect(result.intent).toBe('AGENT');
    expect(result.matchedRule).toBe('mode-agent');
  });

  it('maps inline mode to INLINE_EDIT', () => {
    const f = featuresFrom({ prompt: 'rename this', mode: 'inline' });
    expect(applyIntentRules(f).intent).toBe('INLINE_EDIT');
  });

  it('detects refactor keywords', () => {
    const f = featuresFrom({ prompt: 'Please refactor this module', mode: 'chat' });
    const result = applyIntentRules(f);
    expect(result.intent).toBe('REFACTOR');
    expect(INTENT_DEFAULT_TIER[result.intent]).toBe('T5');
  });

  it('detects explain keywords', () => {
    const f = featuresFrom({ prompt: 'explain what this function does', mode: 'chat' });
    expect(applyIntentRules(f).intent).toBe('EXPLAIN');
  });

  it('detects debug from bug keywords', () => {
    const f = featuresFrom({ prompt: 'there is a bug in the parser', mode: 'chat' });
    expect(applyIntentRules(f).intent).toBe('DEBUG');
  });

  it('detects review', () => {
    const f = featuresFrom({ prompt: 'code review this PR please', mode: 'chat' });
    expect(applyIntentRules(f).intent).toBe('REVIEW');
  });

  it('detects test intent', () => {
    const f = featuresFrom({ prompt: 'write unit tests for AuthService', mode: 'chat' });
    expect(applyIntentRules(f).intent).toBe('TEST');
  });

  it('falls back to UNKNOWN with low confidence', () => {
    const f = featuresFrom({ prompt: 'hello', mode: 'chat' });
    const result = applyIntentRules(f);
    expect(result.intent).toBe('UNKNOWN');
    expect(result.confidence).toBe(0.3);
  });
});
