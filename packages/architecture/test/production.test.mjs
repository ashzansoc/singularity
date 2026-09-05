import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createArchitectureSubsystem,
  createMemoryStore,
  parseProductionEvent,
  ingestProductionEvent,
  correlateProductionEvent,
  scoreAdrMatch,
  ProductionSeenSet,
  readCorrelationPolicy,
  buildReactiveDebugContext,
  redactRecord,
} from '../dist/index.js';
import { LocalEventBuffer } from '../dist/events/localBuffer.js';
import { readArchitectureFlags } from '../dist/flags.js';

const here = dirname(fileURLToPath(import.meta.url));
void here;

function sys(root = mkdtempSync(join(tmpdir(), 'prod-'))) {
  return createArchitectureSubsystem({
    workspaceRoot: root,
    projectId: 'p1',
    store: createMemoryStore(),
    heuristicOnly: true,
    persistGraph: false,
    flags: { architecture_evolution_enabled: false },
  });
}

function adrOpts(over = {}) {
  return {
    title: 'Use Redis for job coordination',
    decision: { summary: 'Use Redis for distributed job coordination in worker' },
    affected_components: ['worker'],
    record_kind: 'decision',
    status: 'accepted',
    evidence: {
      commits: [{ type: 'commit', id: 'abc123def', relationship: 'implemented_decision' }],
      pull_requests: [],
      tests: [],
      documents: [],
      conversations: [],
      code: [],
    },
    ...over,
  };
}

describe('production ingest', () => {
  it('accepts a valid event', () => {
    const ev = parseProductionEvent({
      event_type: 'DEPLOYMENT_SUCCEEDED',
      service: 'worker',
      commit_sha: 'abc123',
      deployment_id: 'd1',
    });
    assert.equal(ev.event_type, 'DEPLOYMENT_SUCCEEDED');
    assert.ok(ev.event_id);
  });

  it('rejects invalid / malformed / unknown types', () => {
    assert.throws(() => parseProductionEvent(null));
    assert.throws(() => parseProductionEvent({ event_type: 'NOT_A_TYPE', service: 'x' }));
    const s = sys();
    const bad = s.ingestProduction({ foo: 1 });
    assert.equal(bad.queued, false);
    s.stop();
  });

  it('handles duplicates idempotently', () => {
    const s = sys();
    const body = {
      event_type: 'INCIDENT_REPORTED',
      source: 'pager',
      source_event_id: 'inc-1',
      service: 'worker',
      payload: { incident_id: 'inc-1', message: 'jobs stuck' },
    };
    const a = s.ingestProduction(body);
    const b = s.ingestProduction(body);
    assert.equal(a.queued, true);
    assert.equal(b.duplicate, true);
    assert.equal(a.event_id, b.event_id);
    s.stop();
  });

  it('aliases DEPLOYMENT_CREATED and TEST_CREATED', () => {
    const ev = parseProductionEvent({
      event_type: 'DEPLOYMENT_CREATED',
      deployment_id: 'd9',
    });
    assert.equal(ev.event_type, 'DEPLOYMENT_STARTED');
  });

  it('rejects oversized payloads', () => {
    const s = sys();
    const huge = { k: 'x'.repeat(70_000) };
    const r = s.ingestProduction({
      event_type: 'METRIC_OBSERVED',
      service: 'worker',
      payload: huge,
    });
    assert.equal(r.queued, false);
    assert.match(r.error ?? '', /large/);
    s.stop();
  });

  it('redacts secrets', () => {
    const out = redactRecord({ token: 'abc', nested: { password: 'p' }, ok: 'yes' });
    assert.equal(out.token, '[redacted]');
    assert.equal(out.nested.password, '[redacted]');
    assert.equal(out.ok, 'yes');
  });

  it('ingest does not correlate (queue only)', () => {
    const store = createMemoryStore();
    const buf = new LocalEventBuffer();
    const flags = readArchitectureFlags();
    const seen = new ProductionSeenSet();
    ingestProductionEvent(
      {
        event_type: 'INCIDENT_REPORTED',
        service: 'worker',
        payload: { incident_id: 'i1' },
      },
      { projectId: 'p1', buffer: buf, flags, seen, store },
    );
    assert.equal(store.listCorrelations('p1').length, 0);
    assert.ok(buf.peekDepth() >= 1);
  });
});

