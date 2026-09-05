import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyReviewOverlay,
  canTransitionReview,
  checkReviewerPolicy,
  createMemoryStore,
  createOutcomeSubsystem,
  DEFAULT_REVIEW_POLICIES,
  evaluatePolicies,
  reviewFingerprint,
} from '../dist/index.js';

function passingReq(missionId, i = 1) {
  return {
    id: `${missionId}:REQ-${i}`,
    mission_id: missionId,
    description: 'works',
    type: 'functional',
    priority: 'high',
    criticality: 'HIGH',
    status: 'PASS',
    source: { type: 'test', text: 'works' },
    constraints: [],
    dependencies: [],
    measurable_properties: [],
    requirement_version_hash: 'abc',
    scope: 'MISSION',
    owned_paths: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
  };
}

describe('review policy evaluation', () => {
  it('requires blocking review for high risk production', () => {
    const hits = evaluatePolicies(
      {
        mission_id: 'm1',
        risk_level: 'HIGH',
        affects_production: true,
        has_proposed_adrs: false,
        security_sensitive: false,
        schema_change: false,
        deployment_change: false,
        large_refactor: false,
        verification_failures: false,
        conflicting_evidence: false,
        outcome_confidence: 1,
      },
      DEFAULT_REVIEW_POLICIES,
    );
    const prod = hits.find((h) => h.policy.id === 'prod-high-risk');
    assert.ok(prod);
    assert.equal(prod.blocking, true);
    assert.equal(prod.blocks_execution, true);
  });

  it('architecture impact is non-blocking', () => {
    const hits = evaluatePolicies(
      {
        mission_id: 'm1',
        risk_level: 'LOW',
        affects_production: false,
        architecture_impact: 'high',
        impact_recommendation: 'ARCHITECTURE_REVIEW_REQUIRED',
        has_proposed_adrs: false,
        security_sensitive: false,
        schema_change: false,
        deployment_change: false,
        large_refactor: false,
        verification_failures: false,
        conflicting_evidence: false,
        outcome_confidence: 1,
      },
      DEFAULT_REVIEW_POLICIES,
    );
    const arch = hits.find((h) => h.policy.id === 'arch-high-impact');
    assert.ok(arch);
    assert.equal(arch.blocking, false);
  });

  it('low risk does not require review', () => {
    const hits = evaluatePolicies(
      {
        mission_id: 'm1',
        risk_level: 'LOW',
        affects_production: false,
        has_proposed_adrs: false,
        security_sensitive: false,
        schema_change: false,
        deployment_change: false,
        large_refactor: false,
        verification_failures: false,
        conflicting_evidence: false,
        outcome_confidence: 1,
      },
      DEFAULT_REVIEW_POLICIES,
    );
    assert.equal(hits.length, 0);
  });
});

describe('review state transitions', () => {
  it('allows pending to approved and rejects approved to pending', () => {
    assert.equal(canTransitionReview('PENDING', 'APPROVED'), true);
    assert.equal(canTransitionReview('APPROVED', 'PENDING'), false);
    assert.equal(canTransitionReview('APPROVED', 'SUPERSEDED'), true);
  });
});

describe('reviewer authorization', () => {
  it('rejects missing identity and author self-review', () => {
    assert.equal(checkReviewerPolicy({}).ok, false);
    assert.equal(
      checkReviewerPolicy({ identity: { id: 'a', roles: [] }, author_id: 'a' }).ok,
      false,
    );
    assert.equal(
      checkReviewerPolicy({ identity: { id: 'b', roles: [] }, author_id: 'a' }).ok,
      true,
    );
  });

  it('requires senior role for production', () => {
    const r = checkReviewerPolicy({
      identity: { id: 'b', roles: ['reviewer'] },
      affects_production: true,
    });
    assert.equal(r.ok, false);
    assert.equal(
      checkReviewerPolicy({
        identity: { id: 'b', roles: ['senior'] },
        affects_production: true,
      }).ok,
      true,
    );
  });
});

describe('stale-review detection', () => {
  it('fingerprint changes when revision changes', () => {
    const a = reviewFingerprint({ mission_id: 'm', code_revision: '1' });
    const b = reviewFingerprint({ mission_id: 'm', code_revision: '2' });
    assert.notEqual(a, b);
  });
});

