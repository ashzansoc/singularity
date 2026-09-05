import type {
  Evidence,
  HumanReview,
  HumanReviewDecision,
  HumanReviewEvent,
  HumanReviewStatus,
  Mission,
} from '../domain/types.js';
import { newId, nowIso } from '../ids.js';
import type { OutcomeStore } from '../persistence/store.js';
import type { OutcomeMetricsCollector } from '../metrics.js';
import type { OutcomeEvent } from '../events/types.js';
import { DEFAULT_REVIEW_POLICIES, REVIEW_POLICY_VERSION } from './defaults.js';
import { evaluatePolicies } from './evaluator.js';
import { buildEvidencePackage } from './evidencePackage.js';
import { requirementContentHash, reviewFingerprint } from './fingerprint.js';
import { applyReviewOverlay } from './overlay.js';
import type { ArchitectureReviewPort } from './port.js';
import { collectMissionSignals } from './signals.js';
import { assertReviewTransition } from './transitions.js';
import type { ReviewerIdentity } from './reviewerPolicy.js';
import { checkReviewerPolicy } from './reviewerPolicy.js';

export type ReviewEnqueue = (
  event: Omit<OutcomeEvent, 'event_id' | 'timestamp' | 'event_version'> & Partial<OutcomeEvent>,
) => void;

export class ReviewEngine {
  constructor(
    private readonly store: OutcomeStore,
    private readonly metrics: OutcomeMetricsCollector,
    private readonly enqueue: ReviewEnqueue,
    private architecturePort?: ArchitectureReviewPort,
  ) {}

  setArchitecturePort(port?: ArchitectureReviewPort): void {
    this.architecturePort = port;
  }

  seedDefaultPolicies(): void {
    if (this.store.listReviewPolicies().length) {
      return;
    }
    for (const p of DEFAULT_REVIEW_POLICIES) {
      this.store.upsertReviewPolicy(p);
    }
  }

  currentFingerprint(mission: Mission): string {
    const reqs = this.store.listRequirements(mission.id);
    let archVersion: string | number = '';
    let watermark = '';
    try {
      const arch = this.architecturePort?.collectSignals({
        mission_id: mission.id,
        project_id: mission.project_id,
        code_revision: mission.code_revision,
      });
      archVersion = arch?.architecture_version ?? '';
      watermark = arch?.evidence_watermark ?? '';
    } catch {
      /* optional */
    }
    return reviewFingerprint({
      mission_id: mission.id,
      code_revision: mission.code_revision,
      architecture_version: archVersion,
      evidence_watermark: watermark,
      policy_version: REVIEW_POLICY_VERSION,
      requirement_hash: requirementContentHash(reqs),
    });
  }

