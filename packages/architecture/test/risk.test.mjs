import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createArchitectureSubsystem,
  createMemoryStore,
  riskFingerprint,
  scoreMissionRisk,
  bumpArchitectureVersion,
  ingestRiskAssessment,
  parseRiskRequest,
  riskLevelFromScore,
  clampScore,
  DEFAULT_RISK_WEIGHTS,
} from '../dist/index.js';
import { LocalEventBuffer } from '../dist/events/localBuffer.js';
import { readArchitectureFlags } from '../dist/flags.js';
import { Hono } from 'hono';
import { mountArchitectureRoutes } from '../dist/api/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
void here;

function sys(opts = {}) {
  const root = opts.root ?? mkdtempSync(join(tmpdir(), 'rsk-'));
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
    risks: ['billing outage if schema migrates poorly'],
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

describe('risk weights + thresholds', () => {
  it('clamps, maps thresholds, and fingerprints deterministically', () => {
    assert.equal(clampScore(-4), 0);
    assert.equal(clampScore(140), 100);
    assert.equal(riskLevelFromScore(0), 'LOW');
    assert.equal(riskLevelFromScore(24), 'LOW');
    assert.equal(riskLevelFromScore(25), 'MEDIUM');
    assert.equal(riskLevelFromScore(49), 'MEDIUM');
    assert.equal(riskLevelFromScore(50), 'HIGH');
    assert.equal(riskLevelFromScore(74), 'HIGH');
    assert.equal(riskLevelFromScore(75), 'CRITICAL');
    const req = {
      mission_id: 'm1',
      change: 'touch db',
      affected_files: ['src/a.ts', 'src/b.ts'],
      symbols: ['Foo'],
    };
    const a = riskFingerprint(req, 1);
    const b = riskFingerprint({ ...req, affected_files: ['src/b.ts', 'src/a.ts'] }, 1);
    assert.equal(a, b);
    assert.notEqual(a, riskFingerprint(req, 2));
    assert.ok(DEFAULT_RISK_WEIGHTS.change_blast_radius > 0);
  });

  it('aggregates dimensions, missing evidence, prompt, and mitigations', () => {
    const empty = scoreMissionRisk({
      request: { change: 'noop' },
      adrRisks: [],
      productionEvents: [],
      priorAssessments: [],
      historyEmpty: true,
    });
    assert.equal(empty.risk_level, 'LOW');
    assert.ok(empty.factors.some((f) => f.type === 'change_blast_radius'));
    assert.ok(empty.factors.some((f) => f.type === 'architecture'));
    assert.ok(empty.confidence < 0.9);

    const high = scoreMissionRisk({
      request: {
        change: 'public api',
        services: ['billing-service', 'checkout-service'],
        symbols: ['A', 'B', 'C', 'D', 'E'],
        prompt_risk: { predicted_success: 0.2, passed: false },
        verification: { last_run_failed: true, missing_tests: ['A'] },
      },
      impact: {
        analysis_id: 'imp_1',
        status: 'completed',
        fingerprint: 'x',
        project_id: 'p1',
        analysis_version: 1,
        affected_symbols: ['A', 'B', 'C', 'D', 'E'],
        affected_files: ['src/api/routes.ts', 'src/billing-service/db.ts'],
        affected_packages: ['billing'],
        affected_services: ['billing-service', 'checkout-service'],
        affected_decisions: ['ADR-0001'],
        affected_adrs: ['ADR-0001'],
        constraints: ['ACID'],
        risks: ['outage'],
        conflicts: ['ADR-0001'],
        drifts: ['d1'],
        severity: 'critical',
        recommendation: 'DO_NOT_PROCEED',
        reasons: ['3 services depend on the modified surface'],
        confidence: 0.7,
        created_at: 't',
        updated_at: 't',
      },
      adrRisks: [{ adr_id: 'ADR-0001', text: 'billing outage if schema migrates poorly' }],
      productionEvents: [
        {
          event_id: 'e1',
          project_id: 'p1',
          idempotency_key: 'k',
          event_type: 'INCIDENT_REPORTED',
          timestamp: '2026-01-01T00:00:00.000Z',
          received_at: '2026-01-01T00:00:00.000Z',
          json: JSON.stringify({
            event_id: 'e1',
            event_type: 'INCIDENT_REPORTED',
            service: 'billing-service',
          }),
        },
        {
          event_id: 'e2',
          project_id: 'p1',
          idempotency_key: 'k2',
          event_type: 'DEPLOYMENT_ROLLED_BACK',
          timestamp: '2026-01-01T00:00:01.000Z',
          received_at: '2026-01-01T00:00:01.000Z',
          json: JSON.stringify({
            event_id: 'e2',
            event_type: 'DEPLOYMENT_ROLLED_BACK',
            service: 'billing-service',
          }),
        },
      ],
      priorAssessments: [
        {
          assessment_id: 'rsk_old',
          fingerprint: 'old',
          mission_id: 'm1',
          project_id: 'p1',
          status: 'completed',
          assessment_status: 'READY',
          request_json: '{}',
          result_json: JSON.stringify({ affected_services: ['billing-service'] }),
          risk_level: 'HIGH',
          assessment_version: 1,
          created_at: 't',
          updated_at: 't',
        },
      ],
      testNames: [],
    });
    assert.ok(high.risk_score >= 50);
    assert.ok(['HIGH', 'CRITICAL'].includes(high.risk_level));
    assert.ok(high.factors.some((f) => f.type === 'adr_documented_risk'));
    assert.ok(high.factors.some((f) => f.type === 'prompt' && f.score >= 60));
    assert.ok(high.factors.some((f) => f.type === 'production' && f.contribution > 0));
    assert.ok(high.recommendations.length);
    assert.ok(high.recommendations.some((r) => /conflict|verification|drift|integration/i.test(r.text)));

    const mitigated = scoreMissionRisk({
      request: { change: 'tiny', prompt_risk: { predicted_success: 0.99, passed: true } },
      impact: {
        analysis_id: 'imp_2',
        status: 'completed',
        fingerprint: 'y',
        project_id: 'p1',
        analysis_version: 1,
        affected_symbols: ['Util'],
        affected_files: ['src/util.ts'],
        affected_packages: [],
        affected_services: ['util'],
        affected_decisions: [],
        affected_adrs: [],
        constraints: [],
        risks: [],
        conflicts: [],
        drifts: [],
        severity: 'low',
        recommendation: 'SAFE_TO_PROCEED',
        reasons: ['1 related test identified'],
        confidence: 0.9,
        created_at: 't',
        updated_at: 't',
      },
      adrRisks: [],
      productionEvents: [
        {
          event_id: 'ok',
          project_id: 'p1',
          idempotency_key: 'ok',
          event_type: 'DEPLOYMENT_SUCCEEDED',
          timestamp: 't',
          received_at: 't',
          json: JSON.stringify({ event_id: 'ok', event_type: 'DEPLOYMENT_SUCCEEDED', service: 'util' }),
        },
      ],
      priorAssessments: [],
      testNames: ['util.test.ts'],
    });
    assert.ok(mitigated.factors.some((f) => f.type === 'mitigation_tests' && f.contribution < 0));
    assert.ok(mitigated.factors.some((f) => f.type === 'mitigation_recent_deploy'));
    assert.ok(mitigated.recommendations.some((r) => r.text.includes('No additional safeguards')));
  });
});

describe('ingest is not execution', () => {
  it('returns queued without calling the code-impact provider or engine side effects', () => {
    let n = 0;
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          n += 1;
          return { symbols: ['X'], callers: [], callees: [], files: [], tests: [] };
        },
      },
    });
    const rec = s.ingestRisk({
      mission_id: 'msn_test',
      change: 'touch billing',
      affected_files: ['src/billing-service/db.ts'],
    });
    assert.equal(rec.status, 'queued');
    assert.equal(rec.assessment_status, 'PENDING');
    assert.equal(n, 0);
    assert.equal(s.lookupRisk('missing'), undefined);
  });

  it('duplicate fingerprint is idempotent', () => {
    const s = sys();
    const body = { mission_id: 'm1', change: 'x', affected_files: ['a.ts'] };
    const a = s.ingestRisk(body);
    const b = s.ingestRisk(body);
    assert.equal(a.assessment_id, b.assessment_id);
    assert.equal(b.duplicate, true);
  });
});

