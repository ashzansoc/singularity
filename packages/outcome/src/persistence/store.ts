import type {
  AcceptanceCriterion,
  Evidence,
  HumanReview,
  HumanReviewEvent,
  Mission,
  MissionOutcome,
  Objective,
  OutcomeRequirement,
  Remediation,
  ReviewEvidencePackage,
  ReviewPolicyRule,
  VerificationPlan,
  VerificationRun,
} from '../domain/types.js';

export interface OutcomeStore {
  upsertMission(m: Mission): void;
  getMission(id: string): Mission | undefined;
  listMissions(projectId: string): Mission[];
  activeMissions(projectId: string): Mission[];

  upsertObjective(o: Objective): void;
  listObjectives(missionId: string): Objective[];

  upsertRequirement(r: OutcomeRequirement): void;
  getRequirement(id: string): OutcomeRequirement | undefined;
  listRequirements(missionId: string): OutcomeRequirement[];

  upsertCriterion(c: AcceptanceCriterion): void;
  getCriterion(id: string): AcceptanceCriterion | undefined;
  listCriteria(requirementId: string): AcceptanceCriterion[];

  upsertPlan(p: VerificationPlan): void;
  getPlan(id: string): VerificationPlan | undefined;
  listPlansForRequirement(requirementId: string): VerificationPlan[];
  listPlansForMission(missionId: string): VerificationPlan[];

  insertRun(r: VerificationRun): void;
  updateRun(r: VerificationRun): void;
  getRun(id: string): VerificationRun | undefined;
  findRunByIdempotency(key: string): VerificationRun | undefined;

  insertEvidence(e: Evidence): void;
  listEvidenceForRequirement(requirementId: string): Evidence[];
  listEvidenceForRun(runId: string): Evidence[];
  listEvidenceForMission(missionId: string): Evidence[];

  upsertReview(r: HumanReview): void;
  getReview(id: string): HumanReview | undefined;
  listReviews(missionId: string): HumanReview[];
  listOpenReviews(): HumanReview[];

  insertReviewEvent(e: HumanReviewEvent): void;
  listReviewEvents(reviewId: string): HumanReviewEvent[];

  insertEvidencePackage(p: ReviewEvidencePackage): void;
  getEvidencePackage(id: string): ReviewEvidencePackage | undefined;

  upsertReviewPolicy(p: ReviewPolicyRule): void;
  listReviewPolicies(): ReviewPolicyRule[];

  upsertOutcome(o: MissionOutcome): void;
  getOutcome(missionId: string): MissionOutcome | undefined;

  insertRemediation(r: Remediation): void;
  listRemediations(missionId: string): Remediation[];

  /** Returns true if this key was newly claimed (not a duplicate). */
  tryClaimIdempotency(key: string): boolean;
  isProcessed(key: string): boolean;

  close(): void;
}
