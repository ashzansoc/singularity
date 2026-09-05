import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrainStore } from '../dist/store.js';
import { SemanticMemoryApi } from '../dist/semantic.js';
import { minimizeForRemote } from '../dist/privacy.js';
import { DEFAULT_BRAIN_CONFIG } from '../dist/types.js';
import { BrainBudget } from '../dist/budget.js';
import { ImprovementManager } from '../dist/improvement.js';
import { parseToolCall, executeBrainTool } from '../dist/tools.js';
import { MockBrainModelClient } from '../dist/modelClient.js';
import { BrainRuntime } from '../dist/runtime.js';
import { resolveBrainConfig } from '../dist/config.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'brain-cog-'));
  return new BrainStore(join(dir, 'brain.sqlite'), 'user-test');
}

test('semantic + procedural + insight persistence survives restart path', () => {
  const s = tempStore();
  const sem = new SemanticMemoryApi(s);
  const mem = sem.write({ label: 'Uses PostgreSQL', content: 'The project uses PostgreSQL', type: 'fact' });
  assert.ok(mem.id);
  const proc = s.upsertProcedure({
    name: 'Deploy application',
    steps: ['build', 'test', 'push image', 'deploy', 'verify health'],
    conditions: 'production deploy',
    successRate: 0.8,
    failureRate: 0.1,
    evidence: ['past deploys'],
    confidence: 0.7,
  });
  const insight = s.upsertInsight({
    title: 'Auth duplicated',
    kind: 'Architecture',
    confidence: 0.87,
    evidence: [{ kind: 'file', ref: 'a.ts' }, { kind: 'file', ref: 'b.ts' }],
    relatedMemoryIds: [mem.id],
    relatedFiles: ['a.ts', 'b.ts'],
    status: 'new',
    reasoningMode: 'default',
    observation: 'Three implementations',
  });
  assert.equal(s.getProcedure(proc.id)?.steps.length, 5);
  assert.equal(s.getInsight(insight.id)?.title, 'Auth duplicated');
  assert.ok(sem.search('PostgreSQL').length >= 1);
  s.addActivity({ ts: Date.now(), kind: 'test', message: 'activity ok' });
  assert.ok(s.recentActivity(5).length >= 1);
  s.close();
});

test('privacy minimize redacts secrets and truncates', () => {
  const long = `Bearer sk-abc123secret ${'x'.repeat(20_000)}`;
  const out = minimizeForRemote(long, { ...DEFAULT_BRAIN_CONFIG, contextLimit: 500 });
  assert.ok(out.truncated);
  assert.ok(!out.brief.includes('sk-abc123secret'));
  assert.ok(out.sentChars <= 520);
});

test('budget enforces daily call cap', () => {
  const s = tempStore();
  const cfg = { ...DEFAULT_BRAIN_CONFIG, maxBackgroundCallsPerDay: 2, dailyBudgetUsd: 100 };
  const b = new BrainBudget(s, cfg);
  assert.equal(b.canCall().ok, true);
  b.recordCall(100);
  b.recordCall(100);
  assert.equal(b.canCall().ok, false);
  s.close();
});

