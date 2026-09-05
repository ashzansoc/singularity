import { describe, expect, it } from 'vitest';
import { createRoutingEngine } from '../src/engine.js';

describe('RoutingEngine', () => {
  it('routes autocomplete to a T0 model', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({
      prompt: 'function add(a, b) {',
      mode: 'autocomplete',
    });
    expect(decision.intent).toBe('AUTOCOMPLETE');
    expect(decision.tier).toBe('T0');
    expect(decision.fallbackChain.length).toBeGreaterThan(0);
    expect(decision.fromCache).toBe(false);
  });

  it('routes refactor requests toward premium tiers', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({
      prompt: 'refactor the auth module across files',
      mode: 'chat',
      openFileCount: 4,
    });
    expect(decision.intent).toBe('REFACTOR');
    expect(['T5', 'T6']).toContain(decision.tier);
  });

  it('escalates along the fallback chain', () => {
    const engine = createRoutingEngine();
    const first = engine.route({
      prompt: 'explain this code',
      mode: 'chat',
    });
    expect(first.fallbackChain.length).toBeGreaterThan(0);

    const second = engine.escalate(first, 'timeout');
    expect(second).toBeDefined();
    expect(second!.model.id).toBe(first.fallbackChain[0]);
    expect(second!.fallbackChain[0]).toBe(first.fallbackChain[1]);
    expect(second!.systemPromptHint).toContain('escalated:timeout');
  });

  it('returns undefined when fallback chain is exhausted', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({ prompt: 'hi', mode: 'chat' });
    let current = { ...decision, fallbackChain: [] as string[] };
    expect(engine.escalate(current, 'provider_error')).toBeUndefined();
  });

  it('caches identical chat routes', () => {
    const engine = createRoutingEngine({ cacheTtlMs: 60_000 });
    const ctx = { prompt: 'what is a closure?', mode: 'chat' as const };
    const a = engine.route(ctx);
    const b = engine.route(ctx);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(b.model.id).toBe(a.model.id);
  });

  it('does not cache agent routes', () => {
    const engine = createRoutingEngine();
    const ctx = { prompt: 'implement feature X', mode: 'agent' as const, requiresTools: true };
    const a = engine.route(ctx);
    const b = engine.route(ctx);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(false);
  });
});