describe('outcome overlay blocking vs non-blocking', () => {
  const base = {
    id: 'r1',
    mission_id: 'm1',
    review_type: 'PRODUCTION',
    priority: 'HIGH',
    reason: 'policy',
    policy_id: 'prod-high-risk',
    required: true,
    requested_at: new Date().toISOString(),
    requested_by: 'system',
    evidence_refs: [],
    artifact_refs: [],
    adr_refs: [],
    risk_refs: [],
    outcome_refs: [],
    fingerprint: 'fp',
    mission_version: 1,
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('blocking pending prevents ACHIEVED', () => {
    const o = applyReviewOverlay('ACHIEVED', [{ ...base, status: 'PENDING', blocking: true, blocks_execution: false }], 'fp');
    assert.equal(o.status, 'AWAITING_HUMAN_REVIEW');
  });

  it('blocking rejected yields REVIEW_REJECTED', () => {
    const o = applyReviewOverlay('ACHIEVED', [{ ...base, status: 'REJECTED', blocking: true, blocks_execution: false }], 'fp');
    assert.equal(o.status, 'REVIEW_REJECTED');
  });

  it('blocking approved with matching fingerprint allows ACHIEVED', () => {
    const o = applyReviewOverlay('ACHIEVED', [{ ...base, status: 'APPROVED', blocking: true, blocks_execution: false }], 'fp');
    assert.equal(o.status, 'ACHIEVED');
  });

  it('stale approved is treated as open', () => {
    const o = applyReviewOverlay('ACHIEVED', [{ ...base, status: 'APPROVED', blocking: true, blocks_execution: false, fingerprint: 'old' }], 'fp');
    assert.equal(o.status, 'AWAITING_HUMAN_REVIEW');
  });

  it('non-blocking pending does not prevent ACHIEVED', () => {
    const o = applyReviewOverlay('ACHIEVED', [{ ...base, status: 'PENDING', blocking: false, blocks_execution: false }], 'fp');
    assert.equal(o.status, 'ACHIEVED');
  });

  it('blocks_execution sets HUMAN_GATE_BLOCKED', () => {
    const o = applyReviewOverlay('ACHIEVED', [{ ...base, status: 'PENDING', blocking: true, blocks_execution: true }], 'fp');
    assert.equal(o.execution_gate, 'HUMAN_GATE_BLOCKED');
  });
});

describe('mission review integration', () => {
  it('mission → policy → human decision → outcome', async () => {
    const store = createMemoryStore();
    const sys = createOutcomeSubsystem({
      workspaceRoot: '/tmp/review-int',
      projectId: 'p1',
      store,
      architecturePort: {
        collectSignals: () => ({
          risk_level: 'HIGH',
          risk_score: 80,
          affects_production: true,
          architecture_version: 1,
          evidence_watermark: 'w1',
        }),
      },
    });
    await sys.start();
    const created = sys.createMission('ship production change', 'author-1');
    const mission = store.getMission(created.id);
    store.upsertRequirement(passingReq(created.id));
    sys.pipeline.reviews.ensureReviews(mission);
    sys.pipeline.rollupMission(created.id);
    const reviews = store.listReviews(created.id);
    assert.ok(reviews.length >= 1);
    const blocking = reviews.filter((r) => r.blocking);
    assert.ok(blocking.length >= 1);
    assert.equal(store.getOutcome(created.id)?.status, 'AWAITING_HUMAN_REVIEW');

    const denied = sys.decideReview(blocking[0].id, 'APPROVE', { id: 'author-1', roles: ['senior'] });
    assert.equal(denied.error?.code, 'author_is_reviewer');

    const missing = sys.decideReview(blocking[0].id, 'REJECT', { id: 'rev-2', roles: ['senior'] });
    assert.equal(missing.error?.code, 'reason_required');

    for (const r of blocking) {
      const ok = sys.decideReview(r.id, 'APPROVE', { id: 'rev-2', roles: ['senior'] }, 'looks good');
      assert.equal(ok.error, undefined);
      assert.equal(ok.review.status, 'APPROVED');
    }
    assert.equal(store.getOutcome(created.id)?.status, 'ACHIEVED');

    const dup = sys.decideReview(blocking[0].id, 'APPROVE', { id: 'rev-3', roles: ['senior'] });
    assert.equal(dup.error?.status, 409);

    const events = store.listReviewEvents(blocking[0].id);
    assert.ok(events.length >= 2);
    const humanEv = store.listEvidenceForMission(created.id).filter((e) => e.type === 'human');
    assert.ok(humanEv.length >= 1);
    sys.stop();
  });

  it('ADR accept records architecture review decision', async () => {
    const store = createMemoryStore();
    const sys = createOutcomeSubsystem({
      workspaceRoot: '/tmp/review-adr',
      projectId: 'p1',
      store,
      architecturePort: {
        collectSignals: () => ({
          proposed_adrs: [{ kind: 'adr', id: 'ADR-1', label: 'Use SQLite', provenance: 'ADR-1' }],
        }),
      },
    });
    await sys.start();
    const created = sys.createMission('architecture change', 's1');
    store.upsertRequirement(passingReq(created.id));
    sys.pipeline.reviews.ensureReviews(store.getMission(created.id));
    sys.pipeline.rollupMission(created.id);
    const arch = store.listReviews(created.id).find((r) => r.review_type === 'ARCHITECTURE');
    assert.ok(arch);
    sys.pipeline.reviews.syncAdrDecision({
      adr_id: 'ADR-1',
      status: 'accepted',
      actor_id: 'human',
      project_id: 'p1',
    });
    sys.pipeline.rollupMission(created.id);
    assert.equal(store.getReview(arch.id)?.status, 'APPROVED');
    assert.equal(store.getOutcome(created.id)?.status, 'ACHIEVED');
    sys.stop();
  });

  it('material change supersedes prior approval', async () => {
    const store = createMemoryStore();
    let revision = 'rev1';
    const sys = createOutcomeSubsystem({
      workspaceRoot: '/tmp/review-stale',
      projectId: 'p1',
      store,
      architecturePort: {
        collectSignals: () => ({
          risk_level: 'HIGH',
          affects_production: true,
          architecture_version: revision,
          evidence_watermark: revision,
        }),
      },
    });
    await sys.start();
    const created = sys.createMission('prod', 's1');
    store.upsertRequirement(passingReq(created.id));
    store.upsertMission({ ...store.getMission(created.id), code_revision: 'rev1' });
    sys.pipeline.reviews.ensureReviews(store.getMission(created.id));
    const review = store.listReviews(created.id)[0];
    sys.decideReview(review.id, 'APPROVE', { id: 'rev-2', roles: ['senior'] });
    assert.equal(store.getReview(review.id).status, 'APPROVED');
    revision = 'rev2';
    store.upsertMission({ ...store.getMission(created.id), code_revision: 'rev2', version: 3 });
    sys.pipeline.reviews.ensureReviews(store.getMission(created.id));
    assert.equal(store.getReview(review.id).status, 'SUPERSEDED');
    assert.ok(store.listReviews(created.id).some((r) => r.status === 'PENDING'));
    sys.stop();
  });
});
