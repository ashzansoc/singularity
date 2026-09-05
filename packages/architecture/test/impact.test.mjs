import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createArchitectureSubsystem,
  createMemoryStore,
  impactFingerprint,
  scoreImpact,
  bumpArchitectureVersion,
  readArchitectureVersion,
  ingestImpactAnalysis,
  parseImpactRequest,
} from '../dist/index.js';
import { LocalEventBuffer } from '../dist/events/localBuffer.js';
import { readArchitectureFlags } from '../dist/flags.js';
import { Hono } from 'hono';
import { mountArchitectureRoutes } from '../dist/api/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
void here;

function sys(opts = {}) {
  const root = opts.root ?? mkdtempSync(join(tmpdir(), 'imp-'));
  return createArchitectureSubsystem({
    workspaceRoot: root,
    projectId: 'p1',
    store: createMemoryStore(),
    heuristicOnly: true,
    persistGraph: false,
    flags: { architecture_evolution_enabled: false },
    ...opts,
  });
}

function adr(s, over = {}) {
  return s.createAdr({
    title: 'Use PostgreSQL for billing',
    decision: { summary: 'Use PostgreSQL for billing-service' },
    alternatives: [{ name: 'MongoDB', status: 'rejected', reason: 'No ACID' }],
    constraints: ['ACID transactions', 'billing data stays in billing-service'],
    affected_components: ['billing-service'],
    evidence: {
      commits: [],
      pull_requests: [],
      tests: [],
      documents: [],
      conversations: [],
      code: [{ type: 'code', id: 'src/billing-service/db.ts', relationship: 'touches' }],
    },
    record_kind: 'decision',
    status: 'accepted',
    ...over,
  });
}

describe('fingerprint + severity', () => {
  it('is deterministic and changes with architecture version', () => {
    const req = { change: 'touch db', affected_files: ['src/a.ts', 'src/b.ts'], symbols: ['Foo'] };
    const a = impactFingerprint(req, 1);
    const b = impactFingerprint({ ...req, affected_files: ['src/b.ts', 'src/a.ts'] }, 1);
    assert.equal(a, b);
    assert.notEqual(a, impactFingerprint(req, 2));
    assert.notEqual(a, impactFingerprint({ ...req, change: 'other' }, 1));
  });

  it('scores evidence into severity and recommendation', () => {
    const low = scoreImpact({
      symbolCount: 1,
      fileCount: 1,
      serviceCount: 0,
      packageCount: 0,
      adrCount: 0,
      constraintCount: 0,
      conflictCount: 0,
      driftCount: 0,
      testCount: 1,
      publicApi: false,
      crossService: false,
      codePartial: false,
    });
    assert.equal(low.severity, 'low');
    assert.equal(low.recommendation, 'SAFE_TO_PROCEED');

    const high = scoreImpact({
      symbolCount: 8,
      fileCount: 4,
      serviceCount: 3,
      packageCount: 2,
      adrCount: 2,
      constraintCount: 2,
      conflictCount: 1,
      driftCount: 1,
      testCount: 0,
      publicApi: true,
      crossService: true,
      codePartial: false,
    });
    assert.equal(high.severity, 'critical');
    assert.equal(high.recommendation, 'DO_NOT_PROCEED');
    assert.ok(high.reasons.some((r) => r.includes('3 services')));
    assert.ok(high.reasons.some((r) => r.includes('public API')));
  });
});

