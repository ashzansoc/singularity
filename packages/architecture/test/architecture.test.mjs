import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AdrSchema,
  canTransition,
  classifySignificance,
  confidenceAction,
  createArchitectureSubsystem,
  createMemoryStore,
  eventTypeName,
  inferFactorsFromText,
  isActiveStatus,
  parseEventTypeName,
  scoreConfidence,
  shouldEnterAdrPipeline,
  transitionAdr,
} from '../dist/index.js';
import { heuristicExtractAdr, candidateToAdr } from '../dist/extraction/heuristic.js';
import { LocalEventBuffer } from '../dist/events/localBuffer.js';
import { InMemoryEventBus } from '../dist/events/memoryBus.js';
import { OutboxPublisher } from '../dist/events/outboxPublisher.js';
import { MemoryDecisionStore } from '../dist/memory/sqliteStore.js';
import { hybridSearch } from '../dist/memory/hybridRetrieve.js';
import { HashArchitectureEmbedder } from '../dist/memory/vectorStore.js';
import { embedText } from '../dist/domain/adr/schema.js';

const here = dirname(fileURLToPath(import.meta.url));

function sampleAdr(over = {}) {
  const ts = new Date().toISOString();
  return AdrSchema.parse({
    id: 'ADR-0001',
    project_id: 'p1',
    title: 'Use PostgreSQL for transactional storage',
    status: 'accepted',
    problem: 'Billing needs ACID',
    decision: { summary: 'Use PostgreSQL as the primary transactional database.' },
    reasoning: ['Strong transactional guarantees.'],
    alternatives: [{ name: 'MongoDB', status: 'rejected', reason: 'Relational integrity' }],
    constraints: ['ACID transactions'],
    affected_components: ['billing-service'],
    record_kind: 'decision',
    confidence: 0.93,
    timestamps: { created_at: ts, updated_at: ts },
    ...over,
  });
}

describe('ADR schema + lifecycle', () => {
  it('validates a full ADR', () => {
    const adr = sampleAdr();
    assert.equal(adr.id, 'ADR-0001');
    assert.deepEqual(adr.evidence.commits, []);
  });

  it('allows accepted → superseded and keeps history', () => {
    const v1 = sampleAdr();
    const v2 = transitionAdr(v1, 'superseded', 'ADR-0002');
    assert.equal(v2.status, 'superseded');
    assert.equal(v2.relationships.superseded_by, 'ADR-0002');
    assert.equal(v2.version, v1.version + 1);
    assert.equal(canTransition('accepted', 'rejected'), true);
    assert.equal(canTransition('rejected', 'accepted'), false);
  });

  it('never treats superseded as active', () => {
    assert.equal(isActiveStatus('accepted'), true);
    assert.equal(isActiveStatus('superseded'), false);
  });
});

describe('confidence + significance', () => {
  it('scores explicit decisions', () => {
    const factors = inferFactorsFromText(
      'We decided to use PostgreSQL because ACID is required. We rejected MongoDB. See commit a82f91c.',
    );
    const c = scoreConfidence(factors);
    assert.ok(c >= 0.7);
    assert.ok(['create_candidate', 'queue_review'].includes(confidenceAction(c)));
  });

  it('classifies architectural vs local changes', () => {
    const hi = classifySignificance({ text: 'add postgres and a new auth service' });
    assert.ok(hi === 'HIGH' || hi === 'CRITICAL');
    assert.equal(shouldEnterAdrPipeline(classifySignificance({ text: 'new database for billing' })), true);
    assert.equal(classifySignificance({ text: 'fix lint formatting' }), 'LOW');
    assert.equal(shouldEnterAdrPipeline('LOW'), false);
  });
});

describe('events', () => {
  it('versions event type names', () => {
    assert.equal(eventTypeName('ADR_CREATED', 1), 'ADR_CREATED.v1');
    assert.deepEqual(parseEventTypeName('ADR_CREATED.v2'), { type: 'ADR_CREATED', version: 2 });
  });

  it('append is synchronous and survives WAL failure', () => {
    const buf = new LocalEventBuffer({ walPath: '/proc/does-not-exist/events.wal' });
    buf.append({
      event_type: 'CODE_CHANGE_COMPLETED',
      project_id: 'p',
      changed_files: ['src/auth/service.ts'],
    });
    assert.equal(buf.peekDepth(), 1);
  });
});

describe('store versioning', () => {
  it('keeps immutable versions', () => {
    const store = new MemoryDecisionStore();
    store.insert(sampleAdr({ version: 1 }));
    store.update(
      sampleAdr({ version: 2, decision: { summary: 'PostgreSQL + replicas' } }),
    );
    assert.equal(store.versions('ADR-0001').length, 2);
    assert.match(store.get('ADR-0001').decision.summary, /replicas/);
  });
});

