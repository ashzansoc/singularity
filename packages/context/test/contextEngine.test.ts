import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HeuristicContextExtractor,
  applyUserOverride,
  createContextEngine,
  getRelevantContext,
  mergeDelta,
  emptyProjectState,
  shouldExtract,
  redactSecrets,
  ProjectStateStore,
} from '../src/index.js';

describe('shouldExtract', () => {
  it('skips trivial messages', () => {
    expect(shouldExtract('Thanks')).toBe(false);
    expect(shouldExtract('Okay')).toBe(false);
    expect(shouldExtract('Looks good')).toBe(false);
    expect(shouldExtract('Run it')).toBe(false);
  });

  it('accepts requirement-like messages', () => {
    expect(shouldExtract('Use PostgreSQL instead.')).toBe(true);
    expect(shouldExtract("Don't use Firebase.")).toBe(true);
    expect(
      shouldExtract(
        'Build a SaaS application with Google login and Stripe subscriptions.',
      ),
    ).toBe(true);
  });
});

describe('redactSecrets', () => {
  it('redacts api keys and passwords', () => {
    const out = redactSecrets(
      'api_key=sk_live_abcdefghijklmnopqrstuvwxyz password=hunter2',
    );
    expect(out).toContain('[REDACTED');
    expect(out).not.toContain('hunter2');
  });
});

describe('heuristic extraction', () => {
  const extractor = new HeuristicContextExtractor();

  it('extracts requirements, technologies, prohibitions', async () => {
    const res = await extractor.extract({
      text: 'I want a SaaS application with Google login, Stripe subscriptions, PostgreSQL, dark mode, and an admin dashboard. Do not use Firebase.',
      source_metadata: { type: 'conversation', message_id: 'm1' },
    });
    expect(res.raw_item_count).toBeGreaterThan(0);
    expect(res.delta.prohibitions?.some((p) => /firebase/i.test(p.prohibition))).toBe(
      true,
    );
    expect(res.delta.technologies?.some((t) => t.name === 'PostgreSQL')).toBe(true);
    expect(res.delta.requirements?.length).toBeGreaterThan(0);
  });

  it('marks speculative Redis as proposed/low confidence', async () => {
    const res = await extractor.extract({
      text: 'Maybe Redis would be useful for caching.',
    });
    const redis = res.delta.technologies?.find((t) => t.name === 'Redis');
    expect(redis?.status).toBe('proposed');
    expect(redis?.confidence).toBeLessThan(0.5);
  });

  it('extracts preference without hard constraint', async () => {
    const res = await extractor.extract({
      text: "I'd prefer the UI to feel like Linear.",
    });
    expect(res.delta.user_preferences?.[0]?.preference).toMatch(/Linear/i);
  });
});

describe('merge + supersession', () => {
  it('supersedes MongoDB when switching to PostgreSQL', async () => {
    let state = emptyProjectState('p1');
    const first = await new HeuristicContextExtractor().extract({
      text: 'Use MongoDB.',
    });
    state = mergeDelta(state, first.delta).state;
    expect(state.technologies.some((t) => t.name === 'MongoDB' && t.status === 'active')).toBe(
      true,
    );

    const second = await new HeuristicContextExtractor().extract({
      text: "Actually, let's use PostgreSQL instead of MongoDB.",
      existing_state: state,
    });
    const merged = mergeDelta(state, second.delta);
    state = merged.state;
    const mongo = state.technologies.find((t) => t.name === 'MongoDB');
    const pg = state.technologies.find((t) => t.name === 'PostgreSQL');
    expect(pg?.status).toBe('active');
    expect(mongo?.status).toBe('superseded');
    expect(merged.stats.superseded).toBeGreaterThan(0);
  });

  it('never overwrites user_override with automatic extraction', () => {
    let state = emptyProjectState('p1');
    state = applyUserOverride(state, 'technology', 'PostgreSQL', {
      category: 'database',
    });
    const delta = {
      technologies: [
        {
          name: 'MongoDB',
          category: 'database',
          status: 'active' as const,
          confidence: 0.9,
          source_type: 'explicit' as const,
          source: { type: 'conversation' as const },
        },
      ],
    };
    state = mergeDelta(state, delta).state;
    const pg = state.technologies.find((t) => t.name === 'PostgreSQL');
    expect(pg?.status).toBe('active');
    expect(pg?.source_type).toBe('user_override');
    // Should raise open question rather than silently overwrite
    expect(
      state.open_questions.length > 0 ||
        state.technologies.every(
          (t) => t.name !== 'MongoDB' || t.status !== 'active',
        ),
    ).toBe(true);
  });
});

