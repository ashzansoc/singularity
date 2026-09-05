export interface OutcomeMetrics {
  verification_queue_depth: number;
  verification_duration_ms_total: number;
  verification_count: number;
  verification_success_count: number;
  verification_failure_count: number;
  verification_unknown_count: number;
  verification_timeout_count: number;
  requirements_passed: number;
  requirements_failed: number;
  requirements_unknown: number;
  mission_outcome_achieved: number;
  mission_outcome_not_achieved: number;
  events_dropped: number;
  events_retried: number;
  coding_request_latency_with_outcome_ms_total: number;
  coding_request_latency_without_outcome_ms_total: number;
  coding_request_count_with_outcome: number;
  coding_request_count_without_outcome: number;
  human_review_requests_total: number;
  human_review_pending: number;
  human_review_approval_rate: number;
  human_review_rejection_rate: number;
  human_review_changes_requested: number;
  human_review_duration_ms_total: number;
  human_review_stale_total: number;
  human_review_policy_evaluations: number;
  human_review_event_failures: number;
  mission_awaiting_human_review: number;
  human_review_approved_total: number;
  human_review_rejected_total: number;
}

export function createEmptyOutcomeMetrics(): OutcomeMetrics {
  return {
    verification_queue_depth: 0,
    verification_duration_ms_total: 0,
    verification_count: 0,
    verification_success_count: 0,
    verification_failure_count: 0,
    verification_unknown_count: 0,
    verification_timeout_count: 0,
    requirements_passed: 0,
    requirements_failed: 0,
    requirements_unknown: 0,
    mission_outcome_achieved: 0,
    mission_outcome_not_achieved: 0,
    events_dropped: 0,
    events_retried: 0,
    coding_request_latency_with_outcome_ms_total: 0,
    coding_request_latency_without_outcome_ms_total: 0,
    coding_request_count_with_outcome: 0,
    coding_request_count_without_outcome: 0,
    human_review_requests_total: 0,
    human_review_pending: 0,
    human_review_approval_rate: 0,
    human_review_rejection_rate: 0,
    human_review_changes_requested: 0,
    human_review_duration_ms_total: 0,
    human_review_stale_total: 0,
    human_review_policy_evaluations: 0,
    human_review_event_failures: 0,
    mission_awaiting_human_review: 0,
    human_review_approved_total: 0,
    human_review_rejected_total: 0,
  };
}

export class OutcomeMetricsCollector {
  readonly metrics: OutcomeMetrics = createEmptyOutcomeMetrics();

  setQueueDepth(n: number): void {
    this.metrics.verification_queue_depth = n;
  }

  recordDropped(): void {
    this.metrics.events_dropped += 1;
  }

  recordRetry(): void {
    this.metrics.events_retried += 1;
  }

  recordVerification(opts: {
    duration_ms: number;
    result: 'PASS' | 'FAIL' | 'UNKNOWN';
    timedOut?: boolean;
  }): void {
    this.metrics.verification_count += 1;
    this.metrics.verification_duration_ms_total += opts.duration_ms;
    if (opts.timedOut) {
      this.metrics.verification_timeout_count += 1;
    }
    if (opts.result === 'PASS') {
      this.metrics.verification_success_count += 1;
    } else if (opts.result === 'FAIL') {
      this.metrics.verification_failure_count += 1;
    } else {
      this.metrics.verification_unknown_count += 1;
    }
  }

  recordRequirement(status: 'PASS' | 'FAIL' | 'UNKNOWN'): void {
    if (status === 'PASS') {
      this.metrics.requirements_passed += 1;
    } else if (status === 'FAIL') {
      this.metrics.requirements_failed += 1;
    } else {
      this.metrics.requirements_unknown += 1;
    }
  }

  recordMissionOutcome(achieved: boolean): void {
    if (achieved) {
      this.metrics.mission_outcome_achieved += 1;
    } else {
      this.metrics.mission_outcome_not_achieved += 1;
    }
  }

  recordCodingLatency(opts: { withOutcome: boolean; latency_ms: number }): void {
    if (opts.withOutcome) {
      this.metrics.coding_request_count_with_outcome += 1;
      this.metrics.coding_request_latency_with_outcome_ms_total += opts.latency_ms;
    } else {
      this.metrics.coding_request_count_without_outcome += 1;
      this.metrics.coding_request_latency_without_outcome_ms_total += opts.latency_ms;
    }
  }

  recordPolicyEvaluation(): void {
    this.metrics.human_review_policy_evaluations += 1;
  }

  recordReviewRequest(): void {
    this.metrics.human_review_requests_total += 1;
    this.metrics.human_review_pending += 1;
  }

  recordReviewDecision(decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES', durationMs?: number): void {
    if (this.metrics.human_review_pending > 0) {
      this.metrics.human_review_pending -= 1;
    }
    if (durationMs !== undefined && Number.isFinite(durationMs)) {
      this.metrics.human_review_duration_ms_total += durationMs;
    }
    if (decision === 'APPROVE') {
      this.metrics.human_review_approved_total += 1;
    } else if (decision === 'REJECT') {
      this.metrics.human_review_rejected_total += 1;
    } else {
      this.metrics.human_review_changes_requested += 1;
    }
    const decided =
      this.metrics.human_review_approved_total + this.metrics.human_review_rejected_total;
    if (decided > 0) {
      this.metrics.human_review_approval_rate =
        this.metrics.human_review_approved_total / decided;
      this.metrics.human_review_rejection_rate =
        this.metrics.human_review_rejected_total / decided;
    }
  }

  recordReviewStale(): void {
    this.metrics.human_review_stale_total += 1;
  }

  recordReviewEventFailure(): void {
    this.metrics.human_review_event_failures += 1;
  }

  setAwaitingHumanReview(n: number): void {
    this.metrics.mission_awaiting_human_review = n;
  }

  snapshot(): OutcomeMetrics {
    return { ...this.metrics };
  }
}