describe('ingest is not execution', () => {
  it('returns queued without calling the code-impact provider', () => {
    let n = 0;
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          n += 1;
          return { symbols: ['X'], callers: [], callees: [], files: [], tests: [] };
        },
      },
    });
    const rec = s.ingestImpact({ change: 'touch billing', affected_files: ['src/billing-service/db.ts'] });
    assert.equal(rec.status, 'queued');
    assert.ok(rec.analysis_id.startsWith('imp_'));
    assert.equal(n, 0);
    assert.equal(s.getImpact(rec.analysis_id).status, 'queued');
    s.stop();
  });

  it('cache miss on lookupImpact does not compute', () => {
    let n = 0;
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          n += 1;
          throw new Error('should not run');
        },
      },
    });
    assert.equal(s.lookupImpact('nope'), undefined);
    assert.equal(n, 0);
    s.stop();
  });

  it('duplicate fingerprint is idempotent', () => {
    const s = sys();
    const body = { change: 'same', affected_files: ['a.ts'], symbols: ['Foo'] };
    const a = s.ingestImpact(body);
    const b = s.ingestImpact(body);
    assert.equal(a.analysis_id, b.analysis_id);
    assert.equal(b.duplicate, true);
    s.stop();
  });
});

describe('worker lifecycle', () => {
  it('POST ingest → worker → completed result with ADR correlation', async () => {
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          return {
            symbols: ['BillingRepo'],
            callers: ['BillingService', 'InvoiceWorker'],
            callees: ['PgClient'],
            files: ['src/billing-service/db.ts', 'src/invoice-worker/job.ts'],
            tests: ['src/billing-service/db.spec.ts'],
          };
        },
        impactForFiles() {
          return {
            symbols: ['BillingRepo'],
            callers: [],
            callees: [],
            files: ['src/billing-service/db.ts'],
            tests: [],
          };
        },
      },
    });
    await s.start();
    const created = adr(s);
    await s.publisher.flush(20);
    const queued = s.ingestImpact({
      change: 'widen BillingRepo interface',
      affected_files: ['src/billing-service/db.ts'],
      symbols: ['BillingRepo'],
    });
    assert.equal(queued.status, 'queued');
    await s.publisher.flush(20);
    const done = s.getImpact(queued.analysis_id);
    assert.equal(done.status, 'completed');
    assert.ok(done.affected_adrs.includes(created.id) || done.affected_decisions.includes(created.id));
    assert.ok(done.affected_services.length >= 1);
    assert.ok(done.affected_symbols.includes('BillingRepo'));
    assert.ok(done.reasons.length);
    assert.ok(['SAFE_TO_PROCEED', 'PROCEED_WITH_TESTS', 'REVIEW_REQUIRED', 'ARCHITECTURE_REVIEW_REQUIRED', 'DO_NOT_PROCEED'].includes(done.recommendation));
    const cached = s.ingestImpact({
      change: 'widen BillingRepo interface',
      affected_files: ['src/billing-service/db.ts'],
      symbols: ['BillingRepo'],
    });
    assert.equal(cached.analysis_id, queued.analysis_id);
    assert.equal(cached.status, 'completed');
    s.stop();
  });

  it('invalidates cache when architecture version bumps', async () => {
    const s = sys();
    await s.start();
    const first = s.ingestImpact({ change: 'x', affected_files: ['src/billing-service/db.ts'] });
    await s.publisher.flush(20);
    assert.equal(s.getImpact(first.analysis_id).status, 'completed');
    bumpArchitectureVersion(s.store, s.projectId);
    const second = s.ingestImpact({ change: 'x', affected_files: ['src/billing-service/db.ts'] });
    assert.notEqual(second.analysis_id, first.analysis_id);
    assert.equal(second.status, 'queued');
    s.stop();
  });

  it('provider throw is partial, not a failed coding-path error', async () => {
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          throw new Error('tree-sitter down');
        },
      },
    });
    await s.start();
    adr(s);
    await s.publisher.flush(20);
    const queued = s.ingestImpact({
      change: 'touch billing',
      affected_files: ['src/billing-service/db.ts'],
      symbols: ['BillingRepo'],
    });
    await s.publisher.flush(20);
    const done = s.getImpact(queued.analysis_id);
    assert.equal(done.status, 'completed');
    assert.match(done.error ?? '', /tree-sitter/);
    assert.ok(done.confidence < 0.8);
    s.stop();
  });

  it('missing ADRs still complete', async () => {
    const s = sys();
    await s.start();
    const queued = s.ingestImpact({ change: 'local util', affected_files: ['src/util.ts'] });
    await s.publisher.flush(20);
    const done = s.getImpact(queued.analysis_id);
    assert.equal(done.status, 'completed');
    assert.deepEqual(done.affected_adrs, []);
    s.stop();
  });

  it('failed worker can be retried on the same fingerprint', async () => {
    const s = sys();
    await s.start();
    const queued = s.ingestImpact({ change: 'retry me', affected_files: ['a.ts'] });
    const row = s.store.getImpactAnalysis(queued.analysis_id);
    s.store.upsertImpactAnalysis({ ...row, status: 'failed', error: 'boom' });
    const again = s.ingestImpact({ change: 'retry me', affected_files: ['a.ts'] });
    assert.equal(again.analysis_id, queued.analysis_id);
    assert.equal(again.status, 'queued');
    await s.publisher.flush(20);
    assert.equal(s.getImpact(queued.analysis_id).status, 'completed');
    s.stop();
  });
});

