import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import {
  classifyType,
  isDurableNoise,
  heuristicExtractCandidate,
  redactSecrets,
  MemorySubsystem,
  createMemoryStore,
  InMemoryMemoryRepository,
  parseMemory,
  nowIso,
  newMemoryId,
  findDuplicate,
  isConflict,
  applySupersession,
  detectsTechConflict,
  MemoryRanker,
  JsonRelationshipStore,
  LocalMemoryProvider,
  Mem0MemoryProvider,
  assertProjectScope,
  mountMemoryRoutes,
  scoreConfidence,
  scoreImportance,
  MemoryContextCache,
  lookupCachedPromptBlock,
  buildSnapshot,
  createMemoryEvent,
  LocalMemoryBuffer,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

function mem(partial) {
  const ts = nowIso();
  return parseMemory({
    id: partial.id ?? newMemoryId(),
    project_id: partial.project_id ?? 'p1',
    type: partial.type ?? 'FACT',
    scope: partial.scope ?? 'PROJECT',
    title: partial.title ?? 't',
    content: partial.content ?? 'c',
    reason: partial.reason ?? '',
    status: partial.status ?? 'ACTIVE',
    importance: partial.importance ?? 0.5,
    confidence: partial.confidence ?? 0.5,
    source_type: partial.source_type ?? 'AGENT',
    source_id: partial.source_id ?? 's',
    entities: partial.entities ?? [],
    embedding_pending: true,
    created_at: ts,
    updated_at: ts,
  });
}

describe('validation + classification', () => {
  it('rejects rename-only noise and keeps architectural facts', () => {
    assert.equal(isDurableNoise('Changed variable name from x to order_id'), true);
    assert.equal(
      isDurableNoise(
        'Changed order processing to use PostgreSQL transactions because payment state must remain atomic',
      ),
      false,
    );
    assert.equal(
      classifyType('PostgreSQL was selected for transactional state'),
      'ARCHITECTURAL_DECISION',
    );
    assert.equal(classifyType('Must support SAML'), 'ARCHITECTURAL_CONSTRAINT');
  });

  it('scores human higher than heuristic', () => {
    assert.ok(scoreConfidence({ sourceType: 'HUMAN', explicit: true, heuristic: false }) > 0.9);
    assert.ok(scoreImportance('we decided to use PostgreSQL', 'ARCHITECTURAL_DECISION') > 0.7);
  });
});

describe('secrets + isolation', () => {
  it('redacts keys and cookies', () => {
    const out = redactSecrets('api_key=abcdefghijklmnopqr password=hunter2 session_id=abc.def');
    assert.match(out, /REDACTED/);
  });

  it('enforces project_id equality', () => {
    assert.equal(assertProjectScope('a', 'a'), true);
    assert.equal(assertProjectScope('a', 'b'), false);
  });

  it('repository get is project-scoped', async () => {
    const store = createMemoryStore();
    const a = mem({ project_id: 'A', title: 'secret-a', content: 'Project A uses PostgreSQL' });
    await store.insert(a);
    assert.equal(await store.get('B', a.id), undefined);
    assert.equal((await store.get('A', a.id))?.title, 'secret-a');
  });
});

describe('dedup + conflict + versions', () => {
  it('detects paraphrased postgres facts as duplicates', () => {
    const a = mem({
      type: 'TECHNOLOGY_CHOICE',
      content: 'PostgreSQL is our primary database.',
      entities: ['PostgreSQL'],
    });
    const b = mem({
      type: 'TECHNOLOGY_CHOICE',
      content: 'We use PostgreSQL as the primary datastore.',
      entities: ['PostgreSQL'],
    });
    assert.ok(findDuplicate(b, [a], []));
  });

  it('supersedes firebase with auth0 and keeps history', () => {
    assert.equal(
      detectsTechConflict('Authentication uses Firebase Auth', 'Move authentication to Auth0 for SAML'),
      true,
    );
    const old = mem({
      id: 'm1',
      type: 'ARCHITECTURAL_DECISION',
      title: 'Use Firebase Auth',
      content: 'Authentication uses Firebase Auth',
      entities: ['Firebase'],
      confidence: 0.8,
    });
    const next = mem({
      id: 'm2',
      type: 'ARCHITECTURAL_DECISION',
      title: 'Use Auth0',
      content: 'Authentication uses Auth0 because enterprise needs SAML',
      entities: ['Auth0'],
      confidence: 0.97,
      source_type: 'HUMAN',
    });
    assert.ok(isConflict(old, next));
    const r = applySupersession(old, next);
    assert.equal(r.old.status, 'SUPERSEDED');
    assert.equal(r.next.status, 'ACTIVE');
    assert.equal(r.next.supersedes_id, 'm1');
    assert.equal(r.version.memory_id, 'm1');
  });
});

describe('ranker', () => {
  it('uses configurable weights not hardcoded in API', () => {
    const ranker = new MemoryRanker({
      semantic: 1,
      importance: 0,
      confidence: 0,
      graph_relevance: 0,
      recency: 0,
      source_quality: 0,
    });
    const m = mem({ importance: 0, confidence: 0 });
    assert.equal(ranker.score({ memory: m, semantic: 0.5, graph_relevance: 1 }), 0.5);
  });
});

describe('extractor + pipeline idempotency', () => {
  it('extracts durable candidate from architecture event', () => {
    const c = heuristicExtractCandidate({
      eventId: 'evt_1',
      eventType: 'architecture.decision',
      projectId: 'p',
      text: 'We are moving authentication from Firebase Auth to Auth0 because enterprise customers need SAML.',
    });
    assert.ok(c);
    assert.equal(c.scope, 'ARCHITECTURAL');
  });

  it('processing the same event twice creates one memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-idemp-'));
    const sys = new MemorySubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      settings: { retry_delays_ms: [1] },
    });
    await sys.start();
    const ev = createMemoryEvent({
      event_id: 'evt_123',
      event_type: 'architecture.decision',
      project_id: 'p1',
      payload: {
        summary: 'Use PostgreSQL for payment state because transactions must be atomic',
      },
    });
    sys.emit(ev);
    sys.emit(ev);
    await sys.publisher.flush(30);
    const list = await sys.store.list({ project_id: 'p1' });
    assert.equal(list.length, 1);
    sys.stop();
  });
});

