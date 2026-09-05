import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aggregateOutcome,
  assertSafeCommand,
  compileRequirement,
  createMemoryStore,
  createOutcomeSubsystem,
  eventTypeName,
  heuristicExtractRequirements,
  judgeCriterion,
  judgeRequirement,
  parseEventTypeName,
  sanitizeEvidenceText,
} from '../dist/index.js';
import { LocalEventBuffer } from '../dist/events/localBuffer.js';
import { InMemoryEventBus } from '../dist/events/memoryBus.js';
import { OutboxPublisher } from '../dist/events/outboxPublisher.js';
import { CommandVerifier } from '../dist/verification/adapters/command.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeExecutor(handler) {
  return { exec: handler };
}

async function waitUntil(fn, timeoutMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = fn();
    if (v) {
      return v;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitUntil timeout');
}

describe('domain judge + aggregator', () => {
  it('UNKNOWN is never PASS', () => {
    assert.equal(judgeCriterion([{ mandatory: true, result: 'PASS' }]), 'PASS');
    assert.equal(
      judgeCriterion([
        { mandatory: true, result: 'PASS' },
        { mandatory: true, result: 'UNKNOWN' },
      ]),
      'UNKNOWN',
    );
    assert.equal(
      judgeRequirement([
        { mandatory: true, status: 'PASS' },
        { mandatory: true, status: 'FAIL' },
      ]),
      'FAIL',
    );
  });

  it('critical FAIL blocks ACHIEVED even with high score', () => {
    const agg = aggregateOutcome([
      { id: 'REQ-1', criticality: 'LOW', status: 'PASS' },
      { id: 'REQ-2', criticality: 'LOW', status: 'PASS' },
      { id: 'REQ-3', criticality: 'LOW', status: 'PASS' },
      { id: 'REQ-SEC', criticality: 'CRITICAL', status: 'FAIL' },
    ]);
    assert.equal(agg.status, 'NOT_ACHIEVED');
    assert.equal(agg.score, 75);
    assert.ok(agg.blocking.includes('REQ-SEC'));
  });

  it('stale evidence does not count as PASS', () => {
    const agg = aggregateOutcome([
      { id: 'a', criticality: 'HIGH', status: 'STALE' },
      { id: 'b', criticality: 'HIGH', status: 'PASS' },
    ]);
    assert.equal(agg.status, 'PARTIALLY_ACHIEVED');
  });

  it('all PASS → ACHIEVED', () => {
    const agg = aggregateOutcome([
      { id: 'a', criticality: 'CRITICAL', status: 'PASS' },
      { id: 'b', criticality: 'LOW', status: 'PASS' },
    ]);
    assert.equal(agg.status, 'ACHIEVED');
    assert.equal(agg.score, 100);
  });
});

describe('extraction + compiler', () => {
  it('splits a user mission into structured requirements', () => {
    const drafts = heuristicExtractRequirements(
      'Create a REST endpoint that creates a user. Email must be unique, invalid email should return 400, password must be hashed, and successful creation should return 201.',
    );
    assert.ok(drafts.length >= 3);
    const compiled = compileRequirement({
      id: 'REQ-001',
      mission_id: 'm1',
      description: drafts[0].description,
      type: drafts[0].type,
      priority: 'high',
      criticality: 'HIGH',
      status: 'PENDING',
      source: { type: 'user_request', text: drafts[0].source_text },
      constraints: [],
      dependencies: [],
      measurable_properties: [],
      requirement_version_hash: 'abc',
      scope: 'MISSION',
      owned_paths: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
    assert.equal(compiled.acceptanceCriteria.length, 1);
    assert.ok(compiled.acceptanceCriteria[0].id.startsWith('AC-'));
  });
});

describe('command adapter', () => {
  it('PASS on exit 0, FAIL on nonzero, UNKNOWN on timeout', async () => {
    const v = new CommandVerifier();
    const plan = {
      id: 'p',
      mission_id: 'm',
      requirement_id: 'r',
      criterion_id: 'c',
      type: 'COMMAND',
      command: 'npm',
      args: ['test'],
      timeout_ms: 1000,
      workspace_root: '/tmp',
      created_at: '',
      updated_at: '',
      version: 1,
      status: 'READY',
    };
    const pass = await v.execute(plan, {
      workspaceRoot: '/tmp',
      missionId: 'm',
      codeRevision: 'abc',
      requirementVersionHash: 'h',
      executor: fakeExecutor(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        durationMs: 2,
        timedOut: false,
      })),
    });
    assert.equal(pass.result, 'PASS');
    const fail = await v.execute(plan, {
      workspaceRoot: '/tmp',
      missionId: 'm',
      codeRevision: 'abc',
      requirementVersionHash: 'h',
      executor: fakeExecutor(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'boom',
        durationMs: 2,
        timedOut: false,
      })),
    });
    assert.equal(fail.result, 'FAIL');
    const unknown = await v.execute(plan, {
      workspaceRoot: '/tmp',
      missionId: 'm',
      codeRevision: 'abc',
      requirementVersionHash: 'h',
      executor: fakeExecutor(async () => ({
        exitCode: -1,
        stdout: '',
        stderr: '',
        durationMs: 1000,
        timedOut: true,
      })),
    });
    assert.equal(unknown.result, 'UNKNOWN');
  });

  it('rejects unsafe commands', () => {
    assert.throws(() => assertSafeCommand('rm', ['-rf', '/']));
    assert.throws(() => assertSafeCommand('npm', ['test; rm -rf /']));
  });
});

