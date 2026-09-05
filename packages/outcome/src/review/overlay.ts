import type {
  ExecutionGate,
  HumanReview,
  LifecycleStage,
  OutcomeStatus,
} from '../domain/types.js';

export interface OverlayResult {
  status: OutcomeStatus;
  lifecycle?: LifecycleStage;
  execution_gate: ExecutionGate;
  blocking_review_ids: string[];
}

function isOpenBlocking(r: HumanReview, fingerprint: string): boolean {
  if (!r.blocking || !r.required) {
    return false;
  }
  if (r.status === 'SUPERSEDED' || r.status === 'EXPIRED' || r.status === 'NOT_REQUIRED') {
    return false;
  }
  if (r.status === 'APPROVED' && r.fingerprint !== fingerprint) {
    return true;
  }
  return (
    r.status === 'PENDING' ||
    r.status === 'IN_REVIEW' ||
    r.status === 'CHANGES_REQUESTED' ||
    (r.status === 'APPROVED' && r.fingerprint !== fingerprint)
  );
}

export function applyReviewOverlay(
  requirementStatus: OutcomeStatus,
  reviews: HumanReview[],
  currentFingerprint: string,
): OverlayResult {
  const relevant = reviews.filter((r) => r.required);
  const blockingOpen = relevant.filter((r) => isOpenBlocking(r, currentFingerprint));
  const blockingRejected = relevant.filter((r) => r.blocking && r.status === 'REJECTED');
  const executionBlocked = relevant.some(
    (r) =>
      r.blocking &&
      r.blocks_execution &&
      (r.status === 'PENDING' || r.status === 'IN_REVIEW'),
  );

  const blocking_review_ids = [
    ...blockingOpen.map((r) => r.id),
    ...blockingRejected.map((r) => r.id),
  ];
  const execution_gate: OverlayResult['execution_gate'] = executionBlocked
    ? 'HUMAN_GATE_BLOCKED'
    : 'OPEN';

  if (blockingRejected.length) {
    return {
      status: 'REVIEW_REJECTED',
      lifecycle: 'REMEDIATION',
      execution_gate,
      blocking_review_ids,
    };
  }

  const changes = relevant.filter((r) => r.blocking && r.status === 'CHANGES_REQUESTED');
  if (changes.length) {
    return {
      status:
        requirementStatus === 'ACHIEVED' ? 'AWAITING_HUMAN_REVIEW' : requirementStatus,
      lifecycle: 'CHANGES_REQUESTED',
      execution_gate,
      blocking_review_ids,
    };
  }

  if (blockingOpen.length) {
    return {
      status:
        requirementStatus === 'ACHIEVED' ? 'AWAITING_HUMAN_REVIEW' : requirementStatus,
      lifecycle: 'AWAITING_HUMAN_REVIEW',
      execution_gate,
      blocking_review_ids,
    };
  }

  if (requirementStatus === 'ACHIEVED') {
    const blockingApproved = relevant.filter(
      (r) => r.blocking && r.status === 'APPROVED' && r.fingerprint === currentFingerprint,
    );
    const blockingRequired = relevant.filter((r) => r.blocking);
    if (blockingRequired.length && blockingApproved.length === blockingRequired.length) {
      return {
        status: 'ACHIEVED',
        lifecycle: 'ACHIEVED',
        execution_gate: 'OPEN',
        blocking_review_ids: [],
      };
    }
    return {
      status: 'ACHIEVED',
      lifecycle: 'ACHIEVED',
      execution_gate: 'OPEN',
      blocking_review_ids: [],
    };
  }

  return {
    status: requirementStatus,
    execution_gate,
    blocking_review_ids,
  };
}