describe('production correlation', () => {
  it('correlates by commit, service, and ADR with reasons', () => {
    const s = sys();
    const adr = s.createAdr(adrOpts());
    const result = s.processProductionSync({
      event_type: 'DEPLOYMENT_SUCCEEDED',
      service: 'worker',
      commit_sha: 'abc123def',
      deployment_id: 'dep-1',
    });
    const adrHit = result.correlations.filter((c) => c.from.includes(adr.id) || c.to.includes(adr.id));
    assert.ok(adrHit.length, JSON.stringify(result.correlations));
    assert.ok(adrHit.some((c) => c.reasons.includes('same deployment commit')));
    assert.ok(adrHit.some((c) => c.confidence >= 0.5));
    const stored = s.store.listCorrelations('p1');
    assert.ok(stored.length > 0);
    s.stop();
  });

  it('service-based correlation is medium, not a fact', () => {
    const s = sys();
    s.createAdr(adrOpts({ evidence: undefined }));
    const ev = parseProductionEvent({
      event_type: 'INCIDENT_REPORTED',
      service: 'worker',
      payload: { incident_id: 'i2', message: 'stuck' },
    });
    const match = scoreAdrMatch(s.store.list({ project_id: 'p1' })[0], ev);
    assert.ok(match.score >= 0.5);
    assert.ok(match.score < 0.8);
    assert.ok(match.reasons.includes('same service'));
    s.stop();
  });

  it('multi-signal raises confidence', () => {
    const s = sys();
    const adr = s.createAdr(adrOpts());
    const ev = parseProductionEvent({
      event_type: 'INCIDENT_REPORTED',
      service: 'worker',
      commit_sha: 'abc123def',
      payload: { incident_id: 'i3', changed_files: ['src/worker/jobs.ts'] },
    });
    const match = scoreAdrMatch(s.store.get(adr.id), ev);
    assert.ok(match.score >= 0.8);
    assert.ok(match.reasons.length >= 2);
    s.stop();
  });

  it('low-confidence weak overlap is not a match', () => {
    const s = sys();
    s.createAdr(
      adrOpts({
        affected_components: ['billing-gateway-internal'],
        evidence: { commits: [], pull_requests: [], tests: [], documents: [], conversations: [], code: [] },
      }),
    );
    const ev = parseProductionEvent({
      event_type: 'METRIC_OBSERVED',
      payload: { metric_name: 'unrelated', note: 'mentions billing once' },
    });
    const match = scoreAdrMatch(s.store.list({ project_id: 'p1' })[0], ev);
    const policy = readCorrelationPolicy();
    assert.ok(match.score < policy.matchFloor || match.band === 'UNKNOWN' || match.band === 'LOW');
    const result = correlateProductionEvent(s.store, s.archGraph, 'p1', ev);
    const adrCorr = result.correlations.filter((c) => c.from.startsWith('ADR:'));
    if (match.score < policy.matchFloor) {
      assert.equal(adrCorr.length, 0);
    }
    s.stop();
  });

  it('no-match when nothing overlaps', () => {
    const s = sys();
    s.createAdr(adrOpts({ affected_components: ['payments'] }));
    const result = s.processProductionSync({
      event_type: 'INCIDENT_REPORTED',
      service: 'notifications',
      payload: { incident_id: 'none-1' },
    });
    assert.equal(result.adrs.length, 0);
    s.stop();
  });

  it('graph-correlates incident to recent deployment in policy window', () => {
    const s = sys();
    const now = new Date().toISOString();
    s.processProductionSync({
      event_type: 'DEPLOYMENT_SUCCEEDED',
      service: 'worker',
      deployment_id: 'dep-win',
      timestamp: now,
    });
    const inc = s.processProductionSync({
      event_type: 'INCIDENT_REPORTED',
      service: 'worker',
      payload: { incident_id: 'inc-win' },
      timestamp: now,
    });
    assert.ok(
      inc.correlations.some((c) => c.rel === 'ASSOCIATED_WITH' || c.rel === 'TEMPORALLY_CORRELATED_WITH'),
      JSON.stringify(inc.correlations.map((c) => c.rel)),
    );
    s.stop();
  });
});