describe('async worker + GET', () => {
  it('POST ingest then flush then GET completed with ADR/impact/production factors', async () => {
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          return {
            symbols: ['Billing'],
            callers: ['Checkout'],
            callees: ['Db'],
            files: ['src/billing-service/db.ts'],
            tests: [],
          };
        },
        impactForFiles() {
          return {
            symbols: ['Billing'],
            callers: [],
            callees: [],
            files: ['src/billing-service/db.ts'],
            tests: [],
          };
        },
      },
    });
    await s.start();
    adr(s);
    s.store.insertConflict({
      id: 'c1',
      project_id: 'p1',
      adr_id: 'ADR-0001',
      severity: 'high',
      reason: 'contradicts rejected Mongo',
      created_at: new Date().toISOString(),
    });
    s.store.insertDrift({
      id: 'd1',
      project_id: 'p1',
      adr_id: 'ADR-0001',
      severity: 'high',
      kind: 'constraint_violation',
      reason: 'boundary leak',
      files: ['src/billing-service/db.ts'],
      created_at: new Date().toISOString(),
    });
    s.ingestProduction({
      event_type: 'INCIDENT_REPORTED',
      service: 'billing-service',
      payload: { incident_id: 'inc_1', message: 'errors' },
      source: 'pager',
      source_event_id: 'inc_1',
    });
    await s.publisher.flush(30);
    const app = new Hono();
    mountArchitectureRoutes(app, s);
    const post = await app.request('/architecture/risk-assessments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mission_id: 'mission-pay',
        change: 'touch billing',
        affected_files: ['src/billing-service/db.ts'],
        symbols: ['Billing'],
        services: ['billing-service'],
        prompt_risk: { predicted_success: 0.4, passed: true },
      }),
    });
    assert.equal(post.status, 202);
    const body = await post.json();
    assert.equal(body.status, 'queued');
    const pending = s.getRisk(body.assessment_id);
    assert.equal(pending.assessment_status, 'PENDING');
    await s.publisher.flush(40);
    const get = await app.request(`/architecture/risk-assessments/${body.assessment_id}`);
    assert.equal(get.status, 200);
    const result = await get.json();
    assert.equal(result.job_status, 'completed');
    assert.equal(result.assessment_status, 'READY');
    assert.equal(result.mission_id, 'mission-pay');
    assert.ok(result.factors.length >= 7);
    assert.ok(result.affected_adrs.length || result.constraints.length || result.factors.some((f) => f.type === 'architecture'));
    const byMission = await app.request('/architecture/risk-assessments?mission_id=mission-pay');
    const mbody = await byMission.json();
    assert.equal(mbody.assessment_id, body.assessment_id);
    const miss = await app.request('/architecture/risk-assessments?change=never-seen&files=nope.ts');
    const missBody = await miss.json();
    assert.equal(missBody.status, 'miss');
    const bad = await app.request('/architecture/risk-assessments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    assert.equal(bad.status, 400);
    s.stop();
  });

  it('version bump marks assessment STALE without computing on lookup', async () => {
    let n = 0;
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          n += 1;
          return { symbols: ['X'], callers: [], callees: [], files: ['a.ts'], tests: ['t'] };
        },
      },
    });
    await s.start();
    const queued = s.ingestRisk({ mission_id: 'm-stale', change: 'x', affected_files: ['a.ts'], symbols: ['X'] });
    await s.publisher.flush(30);
    const ready = s.getRisk(queued.assessment_id);
    assert.equal(ready.assessment_status, 'READY');
    const before = n;
    bumpArchitectureVersion(s.store, 'p1');
    const stale = s.lookupRisk(queued.assessment_id);
    assert.equal(stale.assessment_status, 'STALE');
    assert.equal(n, before);
    const again = s.ingestRisk({ mission_id: 'm-stale', change: 'x', affected_files: ['a.ts'], symbols: ['X'] });
    assert.notEqual(again.assessment_id, queued.assessment_id);
    s.stop();
  });

  it('provider throw still completes with lower confidence', async () => {
    const s = sys({
      codeImpact: {
        impactForSymbols() {
          throw new Error('boom');
        },
      },
    });
    await s.start();
    const queued = s.ingestRisk({ change: 'x', symbols: ['Y'] });
    await s.publisher.flush(30);
    const row = s.getRisk(queued.assessment_id);
    assert.equal(row.job_status, 'completed');
    assert.ok(row.confidence < 0.9);
    s.stop();
  });

  it('disabled flag does not enqueue', () => {
    const s = sys({ flags: { mission_risk_scoring_enabled: false, architecture_evolution_enabled: false } });
    const rec = s.ingestRisk({ change: 'x' });
    assert.equal(rec.code, 'disabled');
    assert.equal(rec.queued, false);
  });

  it('sync true runs on the intelligence plane', async () => {
    const s = sys();
    await s.start();
    const app = new Hono();
    mountArchitectureRoutes(app, s);
    const post = await app.request('/architecture/risk-assessments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ change: 'local util', affected_files: ['src/util.ts'], sync: true }),
    });
    assert.equal(post.status, 200);
    const body = await post.json();
    assert.equal(body.job_status, 'completed');
    s.stop();
  });
});

describe('ingestRiskAssessment isolation', () => {
  it('does not score when only ingesting', () => {
    const buf = new LocalEventBuffer();
    const store = createMemoryStore();
    const rec = ingestRiskAssessment(
      { change: 'x', affected_files: ['a.ts'] },
      {
        projectId: 'p1',
        buffer: buf,
        flags: readArchitectureFlags(),
        store,
      },
    );
    assert.equal(rec.status, 'queued');
    assert.equal(parseRiskRequest({ changed_files: ['a.ts'] }).affected_files[0], 'a.ts');
  });
});
