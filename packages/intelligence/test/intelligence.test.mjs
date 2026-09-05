import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryContextGraph } from '@singularity/prompt';
import { IntelligenceEngine } from '../dist/engine.js';
import { MemoryGraphStore } from '../dist/memoryGraphStore.js';
import { JobQueue } from '../dist/queue.js';
import { formatContextBlock, impactForSymbol, retrieveContext } from '../dist/retriever.js';
import { ingestScipDump } from '../dist/scip.js';
import { SqliteGraphStore } from '../dist/sqliteGraphStore.js';
import { JOB_PRIORITY } from '../dist/types.js';
import { createIntelligenceApp } from '../dist/http.js';

function seedAuth(store) {
  const file = InMemoryContextGraph.makeNode({
    id: 'file:file:///src/auth/AuthService.ts',
    kind: 'file',
    label: 'file:///src/auth/AuthService.ts',
    content: 'export class AuthService { login() {} }',
    hash: 'h1',
    meta: { uri: 'file:///src/auth/AuthService.ts' },
  });
  const cls = InMemoryContextGraph.makeNode({
    id: 'file:file:///src/auth/AuthService.ts:class:AuthService:1',
    kind: 'class',
    label: 'AuthService',
    content: 'class AuthService { login() { this.session.create(); } }',
    meta: { uri: 'file:///src/auth/AuthService.ts', startLine: 1, parent: file.id },
  });
  const ctrl = InMemoryContextGraph.makeNode({
    id: 'file:file:///src/auth/AuthController.ts:class:AuthController:1',
    kind: 'class',
    label: 'AuthController',
    content: 'class AuthController { login() { auth.login(); } }',
    meta: { uri: 'file:///src/auth/AuthController.ts', startLine: 1 },
  });
  const session = InMemoryContextGraph.makeNode({
    id: 'file:file:///src/auth/SessionService.ts:class:SessionService:1',
    kind: 'class',
    label: 'SessionService',
    meta: { uri: 'file:///src/auth/SessionService.ts' },
  });
  store.upsertNodes([file, cls, ctrl, session]);
  store.upsertEdges([
    { id: 'e1', from: file.id, to: cls.id, kind: 'contains' },
    { id: 'e2', from: ctrl.id, to: cls.id, kind: 'calls' },
    { id: 'e3', from: cls.id, to: session.id, kind: 'calls' },
  ]);
  store.setFileMeta({
    uri: 'file:///src/auth/AuthService.ts',
    fileId: file.id,
    contentHash: 'h1',
    lastIndexedAt: Date.now(),
  });
  store.setStage({
    name: 'ast',
    status: 'complete',
    progress: 1,
    updatedAt: Date.now(),
  });
}

describe('MemoryGraphStore + retrieval', () => {
  it('finds AuthService without scanning a repo', () => {
    const store = new MemoryGraphStore();
    seedAuth(store);
    const hits = store.findSymbols('AuthService');
    assert.ok(hits.some((h) => h.name === 'AuthService'));
  });

  it('returns impact callers and callees', () => {
    const store = new MemoryGraphStore();
    seedAuth(store);
    const impact = impactForSymbol(store, 'AuthService', 2);
    assert.ok(impact.callers.some((c) => c.name === 'AuthController'));
    assert.ok(impact.callees.some((c) => c.name === 'SessionService'));
  });

  it('marks stale when live hash differs', () => {
    const store = new MemoryGraphStore();
    seedAuth(store);
    const res = retrieveContext(store, {
      query: 'authentication timeout AuthService',
      live: {
        getContentHash: () => 'different',
        getContent: () => 'export class AuthService { /* live */ }',
      },
    });
    assert.ok(res.stale.length > 0);
    assert.ok(res.context.some((c) => c.text.includes('live')));
    assert.ok(res.confidence > 0);
  });

  it('formats a compact prompt block', () => {
    const store = new MemoryGraphStore();
    seedAuth(store);
    const block = formatContextBlock(retrieveContext(store, { query: 'AuthService' }));
    assert.match(block, /AuthService/);
    assert.match(block, /confidence=/);
  });
});

describe('JobQueue', () => {
  it('dedupes and prioritizes active files', () => {
    const q = new JobQueue();
    q.enqueue('INDEX_FILE', { uri: 'a.ts', priority: JOB_PRIORITY.rest });
    q.enqueue('INDEX_FILE', { uri: 'a.ts', priority: JOB_PRIORITY.active_file });
    assert.equal(q.depth(), 1);
    const job = q.dequeue();
    assert.equal(job?.priority, JOB_PRIORITY.active_file);
  });
});

describe('SCIP ingest', () => {
  it('creates reference edges from a dump', () => {
    const store = new MemoryGraphStore();
    const n = ingestScipDump(
      store,
      {
        documents: [
          {
            relative_path: 'src/a.ts',
            occurrences: [{ symbol: 'pkg/a.ts/Foo#', symbol_roles: 1 }],
          },
          {
            relative_path: 'src/b.ts',
            occurrences: [{ symbol: 'pkg/a.ts/Foo#', symbol_roles: 8 }],
          },
        ],
      },
      '/repo',
    );
    assert.ok(n > 0);
    const edges = store.snapshot().edges;
    assert.ok(edges.some((e) => e.kind === 'references'));
  });
});

describe('SqliteGraphStore persist', () => {
  it('round-trips nodes through json fallback or sqlite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'intel-'));
    const path = join(dir, 'graph.sqlite');
    const a = new SqliteGraphStore(path);
    a.upsertNodes([
      InMemoryContextGraph.makeNode({
        id: 'n1',
        kind: 'class',
        label: 'Foo',
      }),
    ]);
    a.close();
    const b = new SqliteGraphStore(path);
    assert.equal(b.getNode('n1')?.label, 'Foo');
    b.close();
  });
});

describe('IntelligenceEngine bootstrap is non-blocking', () => {
  it('enqueues files and answers context before workers finish', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'AuthService.ts'),
      'export class AuthService { login() { return 1; } }\n',
    );
    const store = new MemoryGraphStore();
    const engine = new IntelligenceEngine({
      workspaceRoot: dir,
      store,
      maxFiles: 50,
    });
    const boot = engine.bootstrap();
    assert.ok(boot.files > 0);
    const ctx = engine.getContext('AuthService');
    assert.ok(ctx.index_freshness);
    assert.ok(ctx.confidence >= 0);
    await engine.pump();
    const hits = engine.symbols('AuthService');
    assert.ok(hits.some((h) => /AuthService/i.test(h.name)));
    engine.stop();
  });
});

describe('HTTP app', () => {
  it('serves context without waiting', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    const store = new MemoryGraphStore();
    seedAuth(store);
    const engine = new IntelligenceEngine({ workspaceRoot: dir, store });
    const app = createIntelligenceApp(engine);
    const res = await app.request('http://local/context?q=AuthService');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.confidence > 0);
    const status = await app.request('http://local/project-status');
    assert.equal(status.status, 200);
    engine.stop();
  });
});