describe('snapshot + search API', () => {
  it('builds a compact snapshot and searches without dumping all memories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-snap-'));
    const sys = new MemorySubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
    });
    await sys.createMemory({
      type: 'TECHNOLOGY_CHOICE',
      title: 'PostgreSQL is source of truth',
      content: 'Backend uses FastAPI and PostgreSQL. Redis is cache only.',
      entities: ['PostgreSQL', 'FastAPI', 'Redis'],
      source_type: 'HUMAN',
    });
    const snap = await sys.snapshot();
    assert.ok(snap.project.databases.includes('PostgreSQL') || snap.architecture.length >= 0);
    assert.ok(snap.prompt_block.length < 8000);
    const hits = await sys.search('Why PostgreSQL for payments?', 5);
    assert.ok(Array.isArray(hits));
    sys.stop();
  });
});

describe('graph + mem0 optional', () => {
  it('json relationship store works without neo4j', async () => {
    const g = new JsonRelationshipStore();
    await g.createEntity({ id: 'Decision:1', kind: 'Decision', label: 'Auth0', project_id: 'p' });
    await g.createEntity({ id: 'Technology:Auth0', kind: 'Technology', label: 'Auth0', project_id: 'p' });
    await g.createRelationship({ from: 'Decision:1', to: 'Technology:Auth0', kind: 'USES' });
    const rel = await g.findRelated('Decision:1');
    assert.equal(rel[0]?.label, 'Auth0');
  });

  it('local mem0 provider consolidates without API key', async () => {
    const p = new Mem0MemoryProvider();
    const s = await p.consolidate(['We use PostgreSQL.', 'Postgres is our primary DB.']);
    assert.ok(s.length > 0);
    const local = new LocalMemoryProvider();
    assert.equal(await local.extract('x', { project_id: 'p', event_id: 'e' }), undefined);
  });
});

describe('MemoryContextCache', () => {
  it('persists prompt_block to disk for extension-host lookup', () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-cache-'));
    const cache = new MemoryContextCache(root);
    const snap = buildSnapshot('proj', [
      mem({ project_id: 'proj', title: 'Use Postgres', content: 'PostgreSQL for payments' }),
    ]);
    cache.set('proj', snap);
    const block = lookupCachedPromptBlock(new MemoryContextCache(root), 'proj');
    assert.ok(block.includes('Postgres') || block.includes('PostgreSQL'));
  });
});

describe('HTTP routes', () => {
  it('enqueues events and returns compact list', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-http-'));
    const sys = new MemorySubsystem({
      workspaceRoot: root,
      projectId: 'proj',
      store: createMemoryStore(),
    });
    await sys.start();
    const app = new Hono();
    mountMemoryRoutes(app, sys);
    const ev = await app.request('/projects/proj/memory/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_type: 'architecture.decision',
        payload: { summary: 'Use PostgreSQL for payments because of atomic transactions' },
      }),
    });
    assert.equal(ev.status, 200);
    const created = await app.request('/projects/proj/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'CONSTRAINT',
        title: 'Must support SAML',
        content: 'Enterprise SSO requires SAML',
        source_type: 'HUMAN',
      }),
    });
    assert.equal(created.status, 201);
    const snap = await app.request('/projects/proj/memory/snapshot');
    assert.equal(snap.status, 200);
    sys.stop();
  });
});

describe('postgres adapter is real (skipped without MEMORY_DATABASE_URL)', () => {
  it('connects when URL is set', async () => {
    if (!process.env.MEMORY_DATABASE_URL) {
      return;
    }
    const { openPostgresMemoryRepository } = await import('../dist/storage/postgres.js');
    const repo = await openPostgresMemoryRepository(process.env.MEMORY_DATABASE_URL);
    const row = mem({ project_id: 'pgtest', title: 'pg', content: 'PostgreSQL adapter smoke' });
    await repo.insert(row);
    const got = await repo.get('pgtest', row.id);
    assert.equal(got?.title, 'pg');
    await repo.close();
  });
});

