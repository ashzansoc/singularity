import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrainEngine } from '../dist/engine.js';
import { computeImportance } from '../dist/importance.js';
import { isTrivialForBrain, MemoryExtractor } from '../dist/extraction.js';

function tempEngine(llm) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-engine-'));
  return new BrainEngine({ storageDir: dir, userId: 'user-1', llm, startRuntime: false });
}

test('importance rewards degree and decisions', () => {
  const base = {
    id: 'e1', userId: 'u', type: 'concept', label: 'x', importance: 0, confidence: 0.8,
    sourceType: 't', firstSeenAt: Date.now(), lastSeenAt: Date.now(), degree: 0,
  };
  const low = computeImportance({ ...base });
  const connected = computeImportance({ ...base, degree: 20 });
  const decision = computeImportance({ ...base, type: 'decision', degree: 0 });
  assert.ok(connected > low);
  assert.ok(decision >= 0.45);
});

const KAFKA_JSON = JSON.stringify({
  durable: true,
  entities: [
    { type: 'decision', label: 'Kafka over Redis for events', description: 'Redis streams became a bottleneck', confidence: 0.9 },
    { type: 'technology', label: 'Kafka', confidence: 0.95 },
    { type: 'technology', label: 'Redis', confidence: 0.9 },
  ],
  relationships: [
    { source: { type: 'decision', label: 'Kafka over Redis for events' }, relType: 'replaced_by', target: { type: 'technology', label: 'Kafka' }, confidence: 0.85 },
  ],
  episode: { kind: 'decision', summary: 'Switched event streaming to Kafka' },
});

function llmReturning(payload) {
  return { complete: async () => payload };
}

test('observeChat stores durable decision and episode', async () => {
  const eng = tempEngine(llmReturning(KAFKA_JSON));
  await eng.observeChat('We decided to use Kafka instead of Redis for event streaming.');
  const results = await eng.search('kafka');
  assert.ok(results.length >= 1);
  assert.equal(results[0].entity.type === 'technology' || results[0].entity.type === 'decision', true);
  assert.ok(eng.recentEpisodes().length >= 1);
  eng.close();
});

test('trivial chat is never extracted (no LLM call)', async () => {
  let calls = 0;
  const eng = tempEngine({
    complete: async () => {
      calls++;
      return KAFKA_JSON;
    },
  });
  await eng.observeChat('hi');
  assert.equal(calls, 0);
  eng.close();
});

test('heuristic chat fallback captures decisions without an LLM', async () => {
  const eng = tempEngine(undefined);
  const obs = await eng.observeChat('We decided to use SQLite instead of JSON files for persistence.');
  assert.ok(obs, 'expected durable heuristic extraction');
  assert.equal(obs.durable, true);
  const labels = eng.getGraphView(100).nodes.map((n) => n.label.toLowerCase());
  assert.ok(labels.some((l) => l.includes('sqlite')), 'sqlite node created heuristically');
  eng.close();

  // And trivial chat still stays out.
  const quiet = tempEngine(undefined);
  const none = await quiet.observeChat('ok thanks!');
  assert.equal(none, undefined);
  quiet.close();
});

test('extractor drops relationships with unknown endpoints', async () => {
  const ex = new MemoryExtractor(
    llmReturning(
      JSON.stringify({
        durable: true,
        entities: [{ type: 'technology', label: 'Kafka', confidence: 0.9 }],
        relationships: [
          { source: { type: 'technology', label: 'Kafka' }, relType: 'uses', target: { type: 'technology', label: 'PhantomQueue' } },
        ],
      }),
    ),
  );
  const result = await ex.extract({ kind: 'chat', text: 'we use kafka now for the pipeline and it scales well overall' });
  assert.equal(result.durable, true);
  assert.equal(result.relationships.length, 0);
});