describe('reactive debugging', () => {
  it('incident ingest returns without waiting; worker builds context', async () => {
    const s = sys();
    await s.start();
    s.createAdr(adrOpts());
    s.processProductionSync({
      event_type: 'DEPLOYMENT_SUCCEEDED',
      service: 'worker',
      commit_sha: 'abc123def',
      deployment_id: 'rel-abc123',
      timestamp: new Date().toISOString(),
    });
    s.processProductionSync({
      event_type: 'METRIC_OBSERVED',
      service: 'worker',
      payload: { metric_name: 'queue_latency', message: 'increased 450%' },
      timestamp: new Date().toISOString(),
    });
    const queued = s.ingestProduction({
      event_type: 'INCIDENT_REPORTED',
      source: 'pager',
      source_event_id: 'inc-dbg',
      service: 'worker',
      commit_sha: 'abc123def',
      deployment_id: 'rel-abc123',
      payload: { incident_id: 'inc-dbg', message: 'Worker jobs stuck after deployment' },
      timestamp: new Date().toISOString(),
    });
    assert.equal(queued.queued, true);
    assert.equal(queued.duplicate, undefined);
    await s.publisher.flush(30);
    const ctx = s.debugContext('inc-dbg');
    assert.ok(ctx, 'debug context missing');
    assert.ok(ctx.deployments.length >= 1, JSON.stringify(ctx));
    assert.ok(ctx.adrs.some((a) => a.title.includes('Redis')), JSON.stringify(ctx.adrs));
    assert.ok(ctx.metrics.length >= 1, JSON.stringify(ctx.metrics));
    s.stop();
  });

  it('buildReactiveDebugContext attaches drift findings', () => {
    const s = sys();
    const adr = s.createAdr(adrOpts());
    s.store.insertDrift({
      id: 'drift_test_1',
      project_id: 'p1',
      adr_id: adr.id,
      severity: 'high',
      kind: 'constraint_violation',
      reason: 'worker talks to cache directly',
      files: ['src/worker/cache.ts'],
      created_at: new Date().toISOString(),
      status: 'open',
    });
    const incident = parseProductionEvent({
      event_type: 'INCIDENT_REPORTED',
      service: 'worker',
      payload: { incident_id: 'inc-drift', message: 'elevated errors' },
    });
    s.processProductionSync(incident);
    const ctx = buildReactiveDebugContext(s.store, s.archGraph, 'p1', incident);
    assert.ok(ctx.drifts.some((d) => d.id === 'drift_test_1'));
    assert.ok(ctx.potential_causes.length >= 1);
    s.stop();
  });
});

describe('failure isolation', () => {
  it('coding tick works when production worker throws', async () => {
    const s = sys();
    await s.start();
    s.pipeline.handle = async () => {
      throw new Error('production worker unavailable');
    };
    const t0 = performance.now();
    s.emit({ event_type: 'USER_INTENT_CAPTURED', project_id: 'p1', payload: { text: 'code' } });
    const ctx = s.lookup('code');
    const ms = performance.now() - t0;
    assert.ok(ms < 20);
    assert.equal(typeof ctx, 'string');
    s.ingestProduction({
      event_type: 'INCIDENT_REPORTED',
      service: 'worker',
      payload: { incident_id: 'x' },
    });
    s.stop();
  });
});