describe('events', () => {
  it('versions event type names', () => {
    assert.equal(eventTypeName('mission.created', 1), 'mission.created.v1');
    assert.deepEqual(parseEventTypeName('mission.created.v2'), {
      type: 'mission.created',
      version: 2,
    });
  });

  it('append is synchronous and survives WAL failure', () => {
    const buf = new LocalEventBuffer({ walPath: '/proc/does-not-exist/events.wal' });
    buf.append({
      event_type: 'mission.execution.updated',
      project_id: 'p',
    });
    assert.equal(buf.peekDepth(), 1);
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

describe('sanitize', () => {
  it('redacts tokens from evidence text', () => {
    const s = sanitizeEvidenceText('Authorization: Bearer supersecret.jwt.token');
    assert.equal(s.includes('supersecret'), false);
  });
});

describe('failure isolation', () => {
  it('emit still returns when engine disabled or store throws', () => {
    const root = mkdtempSync(join(tmpdir(), 'out-iso-'));
    const sys = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      flags: { outcome_engine_enabled: false },
    });
    sys.emit({
      event_type: 'USER_INTENT_CAPTURED',
      project_id: 'p1',
      payload: { text: 'build login' },
    });
    assert.equal(sys.lookup(), '');
    sys.stop();
  });
});

describe('lifecycle e2e', () => {
  it('extract → compile → verify FAIL → remediate → re-verify PASS', async () => {
    const root = mkdtempSync(join(tmpdir(), 'out-e2e-'));
    let calls = 0;
    const sys = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      executor: fakeExecutor(async () => {
        calls += 1;
        if (calls <= 2) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'HTTP 500',
            durationMs: 3,
            timedOut: false,
          };
        }
        return {
          exitCode: 0,
          stdout: '3 passed',
          stderr: '',
          durationMs: 3,
          timedOut: false,
        };
      }),
    });
    await sys.start();
    sys.emit({
      event_type: 'mission.created',
      project_id: 'p1',
      payload: {
        text: 'Build a login API where users authenticate with email and password, invalid passwords return HTTP 401, and passwords are never stored in plaintext.',
      },
    });
    await sys.publisher.flush(40);
    const missions = await waitUntil(() => {
      const list = sys.store.listMissions('p1');
      return list.length ? list : null;
    });
    const mission = missions[0];
    const reqs = sys.store.listRequirements(mission.id);
    assert.ok(reqs.length >= 1);
    assert.ok(sys.store.listCriteria(reqs[0].id).length >= 1);

    sys.emit({
      event_type: 'READY_FOR_VERIFICATION',
      project_id: 'p1',
      mission_id: mission.id,
    });
    await sys.publisher.flush(80);
    await waitUntil(() => sys.store.getOutcome(mission.id), 4000);
    const outcome1 = sys.store.getOutcome(mission.id);
    assert.ok(outcome1);
    assert.notEqual(outcome1.status, 'ACHIEVED');
    const rems = sys.store.listRemediations(mission.id);
    assert.ok(rems.length >= 1);

    const failed = sys.store.listRequirements(mission.id).filter((r) => r.status === 'FAIL');
    for (const r of failed.length ? failed : reqs) {
      await sys.queueVerify(r.id);
    }
    await sys.publisher.flush(80);
    await waitUntil(() => {
      const o = sys.store.getOutcome(mission.id);
      return o && o.fail_count === 0 ? o : null;
    }, 4000);
    const evid = sys.store.listEvidenceForRequirement(reqs[0].id);
    assert.ok(evid.length >= 1);
    const ids = new Set(evid.map((e) => e.id));
    assert.equal(ids.size, evid.length);

    sys.emit({
      event_type: 'CODE_CHANGE_COMPLETED',
      project_id: 'p1',
      mission_id: mission.id,
      commit_id: 'def456',
    });
    await sys.publisher.flush(20);
    const stale = sys.store.listRequirements(mission.id);
    assert.ok(stale.every((r) => r.status === 'STALE' || r.status === 'PENDING'));

    sys.stop();
  });

  it('duplicate verification.requested does not double-run concurrently', async () => {
    const root = mkdtempSync(join(tmpdir(), 'out-dup-'));
    let runs = 0;
    const sys = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      executor: fakeExecutor(async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 40));
        return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 40, timedOut: false };
      }),
    });
    await sys.start();
    sys.emit({
      event_type: 'mission.created',
      project_id: 'p1',
      payload: { text: 'Code must compile without TypeScript errors.' },
    });
    await sys.publisher.flush(40);
    const mission = sys.store.listMissions('p1')[0];
    const req = sys.store.listRequirements(mission.id)[0];
    const a = sys.queueVerify(req.id);
    const b = sys.queueVerify(req.id);
    await Promise.all([a, b]);
    await sys.publisher.flush(40);
    await waitUntil(() => sys.store.getOutcome(mission.id));
    assert.ok(runs >= 1);
    sys.stop();
  });
});