test('syncWorkspace builds a multi-center graph (no project star hub)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brain-ws-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { hono: '^4', 'node:sqlite': '*' } }));
  mkdirSync(join(dir, 'src', 'api'), { recursive: true });
  writeFileSync(join(dir, 'src', 'api', 'server.ts'), 'export function serve() { return "api"; }\n');
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  writeFileSync(join(dir, 'src', 'auth', 'login.ts'), 'export function login() { return true; }\n');

  const eng = tempEngine(undefined);
  const state = await eng.syncWorkspace(dir, 'demo');
  assert.equal(state.status, 'done');
  const view = eng.getGraphView(200);
  assert.ok(view.nodes.length >= 2, `expected entities, got ${view.nodes.length}`);
  const labels = view.nodes.map((n) => n.label.toLowerCase());
  assert.ok(labels.some((l) => l.includes('hono')), 'manifest dependency becomes a technology node');
  assert.ok(labels.some((l) => l.includes('architecture')), 'semantic architecture hub seeded');
  assert.ok(view.edges.length >= 3, `expected multi-hop edges, got ${view.edges.length}`);

  const projectNodes = view.nodes.filter((n) => n.type === 'project');
  assert.ok(projectNodes.length <= 2, 'at most a couple project nodes in view');
  for (const p of projectNodes) {
    const degree = view.edges.filter((e) => e.source === p.id || e.target === p.id).length;
    assert.ok(degree <= 4, `project degree should be small, got ${degree} for ${p.label}`);
  }
  const types = new Set(view.nodes.map((n) => n.type));
  assert.ok(types.has('architecture') || types.has('topic'), 'semantic layer present');
  assert.ok(types.has('code') || types.has('technology'), 'code/dependency layer present');
  // No legacy star: project must not own belongs_to / implemented_in edges.
  const projectIds = new Set(projectNodes.map((n) => n.id));
  for (const e of view.edges) {
    if (projectIds.has(e.source) && (e.relType === 'belongs_to' || e.relType === 'implemented_in' || e.relType === 'uses')) {
      assert.fail(`star-hub edge still present: project -[${e.relType}]->`);
    }
  }

  const stats = eng.stats();
  assert.ok(stats.entities > 0);
  eng.close();
});

test('reasoningContext returns layered multi-hop block', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brain-ctx-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { postgres: '^3' } }));
  const eng = tempEngine(undefined);
  await eng.syncWorkspace(dir, 'ctx-proj');
  const ctx = await eng.reasoningContext('postgres database setup');
  assert.ok(ctx.block.includes('Singularity Brain'));
  assert.ok(ctx.block.toLowerCase().includes('postgres') || ctx.dependencies.length > 0);
  eng.close();
});

test('sync extracts README concepts without inventing hub edges', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brain-docs-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'docs-demo', dependencies: {} }));
  writeFileSync(
    join(dir, 'README.md'),
    `# Docs Demo\n\n## Auth Pipeline\nHandles login.\n\n## Event Bus\nPub/sub layer.\n\n- Must keep sessions offline-first\n`,
  );
  const eng = tempEngine(undefined);
  await eng.syncWorkspace(dir, 'docs-demo');
  const view = eng.getGraphView(200);
  const labels = view.nodes.map((n) => n.label.toLowerCase());
  assert.ok(labels.some((l) => l.includes('auth pipeline')), 'README heading becomes a concept');
  assert.ok(view.nodes.some((n) => n.type === 'constraint'), 'must-line becomes a constraint');
  const project = view.nodes.find((n) => n.type === 'project');
  if (project) {
    const star = view.edges.filter(
      (e) => (e.source === project.id || e.target === project.id)
        && (e.relType === 'belongs_to' || e.relType === 'implemented_in'),
    );
    assert.equal(star.length, 0);
  }
  eng.close();
});

test('relevantContext returns compact block after sync', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'brain-ctx2-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { postgres: '^3' } }));
  const eng = tempEngine(undefined);
  await eng.syncWorkspace(dir, 'ctx-proj');
  const block = await eng.relevantContext('postgres database setup');
  assert.ok(block.includes('postgres') || block.toLowerCase().includes('postgres'));
  eng.close();
});