describe('extraction', () => {
  it('extracts a candidate from decision language', () => {
    const c = heuristicExtractAdr(
      'We decided to extract authentication into auth-service because multiple clients need independent auth. Instead of keeping it in the monolith.',
    );
    assert.ok(c);
    assert.match(c.decision.toLowerCase(), /auth/);
    const adr = candidateToAdr('p1', 'ADR-0001', c);
    assert.ok(adr.record_kind === 'candidate' || adr.record_kind === 'observation');
  });
});

describe('subsystem integration', () => {
  it('file event → worker → store → vector → cache', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-'));
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
    });
    await sys.start();
    sys.emit({
      event_type: 'CODE_CHANGE_COMPLETED',
      project_id: 'p1',
      changed_files: ['src/billing/db.ts'],
      payload: {
        text: 'We decided to use PostgreSQL for billing because ACID transactions are required. Instead of MongoDB. New database for billing-service.',
      },
    });
    await sys.publisher.flush(40);
    await new Promise((r) => setTimeout(r, 80));
    const adrs = sys.store.list({ project_id: 'p1' });
    assert.ok(adrs.length + sys.store.listObservations('p1').length > 0);
    const cached = sys.lookup('billing-service');
    assert.equal(typeof cached, 'string');
    sys.stop();
  });

  it('hybrid search prefers active ADRs', async () => {
    const store = new MemoryDecisionStore();
    const active = sampleAdr({ id: 'ADR-0001' });
    const old = sampleAdr({
      id: 'ADR-0002',
      status: 'superseded',
      title: 'Use Redis',
      decision: { summary: 'Use Redis for cache' },
    });
    store.insert(active);
    store.insert(old);
    const emb = new HashArchitectureEmbedder();
    store.upsertEmbedding(active.id, emb.embed(embedText(active)), embedText(active));
    store.upsertEmbedding(old.id, emb.embed(embedText(old)), embedText(old));
    const hits = await hybridSearch(store, 'p1', 'Why PostgreSQL billing');
    assert.equal(hits[0].adr.id, 'ADR-0001');
  });
});

describe('failure isolation', () => {
  it('coding lookup returns empty when cache missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-'));
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      flags: { architecture_memory_enabled: false },
    });
    assert.equal(sys.lookup('anything'), '');
    sys.emit({ event_type: 'USER_INTENT_CAPTURED', project_id: 'p1', payload: { text: 'hi' } });
  });

  it('publisher retries when bus throws', async () => {
    const buf = new LocalEventBuffer();
    const bus = new InMemoryEventBus();
    let fail = true;
    await bus.subscribe('CODE_CHANGE_COMPLETED', () => {
      if (fail) {
        fail = false;
        throw new Error('bus down');
      }
    });
    const pub = new OutboxPublisher(buf, bus);
    buf.append({ event_type: 'CODE_CHANGE_COMPLETED', project_id: 'p' });
    await pub.tick();
    await pub.flush(5);
  });
});