describe('HTTP ingest vs cache-only GET', () => {
  it('POST queues and GET by id reads materialized state', async () => {
    const s = sys();
    await s.start();
    adr(s);
    await s.publisher.flush(20);
    const app = new Hono();
    mountArchitectureRoutes(app, s);
    const post = await app.request('/architecture/impact-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ change: 'touch db', affected_files: ['src/billing-service/db.ts'] }),
    });
    assert.equal(post.status, 202);
    const body = await post.json();
    assert.equal(body.status, 'queued');
    await s.publisher.flush(20);
    const get = await app.request(`/architecture/impact-analysis/${body.analysis_id}`);
    assert.equal(get.status, 200);
    const result = await get.json();
    assert.equal(result.status, 'completed');
    const miss = await app.request('/architecture/impact-analysis?change=never-seen&files=nope.ts');
    const missBody = await miss.json();
    assert.equal(missBody.status, 'miss');
    s.stop();
  });
});

describe('coding tick isolation', () => {
  it('emit/lookup does not wait on a slow impact worker', async () => {
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          return { symbols: ['X'], callers: [], callees: [], files: ['a.ts'], tests: [] };
        },
      },
    });
    await s.start();
    s.publisher.stop();
    s.ingestImpact({ change: 'slow', affected_files: ['a.ts'], symbols: ['X'] });
    const t0 = performance.now();
    s.emit({ event_type: 'USER_INTENT_CAPTURED', project_id: 'p1', payload: { text: 'hi' } });
    s.lookup('hi');
    const latency = performance.now() - t0;
    assert.ok(latency < 20, `coding tick ${latency}ms`);
    s.stop();
  });

  it('failed impact worker does not fail emit', async () => {
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          throw new Error('scip failed');
        },
      },
    });
    await s.start();
    s.ingestImpact({ change: 'x', symbols: ['Y'] });
    await s.publisher.flush(20);
    s.emit({ event_type: 'USER_INTENT_CAPTURED', project_id: 'p1' });
    assert.equal(typeof s.lookup('x'), 'string');
    s.stop();
  });
});

describe('parse + ingest helpers', () => {
  it('parses request bodies', () => {
    const r = parseImpactRequest({
      change: 'x',
      files: ['a.ts'],
      symbols: ['Foo'],
      commit_id: 'abc',
    });
    assert.deepEqual(r.affected_files, ['a.ts']);
    const buf = new LocalEventBuffer();
    const store = createMemoryStore();
    const rec = ingestImpactAnalysis(
      { change: 'x', affected_files: ['a.ts'] },
      { projectId: 'p1', buffer: buf, flags: readArchitectureFlags(), store },
    );
    assert.equal(rec.queued, true);
    assert.equal(readArchitectureVersion(store, 'p1'), 0);
  });
});