  ensureReviews(mission: Mission): void {
    this.metrics.recordPolicyEvaluation();
    const { signals, arch } = collectMissionSignals(mission, this.store, this.architecturePort);
    const policies = this.store.listReviewPolicies();
    const rules = policies.length ? policies : DEFAULT_REVIEW_POLICIES;
    const hits = evaluatePolicies(signals, rules);
    const fingerprint = this.currentFingerprint(mission);

    for (const existing of this.store.listReviews(mission.id)) {
      if (
        (existing.status === 'APPROVED' ||
          existing.status === 'PENDING' ||
          existing.status === 'IN_REVIEW') &&
        existing.fingerprint !== fingerprint
      ) {
        this.supersede(existing, fingerprint);
      }
    }

    const requiredHits = hits.filter((h) => h.required);
    if (!requiredHits.length) {
      return;
    }

    const outcome = this.store.getOutcome(mission.id);
    const verification = this.store.listEvidenceForMission(mission.id).map((e) => ({
      kind: e.type,
      id: e.id,
      label: `${e.type} ${e.result}`,
      provenance: `evidence:${e.id}`,
    }));

    for (const hit of requiredHits) {
      const existingSame = this.store
        .listReviews(mission.id)
        .find(
          (r) =>
            r.fingerprint === fingerprint &&
            r.policy_id === hit.policy.id &&
            (r.status === 'PENDING' ||
              r.status === 'IN_REVIEW' ||
              r.status === 'APPROVED' ||
              r.status === 'REJECTED'),
        );
      if (existingSame) {
        continue;
      }
      const pkg = buildEvidencePackage({
        mission,
        outcome,
        why_required: hit.reason,
        verification,
        signals: arch,
      });
      this.store.insertEvidencePackage(pkg);
      const now = nowIso();
      const review: HumanReview = {
        id: newId('REV'),
        mission_id: mission.id,
        review_type: hit.policy.review_type,
        status: 'PENDING',
        priority: hit.policy.priority,
        reason: hit.reason,
        policy_id: hit.policy.id,
        required: true,
        blocking: hit.blocking,
        blocks_execution: hit.blocks_execution,
        requested_at: now,
        requested_by: 'system',
        evidence_refs: pkg.verification_results.map((x) => x.id),
        artifact_refs: [],
        adr_refs: [...(arch.proposed_adrs ?? []), ...(arch.adrs ?? [])].map((x) => x.id),
        risk_refs: arch.risk_refs ?? [],
        outcome_refs: outcome ? [outcome.id] : [],
        evidence_package_id: pkg.id,
        fingerprint,
        mission_version: mission.version,
        author_id: mission.session_id,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      this.store.upsertReview(review);
      this.appendEvent(review, 'REVIEW_REQUIRED', 'system', []);
      this.metrics.recordReviewRequest();
      this.enqueue({
        event_type: 'REVIEW_REQUIRED',
        project_id: mission.project_id,
        mission_id: mission.id,
        payload: { review_id: review.id, policy_id: hit.policy.id, blocking: hit.blocking },
      });
    }
  }

  overlay(requirementStatus: Mission['status'], mission: Mission) {
    const fp = this.currentFingerprint(mission);
    return applyReviewOverlay(requirementStatus, this.store.listReviews(mission.id), fp);
  }

  startReview(reviewId: string, identity: ReviewerIdentity): HumanReview {
    const review = this.requireReview(reviewId);
    assertReviewTransition(review.status, 'IN_REVIEW');
    const next = this.patchReview(review, { status: 'IN_REVIEW' });
    this.appendEvent(next, 'REVIEW_STARTED', identity.id, identity.roles);
    this.enqueue({
      event_type: 'REVIEW_STARTED',
      project_id: this.store.getMission(next.mission_id)?.project_id ?? '',
      mission_id: next.mission_id,
      payload: { review_id: next.id },
    });
    return next;
  }

  decide(
    reviewId: string,
    decision: HumanReviewDecision,
    identity: ReviewerIdentity,
    reason?: string,
  ): { review: HumanReview; error?: { status: number; code: string; message: string } } {
    const review = this.requireReview(reviewId);
    const mission = this.store.getMission(review.mission_id);
    const auth = checkReviewerPolicy({
      identity,
      author_id: review.author_id,
      affects_production: review.review_type === 'PRODUCTION' || review.blocks_execution,
    });
    if (!auth.ok) {
      const status = auth.code === 'missing_identity' ? 401 : 403;
      return {
        review,
        error: { status, code: auth.code ?? 'forbidden', message: auth.message ?? 'forbidden' },
      };
    }
    if (decision !== 'APPROVE' && !reason?.trim()) {
      return {
        review,
        error: { status: 400, code: 'reason_required', message: 'Structured reason required' },
      };
    }
    const nextStatus: HumanReviewStatus =
      decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';
    try {
      assertReviewTransition(review.status, nextStatus);
    } catch (e) {
      return {
        review,
        error: { status: 409, code: 'illegal_transition', message: String(e) },
      };
    }
    const key = `review:${review.id}:${nextStatus}`;
    if (!this.store.tryClaimIdempotency(key)) {
      return {
        review,
        error: { status: 409, code: 'already_decided', message: 'Review already has a decision' },
      };
    }
    const now = nowIso();
    const next = this.patchReview(review, {
      status: nextStatus,
      decision,
      decision_reason: reason,
      reviewed_at: now,
      reviewed_by: identity.id,
    });
    this.appendEvent(next, `REVIEW_${nextStatus}`, identity.id, identity.roles, decision, reason);
    this.insertHumanEvidence(next, mission);
    const started = Date.parse(review.requested_at);
    this.metrics.recordReviewDecision(
      decision,
      Number.isFinite(started) ? Date.now() - started : undefined,
    );
    const eventType =
      decision === 'APPROVE'
        ? 'REVIEW_APPROVED'
        : decision === 'REJECT'
          ? 'REVIEW_REJECTED'
          : 'REVIEW_CHANGES_REQUESTED';
    this.enqueue({
      event_type: eventType,
      project_id: mission?.project_id ?? '',
      mission_id: next.mission_id,
      payload: { review_id: next.id, decision, reason },
    });
    return { review: next };
  }

  syncAdrDecision(input: {
    adr_id: string;
    status: string;
    actor_id: string;
    project_id: string;
  }): void {
    const missions = this.store.activeMissions(input.project_id);
    const mission = missions[0];
    if (!mission) {
      return;
    }
    const reviews = this.store
      .listReviews(mission.id)
      .filter(
        (r) =>
          r.review_type === 'ARCHITECTURE' &&
          (r.status === 'PENDING' || r.status === 'IN_REVIEW') &&
          (r.adr_refs.includes(input.adr_id) || r.adr_refs.length === 0),
      );
    const decision: HumanReviewDecision = input.status === 'rejected' ? 'REJECT' : 'APPROVE';
    for (const r of reviews) {
      this.decide(r.id, decision, { id: input.actor_id, roles: ['architecture'] }, `ADR ${input.status}`);
    }
  }

  private supersede(existing: HumanReview, fingerprint: string): void {
    try {
      assertReviewTransition(existing.status, 'SUPERSEDED');
    } catch {
      return;
    }
    const next = this.patchReview(existing, { status: 'SUPERSEDED' });
    this.appendEvent(next, 'REVIEW_SUPERSEDED', 'system', [], undefined, 'mission fingerprint changed');
    this.metrics.recordReviewStale();
    this.enqueue({
      event_type: 'REVIEW_SUPERSEDED',
      project_id: this.store.getMission(next.mission_id)?.project_id ?? '',
      mission_id: next.mission_id,
      payload: { review_id: next.id, fingerprint },
    });
  }

  private requireReview(id: string): HumanReview {
    const r = this.store.getReview(id);
    if (!r) {
      throw new Error('not_found');
    }
    return r;
  }

  private patchReview(review: HumanReview, patch: Partial<HumanReview>): HumanReview {
    const next: HumanReview = {
      ...review,
      ...patch,
      id: review.id,
      version: review.version + 1,
      updated_at: nowIso(),
    };
    this.store.upsertReview(next);
    return next;
  }

  private appendEvent(
    review: HumanReview,
    event_type: string,
    actor_id: string,
    actor_roles: string[],
    decision?: HumanReviewDecision,
    reason?: string,
  ): void {
    const ev: HumanReviewEvent = {
      id: newId('REVE'),
      review_id: review.id,
      mission_id: review.mission_id,
      event_type,
      actor_id,
      actor_roles,
      decision,
      reason,
      evidence_package_id: review.evidence_package_id,
      policy_id: review.policy_id,
      mission_version: review.mission_version,
      fingerprint: review.fingerprint,
      created_at: nowIso(),
    };
    this.store.insertReviewEvent(ev);
  }

  private insertHumanEvidence(review: HumanReview, mission: Mission | undefined): void {
    if (!mission) {
      return;
    }
    const reqs = this.store.listRequirements(mission.id);
    const req = reqs[0];
    const evidence: Evidence = {
      id: newId('EVID'),
      mission_id: mission.id,
      verification_id: review.id,
      requirement_id: req?.id ?? mission.id,
      criterion_id: review.id,
      type: 'human',
      source: `human_review:${review.id}`,
      result:
        review.decision === 'APPROVE' ? 'PASS' : review.decision === 'REJECT' ? 'FAIL' : 'UNKNOWN',
      duration_ms: 0,
      requirement_version_hash: req?.requirement_version_hash ?? 'human',
      code_revision: mission.code_revision ?? 'unknown',
      environment: 'governance',
      timestamp: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
      version: 1,
      stdout: review.decision_reason,
    };
    this.store.insertEvidence(evidence);
  }
}