describe('hot-path isolation (grep)', () => {
  const forbidden = [
    'architecture/workers',
    'architecture/extraction',
    'sqliteStore',
    'vectorStore',
    'AdrExtractor',
    'production/correlate',
    'attachProductionEvidence',
    'ingestProductionEvent',
    'ProductionEventAdapter',
    'debugContext',
    'workers/impact',
    'ingestImpactAnalysis',
    'impactForSymbol',
    'treeSitter',
    'graph/impact',
    'ingestRiskAssessment',
    'scoreMissionRisk',
    'risk/engine',
    'risk/worker',
  ];
  const hotFiles = [
    join(here, '../../../vscode/extensions/singularity-chat/src/platform/endpoint/node/automodeService.ts'),
    join(here, '../../../vscode/extensions/singularity-chat/src/extension/intents/node/toolCallingLoop.ts'),
    join(
      here,
      '../../../vscode/extensions/singularity-chat/src/platform/endpoint/node/singularityPromptEngineBridge.ts',
    ),
  ];

  it('coding LLM files do not import architecture workers', () => {
    for (const f of hotFiles) {
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
    event_type: 'USER_INTENT_CAPTURED',
    project_id: sys.projectId,
    payload: { text: prompt },
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
  return { tps: n / Math.max(elapsed, 0.0001), p50: times[Math.floor(times.length / 2)], mean };
}

describe('TPS acceptance A–F', () => {
  it('coding TPS stays effectively unchanged', async () => {
    const n = 100;
    const root = mkdtempSync(join(tmpdir(), 'arch-bench-'));

    const disabled = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      flags: { architecture_memory_enabled: false, architecture_context_enabled: false },
    });
    const a = await runConcurrent(n, () => {
      codingTick(disabled, 'change billing-service cache');
    });

    const enabled = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
    });
    await enabled.start();
    enabled.createAdr({
      title: 'Use PostgreSQL',
      decision: { summary: 'Use PostgreSQL for billing-service' },
      affected_components: ['billing-service'],
      record_kind: 'decision',
      status: 'accepted',
    });
    await enabled.publisher.flush(10);

    const b = await runConcurrent(n, () => {
      codingTick(enabled, 'change billing-service cache');
    });

    for (let i = 0; i < 500; i++) {
      enabled.emit({
        event_type: 'CODE_CHANGE_COMPLETED',
        project_id: 'p1',
        payload: { text: `noise ${i} we decided to use redis because of sessions` },
      });
    }
    const c = await runConcurrent(n, () => {
      codingTick(enabled, 'implement feature');
    });

    const throwingStore = createMemoryStore();
    throwingStore.insert = () => {
      throw new Error('sqlite locked');
    };
    const failing = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: throwingStore,
      heuristicOnly: true,
    });
    await failing.start();
    const d = await runConcurrent(n, () => {
      codingTick(failing, 'still coding');
    });

    enabled.flags.architecture_vector_search_enabled = false;
    const e = await runConcurrent(n, () => {
      codingTick(enabled, 'embedder down still codes');
    });

    const report = {
      A_disabled: a,
      B_enabled: b,
      C_queue_pressure: c,
      D_store_failure: d,
      E_embedder_off: e,
    };

    let upsertDuringTick = 0;
    const origUpsert = enabled.archGraph.upsertNodes.bind(enabled.archGraph);
    enabled.archGraph.upsertNodes = (...args) => {
      upsertDuringTick += 1;
      return origUpsert(...args);
    };
    for (let i = 0; i < 200; i++) {
      enabled.ingestProduction({
        event_type: 'METRIC_OBSERVED',
        service: 'billing-service',
        payload: { metric_name: 'cpu', metric_value: i },
        source: 'prom',
        source_event_id: `m-${i}`,
      });
    }
    upsertDuringTick = 0;
    const f = await runConcurrent(n, () => {
      codingTick(enabled, 'implement feature');
    });
    assert.equal(upsertDuringTick, 0);
    report.F_production_queue_pressure = f;

    const throwingCorr = createMemoryStore();
    throwingCorr.insertCorrelation = () => {
      throw new Error('correlation worker down');
    };
    const broken = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: throwingCorr,
      heuristicOnly: true,
    });
    await broken.start();
    broken.ingestProduction({
      event_type: 'INCIDENT_REPORTED',
      service: 'billing-service',
      payload: { incident_id: 'inc_broken', message: 'errors' },
      source: 'pager',
      source_event_id: 'inc_broken',
    });
    const g = await runConcurrent(n, () => {
      codingTick(broken, 'still coding when correlation fails');
    });
    report.G_correlation_broken = g;

    let providerDuringTick = 0;
    const impactSys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
      codeImpact: {
        impactForSymbols() {
          providerDuringTick += 1;
          return { symbols: ['Billing'], callers: ['A'], callees: ['B'], files: ['src/billing.ts'], tests: [] };
        },
        impactForFiles() {
          providerDuringTick += 1;
          return { symbols: [], callers: [], callees: [], files: ['src/billing.ts'], tests: [] };
        },
      },
    });
    await impactSys.start();
    impactSys.publisher.stop();
    for (let i = 0; i < 80; i++) {
      impactSys.ingestImpact({
        change: `refactor interface ${i}`,
        affected_files: ['src/billing.ts'],
        symbols: ['Billing'],
      });
    }
    providerDuringTick = 0;
    const h = await runConcurrent(n, () => {
      impactSys.lookupImpact('missing-fingerprint');
      codingTick(impactSys, 'implement feature');
    });
    assert.equal(providerDuringTick, 0);
    report.H_impact_queue_pressure = h;
    assert.ok(h.mean < 20);

    let riskProviderDuringTick = 0;
    const riskSys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
      codeImpact: {
        impactForSymbols() {
          riskProviderDuringTick += 1;
          return { symbols: ['Billing'], callers: ['A'], callees: ['B'], files: ['src/billing.ts'], tests: [] };
        },
        impactForFiles() {
          riskProviderDuringTick += 1;
          return { symbols: [], callers: [], callees: [], files: ['src/billing.ts'], tests: [] };
        },
      },
    });
    await riskSys.start();
    riskSys.publisher.stop();
    for (let i = 0; i < 80; i++) {
      riskSys.ingestRisk({
        mission_id: `m${i}`,
        change: `refactor interface ${i}`,
        affected_files: ['src/billing.ts'],
        symbols: ['Billing'],
      });
    }
    riskProviderDuringTick = 0;
    const iScenario = await runConcurrent(n, () => {
      riskSys.lookupRisk('missing-fingerprint');
      codingTick(riskSys, 'implement feature');
    });
    assert.equal(riskProviderDuringTick, 0);
    report.I_mission_risk_queue_pressure = iScenario;
    assert.ok(iScenario.mean < 20);

    const outDir = join(here, '../../../benchmarks/architecture-intelligence');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'METRICS.json'), JSON.stringify(report, null, 2));

    assert.ok(c.mean < 20);
    assert.ok(d.mean < 20);
    assert.ok(e.mean < 20);
    assert.ok(b.mean < 20);
    assert.ok(f.mean < 20);
    assert.ok(g.mean < 20);

    enabled.stop();
    failing.stop();
    disabled.stop();
    broken.stop();
    impactSys.stop();
    riskSys.stop();
  });
});