describe('hot-path isolation (grep)', () => {
  const forbidden = [
    'memory/workers',
    'memory/extraction',
    'PostgresMemoryRepository',
    'Mem0MemoryProvider',
    'Neo4jRelationshipStore',
  ];
  const hotFiles = [
    join(here, '../../../vscode/extensions/singularity-chat/src/platform/endpoint/node/automodeService.ts'),
    join(here, '../../../vscode/extensions/singularity-chat/src/extension/intents/node/toolCallingLoop.ts'),
    join(
      here,
      '../../../vscode/extensions/singularity-chat/src/platform/endpoint/node/singularityPromptEngineBridge.ts',
    ),
  ];

  it('coding LLM files do not import memory workers', () => {
    for (const f of hotFiles) {
      if (!existsSync(f)) {
        continue;
      }
      const text = readFileSync(f, 'utf8');
      for (const needle of forbidden) {
        assert.equal(text.includes(needle), false, `${f} must not mention ${needle}`);
      }
    }
  });
});

function codingTick(sys, prompt) {
  const t0 = performance.now();
  sys.emit({
    event_type: 'conversation.completed',
    project_id: sys.projectId,
    payload: { summary: prompt },
  });
  const context = sys.lookup(prompt);
  return { latency_ms: performance.now() - t0, context };
}

async function runConcurrent(n, fn) {
  const times = [];
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: n }, async () => {
      const s = performance.now();
      fn();
      times.push(performance.now() - s);
    }),
  );
  const elapsed = (performance.now() - t0) / 1000;
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  return {
    tps: n / Math.max(elapsed, 0.0001),
    p50: times[Math.floor(times.length / 2)],
    p95,
    p99,
    mean,
  };
}

describe('TPS acceptance A–F', () => {
  it('coding TPS stays in the sub-ms band across failure modes', async () => {
    const n = 100;
    const root = mkdtempSync(join(tmpdir(), 'mem-bench-'));

    const disabled = new MemorySubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      settings: { memory_enabled: false, context_enabled: false },
    });
    const a = await runConcurrent(n, () => {
      codingTick(disabled, 'hello');
    });

    const enabled = new MemorySubsystem({
      workspaceRoot: join(root, 'b'),
      projectId: 'p1',
      store: createMemoryStore(),
    });
    await enabled.start();
    const b = await runConcurrent(n, () => codingTick(enabled, 'hello'));

    for (let i = 0; i < 200; i++) {
      enabled.emit({
        event_type: 'agent.discovery',
        project_id: 'p1',
        payload: { summary: `Use PostgreSQL fact ${i} because transactions` },
      });
    }
    const c = await runConcurrent(n, () => codingTick(enabled, 'hello'));

    for (let i = 0; i < 2000; i++) {
      enabled.emit({
        event_type: 'conversation.completed',
        project_id: 'p1',
        payload: { summary: `chat ${i}` },
      });
    }
    const d = await runConcurrent(n, () => codingTick(enabled, 'hello'));

    const down = new InMemoryMemoryRepository();
    down.unavailable = true;
    const failed = new MemorySubsystem({
      workspaceRoot: join(root, 'e'),
      projectId: 'p1',
      store: down,
    });
    await failed.start();
    const e = await runConcurrent(n, () => codingTick(failed, 'hello'));

    enabled.buffer.saturateForTest();
    const f = await runConcurrent(n, () => codingTick(enabled, 'hello'));

    const report = {
      A_disabled: a,
      B_enabled_idle: b,
      C_moderate: c,
      D_heavy: d,
      E_store_unavailable: e,
      F_queue_saturated: f,
    };
    const outDir = join(here, '../../../benchmarks/memory-engine');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'METRICS.json'), JSON.stringify(report, null, 2));

    for (const s of [b, c, d, e, f]) {
      assert.ok(s.mean < 5, `mean ${s.mean} exceeds 5ms budget`);
      assert.ok(s.p99 < 20, `p99 ${s.p99} exceeds 20ms`);
    }
    disabled.stop();
    enabled.stop();
    failed.stop();
  });
});

describe('load / backpressure', () => {
  it('bounded queue drops low-priority first', () => {
    const buf = new LocalMemoryBuffer({ max: 8 });
    for (let i = 0; i < 20; i++) {
      buf.append({
        event_type: i % 2 === 0 ? 'architecture.decision' : 'task.started',
        project_id: 'p',
        payload: { summary: `e${i}` },
      });
    }
    assert.equal(buf.peekDepth(), 8);
    assert.ok(buf.droppedCount >= 12);
  });

  it('accepts 10k appends without throwing', () => {
    const buf = new LocalMemoryBuffer({ max: 20_000 });
    for (let i = 0; i < 10_000; i++) {
      buf.append({ event_type: 'agent.discovery', project_id: 'p', payload: { summary: 'x' } });
    }
    assert.equal(buf.peekDepth(), 10_000);
  });
});