describe('ProjectStateStore', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('persists and versions state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sing-ctx-'));
    dirs.push(root);
    const engine = createContextEngine({
      workspaceRoot: root,
      heuristicOnly: true,
      flags: { context_engine_enabled: true, langextract_enabled: false },
    });
    await engine.ingestMessage(
      'Use Next.js and TypeScript. Do not use Firebase.',
      { type: 'conversation', message_id: '1' },
      { force: true },
    );
    const store = new ProjectStateStore(root);
    const loaded = store.load();
    expect(loaded.meta.version).toBeGreaterThan(0);
    expect(loaded.prohibitions.some((p) => /firebase/i.test(p.prohibition))).toBe(
      true,
    );
    expect(store.listVersions().length).toBeGreaterThan(0);
    engine.dispose();
  });
});

describe('retrieval', () => {
  it('returns task-relevant subset', async () => {
    const engine = createContextEngine({
      workspaceRoot: mkdtempSync(join(tmpdir(), 'sing-ctx-r-')),
      heuristicOnly: true,
      flags: { context_engine_enabled: true, langextract_enabled: false },
    });
    await engine.ingestMessage(
      'Build SaaS with Stripe subscriptions and PostgreSQL. Users must cancel subscriptions. Do not use Firebase.',
      { type: 'conversation' },
      { force: true },
    );
    const rel = engine.getRelevant('Implement Stripe subscription cancellation');
    expect(rel.prompt_block.length).toBeGreaterThan(0);
    expect(rel.estimated_tokens).toBeLessThan(
      JSON.stringify(engine.getState()).length,
    );
    expect(
      rel.requirements.some((r) => /cancel/i.test(r.description)) ||
        rel.technologies.some((t) => t.name === 'Stripe') ||
        rel.constraints.length > 0,
    ).toBe(true);
    engine.dispose();
  });
});

describe('ContextEngine fallback', () => {
  it('works with heuristic when langextract disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sing-ctx-f-'));
    const engine = createContextEngine({
      workspaceRoot: root,
      flags: {
        context_engine_enabled: true,
        langextract_enabled: false,
      },
      heuristicOnly: true,
    });
    const res = await engine.ingestMessage('Use TypeScript.', undefined, {
      force: true,
    });
    expect(res.skipped).toBe(false);
    expect(engine.counts().technologies).toBeGreaterThan(0);
    engine.dispose();
  });

  it('no-ops when disabled', async () => {
    const engine = createContextEngine({
      workspaceRoot: mkdtempSync(join(tmpdir(), 'sing-ctx-d-')),
      flags: { context_engine_enabled: false },
    });
    const res = await engine.ingestMessage('Use PostgreSQL.');
    expect(res.skipped).toBe(true);
    expect(engine.getState().meta.version).toBe(0);
    engine.dispose();
  });
});

describe('getRelevantContext scoring', () => {
  it('includes hard constraints even with weak lexical overlap when few', () => {
    const state = emptyProjectState('x');
    state.constraints.push({
      id: 'c1',
      constraint: 'Use TypeScript',
      kind: 'technology',
      strength: 'hard',
      status: 'active',
      confidence: 1,
      confidence_category: 'high',
      source_type: 'explicit',
      source: { type: 'conversation' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const rel = getRelevantContext(state, { task: 'add a button' });
    expect(rel.constraints.length).toBe(1);
  });
});