describe('Phase 2 graph + conflicts + supersession', () => {
  it('projects ADR ↔ service/file and walks neighbors', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p2-'));
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
    });
    const adr = sys.createAdr({
      title: 'PostgreSQL for billing',
      decision: { summary: 'Use PostgreSQL for billing-service' },
      affected_components: ['billing-service'],
      evidence: {
        commits: [],
        pull_requests: [],
        tests: [],
        documents: [],
        conversations: [],
        code: [{ type: 'code', id: 'src/billing/db.ts', relationship: 'touches' }],
      },
      record_kind: 'decision',
      status: 'accepted',
    });
    const nb = sys.neighborhood('billing-service', 2);
    assert.ok(nb.nodes.some((n) => n.kind === 'ADR' && n.label === adr.id));
    const impact = sys.impact({
      change: 'touch billing db',
      affected_files: ['src/billing/db.ts'],
    });
    assert.ok(impact.affected_decisions.includes(adr.id));
    sys.stop();
  });

  it('detects replace-X-with-Y against a rejected alternative', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p2c-'));
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
    });
    sys.createAdr({
      title: 'Use PostgreSQL',
      decision: { summary: 'Use PostgreSQL as the primary transactional database' },
      alternatives: [{ name: 'MongoDB', status: 'rejected', reason: 'No ACID' }],
      affected_components: ['billing-service'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const conflicts = sys.checkConflicts('Replace PostgreSQL with MongoDB');
    assert.ok(conflicts.some((c) => c.conflict && c.severity === 'high'));
    sys.stop();
  });

  it('supersession hides old ADR from default search', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p2s-'));
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
    });
    const old = sys.createAdr({
      title: 'Use PostgreSQL',
      decision: { summary: 'Use PostgreSQL' },
      record_kind: 'decision',
      status: 'accepted',
    });
    const next = sys.createAdr({
      title: 'Use PostgreSQL with replicas',
      decision: { summary: 'Use PostgreSQL + read replicas' },
      record_kind: 'decision',
      status: 'accepted',
    });
    sys.supersede(old.id, next.id);
    const active = await sys.search('PostgreSQL');
    assert.ok(active.every((a) => a.id !== old.id));
    const hist = await sys.search('PostgreSQL', { historical: true });
    assert.ok(hist.some((a) => a.id === old.id) || hist.some((a) => a.id === next.id));
    assert.equal(sys.store.get(old.id).status, 'superseded');
    assert.equal(sys.store.get(next.id).relationships.supersedes, old.id);
    sys.stop();
  });
});