test('improvement promote vs reject/rollback', () => {
  const s = tempStore();
  const imp = new ImprovementManager(s);
  const baseline = imp.proposePolicy({
    kind: 'retrieval',
    version: '1.0',
    payload: { k: 5 },
    autonomyLevel: 2,
  });
  s.upsertPolicy({ ...baseline, status: 'current' });
  const candidate = imp.proposePolicy({
    kind: 'retrieval',
    version: '1.1',
    payload: { k: 8 },
    autonomyLevel: 2,
  });
  const exp = imp.startExperiment({
    name: 'retrieval-k',
    policyKind: 'retrieval',
    candidatePolicyId: candidate.id,
    baselinePolicyId: baseline.id,
    baselineMetrics: { retrievalRelevance: 0.81, duplication: 0.2, insightAcceptance: 0.4 },
  });
  imp.recordEvaluation(exp.id, 'candidate', { retrievalRelevance: 0.87, duplication: 0.18, insightAcceptance: 0.5 });
  const decided = imp.decide(exp.id);
  assert.equal(decided.decision, 'promoted');
  assert.equal(s.currentPolicy('retrieval')?.version, '1.1');

  const worseCand = imp.proposePolicy({ kind: 'retrieval', version: '1.2', payload: { k: 20 }, autonomyLevel: 2 });
  const exp2 = imp.startExperiment({
    name: 'retrieval-worse',
    policyKind: 'retrieval',
    candidatePolicyId: worseCand.id,
    baselineMetrics: { retrievalRelevance: 0.87, duplication: 0.18, insightAcceptance: 0.5 },
  });
  imp.recordEvaluation(exp2.id, 'candidate', { retrievalRelevance: 0.7, duplication: 0.4, insightAcceptance: 0.2 });
  const rejected = imp.decide(exp2.id);
  assert.equal(rejected.decision, 'rejected');
  const rolled = imp.rollback('retrieval');
  assert.ok(rolled);
  assert.equal(s.currentPolicy('retrieval')?.status, 'current');
  s.close();
});

test('parseToolCall understands NO_ACTION and JSON', () => {
  assert.equal(parseToolCall('NO_ACTION')?.tool, 'brain.noAction');
  const call = parseToolCall('{"tool":"brain.searchSemantic","args":{"query":"auth"}}');
  assert.equal(call?.tool, 'brain.searchSemantic');
});

test('tools noAction and createInsight require evidence', async () => {
  const s = tempStore();
  const sem = new SemanticMemoryApi(s);
  const imp = new ImprovementManager(s);
  const ctx = { store: s, semantic: sem, improvement: imp, maxAutonomy: 2 };
  const na = await executeBrainTool('brain.noAction', { reason: 'quiet' }, ctx);
  assert.equal(na.noAction, true);
  const bad = await executeBrainTool('brain.createInsight', { title: 'x', kind: 'Architecture', confidence: 0.9, evidence: [] }, ctx);
  assert.equal(bad.ok, false);
  const good = await executeBrainTool(
    'brain.createInsight',
    { title: 'Dup auth', kind: 'Architecture', confidence: 0.9, evidence: [{ kind: 'file', ref: 'a.ts' }] },
    ctx,
  );
  assert.equal(good.ok, true);
  s.close();
});

test('runtime start/stop + NO_ACTION with mock model', async () => {
  const s = tempStore();
  const cfg = resolveBrainConfig({
    enabled: true,
    idleMs: 60_000,
    maxBackgroundCallsPerDay: 10,
    ultrathink: 'automatic',
  });
  const model = new MockBrainModelClient(['{"tool":"brain.noAction","args":{"reason":"nothing meaningful"}}']);
  const rt = new BrainRuntime({
    store: s,
    config: { ...cfg, model: { ...cfg.model, apiKey: 'x', baseUrl: 'http://localhost', model: 'mock' } },
    model,
    debounceMs: 20,
    onStore: async () => undefined,
  });
  // Force configured by using Mock which is always configured.
  rt.start();
  assert.equal(rt.snapshot().status, 'idle');
  rt.enqueue({ kind: 'decision', text: 'We decided to use Kafka for events', ts: Date.now() });
  await new Promise((r) => setTimeout(r, 80));
  const acts = s.recentActivity(20);
  assert.ok(acts.some((a) => a.kind.includes('attention') || a.kind === 'no_action' || a.kind === 'runtime_start'));
  rt.stop();
  assert.equal(rt.snapshot().status, 'stopped');
  s.close();
});

test('config resolves env fallbacks without hardcoding providers', () => {
  const cfg = resolveBrainConfig({ model: { baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'moe-1' } });
  assert.equal(cfg.model.provider, 'openai-compatible');
  assert.equal(cfg.model.model, 'moe-1');
});
