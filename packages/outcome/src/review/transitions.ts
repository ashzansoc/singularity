import type { HumanReviewStatus } from '../domain/types.js';

const ALLOWED: Record<HumanReviewStatus, HumanReviewStatus[]> = {
  NOT_REQUIRED: [],
  PENDING: ['IN_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED', 'SUPERSEDED'],
  IN_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED', 'SUPERSEDED', 'PENDING'],
  APPROVED: ['SUPERSEDED', 'EXPIRED'],
  REJECTED: ['SUPERSEDED'],
  CHANGES_REQUESTED: ['SUPERSEDED', 'EXPIRED', 'PENDING'],
  EXPIRED: [],
  SUPERSEDED: [],
};

export function canTransitionReview(from: HumanReviewStatus, to: HumanReviewStatus): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED[from].includes(to);
}

export function assertReviewTransition(from: HumanReviewStatus, to: HumanReviewStatus): void {
  if (!canTransitionReview(from, to)) {
    throw new Error(`Illegal review transition ${from} → ${to}`);
  }
}