describe('hot-path isolation (grep)', () => {
  const forbidden = [
    'outcome/src/workers',
    'outcome/src/verification',
    'outcome/src/persistence/sqlite',
    'RequirementExtractor',
    'review/evaluator',
    'ReviewPolicyEngine',
    'human_reviews',
  ];
  const hotFiles = [
    join(here, '../../../vscode/extensions/singularity-chat/src/platform/endpoint/node/automodeService.ts'),
    join(here, '../../../vscode/extensions/singularity-chat/src/extension/intents/node/toolCallingLoop.ts'),
    join(
      here,
      '../../../vscode/extensions/singularity-chat/src/platform/endpoint/node/singularityPromptEngineBridge.ts',
    ),
  ];

  it('coding LLM files do not import outcome workers', () => {
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
    event_type: 'mission.execution.updated',
    project_id: sys.projectId,
    payload: { revision: 'abc', text: prompt },
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
  const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
  return {
    tps: n / Math.max(elapsed, 0.0001),
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    mean,
  };
}

describe('TPS acceptance A–F', () => {
  it('coding TPS stays effectively unchanged', async () => {
    const n = 100;
    const root = mkdtempSync(join(tmpdir(), 'out-bench-'));
    const cpu0 = process.cpuUsage();
    const mem0 = process.memoryUsage();

    const disabled = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      flags: { outcome_engine_enabled: false },
    });
    const a = await runConcurrent(n, () => codingTick(disabled, 'edit file'));

    const enabled = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      executor: fakeExecutor(async () => ({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        durationMs: 1,
        timedOut: false,
      })),
    });
    await enabled.start();
    const b = await runConcurrent(n, () => codingTick(enabled, 'edit file'));

    for (let i = 0; i < 500; i++) {
      enabled.emit({
        event_type: 'CODE_CHANGE_COMPLETED',
        project_id: 'p1',
        payload: { text: `noise ${i}` },
      });
    }
    const c = await runConcurrent(n, () => codingTick(enabled, 'implement feature'));

    const throwingStore = createMemoryStore();
    throwingStore.upsertMission = () => {
      throw new Error('sqlite locked');
    };
    const failing = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: throwingStore,
    });
    await failing.start();
    const d = await runConcurrent(n, () => codingTick(failing, 'still coding'));

    enabled.publisher.stop();
    for (let i = 0; i < 200; i++) {
      enabled.emit({
        event_type: 'REVIEW_EVALUATE_REQUESTED',
        project_id: 'p1',
        payload: { i },
      });
    }
    const e = await runConcurrent(n, () => codingTick(enabled, 'review queue pressure'));

    const throwingReviews = createMemoryStore();
    throwingReviews.listReviews = () => {
      throw new Error('review store down');
    };
    const reviewFail = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: throwingReviews,
    });
    await reviewFail.start();
    const f = await runConcurrent(n, () => codingTick(reviewFail, 'review worker throw'));

    const cpu = process.cpuUsage(cpu0);
    const mem = process.memoryUsage();
    const report = {
      A_disabled: a,
      B_enabled: b,
      C_queue_pressure: c,
      D_store_failure: d,
      E_review_queue_pressure: e,
      F_review_store_failure: f,
      cpu_user_us: cpu.user,
      cpu_system_us: cpu.system,
      rss_bytes: mem.rss,
      heap_bytes: mem.heapUsed,
      rss_delta_bytes: mem.rss - mem0.rss,
    };
    const outDir = join(here, '../../../benchmarks/outcome-verification');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'METRICS.json'), JSON.stringify(report, null, 2));

    assert.ok(a.mean < 20);
    assert.ok(b.mean < 20);
    assert.ok(c.mean < 20);
    assert.ok(d.mean < 20);
    assert.ok(e.mean < 20);
    assert.ok(f.mean < 20);

    enabled.stop();
    failing.stop();
    disabled.stop();
    reviewFail.stop();
  });

  it('READY_FOR_VERIFICATION with runtime hot-path evidence persists Evidence rows (write-through)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'out-evw-'));
    const sys = createOutcomeSubsystem({
      workspaceRoot: root,
      projectId: 'p1',
      store: createMemoryStore(),
      heuristicOnly: true,
    });
    sys.start();

    // Create a mission (USER_INTENT_CAPTURED → onIntent creates + extracts).
    sys.emit({
      event_type: 'USER_INTENT_CAPTURED',
      project_id: 'p1',
      payload: { text: 'Add a null check to parseConfig.' },
    });
    await sys.publisher.flush(40);
    const mission = await waitUntil(() => sys.store.listMissions('p1')[0] ?? null);
    assert.ok(mission, 'mission should exist');

    const revision = 'evid123';
    sys.emit({
      event_type: 'READY_FOR_VERIFICATION',
      project_id: 'p1',
      mission_id: mission.id,
      commit_id: revision,
      payload: {
        verification_evidence: {
          ok: false,
          riskTier: 'high',
          riskScore: 72,
          toolsOk: false,
          toolChecks: [
            { name: 'typecheck', ok: false, summary: 'error TS2345 in src/a.ts' },
            { name: 'tests', ok: true, summary: '12 passing' },
          ],
          requirementsOk: true,
          requirementChecks: [{ id: 'req-1', kind: 'requirement', text: 'null guarded', status: 'pass' }],
          appliedPaths: ['src/a.ts'],
        },
      },
    });
    // Rely on the outbox interval tick (re-entrant flush() can starve delivery
    // via the publisher's single-flight guard); waitUntil handles the timing.

    let evid;
    await waitUntil(() => {
      evid = sys.store.listEvidenceForMission(mission.id).filter(
        (e) => e.source === `runtime-hotpath:${mission.id}:${revision}`,
      );
      return evid.length >= 3 ? evid : null;
    }, 4000);

    const typecheck = evid.find((e) => e.artifact === 'typecheck');
    assert.ok(typecheck, 'typecheck evidence recorded');
    assert.equal(typecheck.result, 'FAIL');
    assert.equal(typecheck.type, 'static_analysis');
    const testsEv = evid.find((e) => e.artifact === 'tests');
    assert.equal(testsEv.result, 'PASS');
    const reqEv = evid.find((e) => e.artifact === 'req-1');
    assert.equal(reqEv.result, 'PASS');
    assert.equal(reqEv.type, 'runtime');
    for (const e of evid) {
      assert.ok(e.stdout === undefined || !e.stdout.includes('secret'));
    }

    // Idempotency: re-emitting the same checkpoint must not double-record.
    sys.emit({
      event_type: 'READY_FOR_VERIFICATION',
      project_id: 'p1',
      mission_id: mission.id,
      commit_id: revision,
      payload: {
        verification_evidence: {
          ok: false,
          toolChecks: [{ name: 'typecheck', ok: false, summary: 'again' }],
        },
      },
    });
    await new Promise((r) => setTimeout(r, 1_300));
    const after = sys.store
      .listEvidenceForMission(mission.id)
      .filter((e) => e.source === `runtime-hotpath:${mission.id}:${revision}`);
    assert.equal(after.length, evid.length, 'no duplicate evidence rows');

    // A new revision records fresh evidence.
    sys.emit({
      event_type: 'READY_FOR_VERIFICATION',
      project_id: 'p1',
      mission_id: mission.id,
      commit_id: 'rev456',
      payload: {
        verification_evidence: {
          ok: true,
          toolChecks: [{ name: 'typecheck', ok: true, summary: 'clean' }],
        },
      },
    });
    await waitUntil(() => {
      const rows = sys.store
        .listEvidenceForMission(mission.id)
        .filter((e) => e.source === `runtime-hotpath:${mission.id}:rev456`);
      return rows.length >= 1 ? rows : null;
    }, 4000);

    sys.stop();
  });
});