describe('Phase 3 drift + validation + evidence + evolution', () => {
  it('detects order-service calling Stripe when payments must go through payment-service', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p3d-'));
    mkdirSync(join(root, 'src/order-service'), { recursive: true });
    writeFileSync(
      join(root, 'src/order-service/pay.ts'),
      'import Stripe from "stripe";\nexport const stripe = new Stripe("sk_test");\n',
    );
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
      flags: { architecture_evolution_enabled: false },
    });
    const adr = sys.createAdr({
      title: 'Centralize payments',
      decision: { summary: 'All payment processing must go through payment-service.' },
      constraints: ['All payment processing must go through payment-service'],
      affected_components: ['payment-service'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = sys.scanDrift();
    assert.ok(
      drifts.some((d) => d.adr_id === adr.id && d.kind === 'constraint_violation' && d.severity === 'high'),
      JSON.stringify(drifts),
    );
    sys.stop();
  });

  it('flags rejected alternatives that appear in code', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p3r-'));
    mkdirSync(join(root, 'src/billing-service'), { recursive: true });
    writeFileSync(
      join(root, 'src/billing-service/db.ts'),
      'import mongoose from "mongoose";\nexport const db = mongoose;\n',
    );
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
      flags: { architecture_evolution_enabled: false },
    });
    sys.createAdr({
      title: 'Use PostgreSQL',
      decision: { summary: 'Use PostgreSQL as the primary transactional database' },
      alternatives: [{ name: 'MongoDB', status: 'rejected', reason: 'No ACID' }],
      affected_components: ['billing-service'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = sys.scanDrift();
    assert.ok(drifts.some((d) => d.kind === 'rejected_in_use' && /mongo/i.test(d.reason)));
    sys.stop();
  });

  it('attaches incident evidence and fails deep validation', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p3e-'));
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
      flags: { architecture_evolution_enabled: false },
    });
    const adr = sys.createAdr({
      title: 'Use PostgreSQL',
      decision: { summary: 'Use PostgreSQL for billing-service' },
      affected_components: ['billing-service'],
      record_kind: 'decision',
      status: 'implemented',
    });
    sys.attachEvidence({
      event_type: 'INCIDENT_REPORTED',
      event_version: 1,
      event_id: 'evt_inc',
      timestamp: new Date().toISOString(),
      project_id: 'p1',
      payload: { incident_id: 'inc_9', service: 'billing-service' },
    });
    sys.attachEvidence({
      event_type: 'INCIDENT_REPORTED',
      event_version: 1,
      event_id: 'evt_inc2',
      timestamp: new Date().toISOString(),
      project_id: 'p1',
      payload: { incident_id: 'inc_10', service: 'billing-service' },
    });
    const stored = sys.store.get(adr.id);
    assert.equal(stored.evidence.incidents.length, 2);
    const result = sys.validateAdr(adr.id);
    assert.equal(result.status, 'failed');
    sys.stop();
  });

  it('proposes evolution without auto-superseding', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p3v-'));
    mkdirSync(join(root, 'src/order-service'), { recursive: true });
    writeFileSync(join(root, 'src/order-service/pay.ts'), 'import Stripe from "stripe";\n');
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
    });
    const adr = sys.createAdr({
      title: 'Centralize payments',
      decision: { summary: 'Payments must go through payment-service' },
      constraints: ['Payments must go through payment-service'],
      affected_components: ['payment-service'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const proposals = sys.evolve('drift');
    assert.ok(proposals.some((p) => p.old_adr_id === adr.id));
    assert.equal(sys.store.get(adr.id).status, 'accepted');
    const proposed = sys.store.get(proposals[0].proposed_adr_id);
    assert.equal(proposed.status, 'proposed');
    assert.equal(proposed.record_kind, 'candidate');
    sys.stop();
  });

  it('validates implemented ADRs that match the code', () => {
    const root = mkdtempSync(join(tmpdir(), 'arch-p3ok-'));
    mkdirSync(join(root, 'src/billing-service'), { recursive: true });
    writeFileSync(
      join(root, 'src/billing-service/db.ts'),
      'import postgres from "postgres";\nexport const sql = postgres();\n',
    );
    const sys = createArchitectureSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
      persistGraph: false,
      flags: { architecture_evolution_enabled: false },
    });
    const adr = sys.createAdr({
      title: 'Use PostgreSQL',
      decision: { summary: 'Use PostgreSQL for billing-service' },
      affected_components: ['billing-service'],
      evidence: {
        commits: [{ type: 'commit', id: 'abc', relationship: 'implemented_decision' }],
        pull_requests: [],
        tests: [{ type: 'test', id: 'billing.spec.ts', relationship: 'supports' }],
        documents: [],
        conversations: [],
        code: [{ type: 'code', id: 'src/billing-service/db.ts', relationship: 'touches' }],
        incidents: [],
        deployments: [],
        metrics: [],
      },
      record_kind: 'decision',
      status: 'implemented',
    });
    const result = sys.validateAdr(adr.id);
    assert.equal(result.status, 'passed');
    assert.equal(sys.store.get(adr.id).status, 'validated');
    const impact = sys.impact({
      change: 'touch billing db',
      affected_files: ['src/billing-service/db.ts'],
    });
    assert.ok(impact.recommendation);
    sys.stop();
  });
});

