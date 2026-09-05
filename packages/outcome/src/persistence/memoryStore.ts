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
import type { OutcomeStore } from './store.js';

export class MemoryOutcomeStore implements OutcomeStore {
  private missions = new Map<string, Mission>();
  private objectives: Objective[] = [];
  private requirements = new Map<string, OutcomeRequirement>();
  private criteria = new Map<string, AcceptanceCriterion>();
  private plans = new Map<string, VerificationPlan>();
  private runs = new Map<string, VerificationRun>();
  private evidence: Evidence[] = [];
  private outcomes = new Map<string, MissionOutcome>();
  private remediations: Remediation[] = [];
  private processed = new Set<string>();
  private reviews = new Map<string, HumanReview>();
  private reviewEvents: HumanReviewEvent[] = [];
  private packages = new Map<string, ReviewEvidencePackage>();
  private policies = new Map<string, ReviewPolicyRule>();

  upsertMission(m: Mission): void {
    this.missions.set(m.id, m);
  }
  getMission(id: string): Mission | undefined {
    return this.missions.get(id);
  }
  listMissions(projectId: string): Mission[] {
    return [...this.missions.values()].filter((m) => m.project_id === projectId);
  }
  activeMissions(projectId: string): Mission[] {
    return this.listMissions(projectId).filter(
      (m) => m.status !== 'ACHIEVED' && m.lifecycle !== 'ACHIEVED',
    );
  }

  upsertObjective(o: Objective): void {
    this.objectives = this.objectives.filter((x) => x.id !== o.id);
    this.objectives.push(o);
  }
  listObjectives(missionId: string): Objective[] {
    return this.objectives.filter((o) => o.mission_id === missionId);
  }

  upsertRequirement(r: OutcomeRequirement): void {
    this.requirements.set(r.id, r);
  }
  getRequirement(id: string): OutcomeRequirement | undefined {
    return this.requirements.get(id);
  }
  listRequirements(missionId: string): OutcomeRequirement[] {
    return [...this.requirements.values()].filter((r) => r.mission_id === missionId);
  }

  upsertCriterion(c: AcceptanceCriterion): void {
    this.criteria.set(c.id, c);
  }
  getCriterion(id: string): AcceptanceCriterion | undefined {
    return this.criteria.get(id);
  }
  listCriteria(requirementId: string): AcceptanceCriterion[] {
    return [...this.criteria.values()].filter((c) => c.requirement_id === requirementId);
  }

  upsertPlan(p: VerificationPlan): void {
    this.plans.set(p.id, p);
  }
  getPlan(id: string): VerificationPlan | undefined {
    return this.plans.get(id);
  }
  listPlansForRequirement(requirementId: string): VerificationPlan[] {
    return [...this.plans.values()].filter((p) => p.requirement_id === requirementId);
  }
  listPlansForMission(missionId: string): VerificationPlan[] {
    return [...this.plans.values()].filter((p) => p.mission_id === missionId);
  }

  insertRun(r: VerificationRun): void {
    this.runs.set(r.id, r);
  }
  updateRun(r: VerificationRun): void {
    this.runs.set(r.id, r);
  }
  getRun(id: string): VerificationRun | undefined {
    return this.runs.get(id);
  }
  findRunByIdempotency(key: string): VerificationRun | undefined {
    const matches = [...this.runs.values()].filter((r) => r.idempotency_key === key);
    return (
      matches.find((r) => r.status === 'QUEUED' || r.status === 'RUNNING') ??
      matches[matches.length - 1]
    );
  }

  insertEvidence(e: Evidence): void {
    this.evidence.push(e);
  }
  listEvidenceForRequirement(requirementId: string): Evidence[] {
    return this.evidence.filter((e) => e.requirement_id === requirementId);
  }
  listEvidenceForRun(runId: string): Evidence[] {
    return this.evidence.filter((e) => e.verification_id === runId);
  }
  listEvidenceForMission(missionId: string): Evidence[] {
    return this.evidence.filter((e) => e.mission_id === missionId);
  }

  upsertReview(r: HumanReview): void {
    this.reviews.set(r.id, r);
  }
  getReview(id: string): HumanReview | undefined {
    return this.reviews.get(id);
  }
  listReviews(missionId: string): HumanReview[] {
    return [...this.reviews.values()].filter((r) => r.mission_id === missionId);
  }
  listOpenReviews(): HumanReview[] {
    return [...this.reviews.values()].filter(
      (r) => r.status === 'PENDING' || r.status === 'IN_REVIEW' || r.status === 'CHANGES_REQUESTED',
    );
  }

  insertReviewEvent(e: HumanReviewEvent): void {
    this.reviewEvents.push(e);
  }
  listReviewEvents(reviewId: string): HumanReviewEvent[] {
    return this.reviewEvents.filter((e) => e.review_id === reviewId);
  }

  insertEvidencePackage(p: ReviewEvidencePackage): void {
    this.packages.set(p.id, p);
  }
  getEvidencePackage(id: string): ReviewEvidencePackage | undefined {
    return this.packages.get(id);
  }

  upsertReviewPolicy(p: ReviewPolicyRule): void {
    this.policies.set(p.id, p);
  }
  listReviewPolicies(): ReviewPolicyRule[] {
    return [...this.policies.values()];
  }

  upsertOutcome(o: MissionOutcome): void {
    this.outcomes.set(o.mission_id, o);
  }
  getOutcome(missionId: string): MissionOutcome | undefined {
    return this.outcomes.get(missionId);
  }

  insertRemediation(r: Remediation): void {
    this.remediations.push(r);
  }
  listRemediations(missionId: string): Remediation[] {
    return this.remediations.filter((r) => r.mission_id === missionId);
  }

  tryClaimIdempotency(key: string): boolean {
    if (this.processed.has(key)) {
      return false;
    }
    this.processed.add(key);
    return true;
  }
  isProcessed(key: string): boolean {
    return this.processed.has(key);
  }

  close(): void {
    /* noop */
  }
}

export function createMemoryStore(): MemoryOutcomeStore {
  return new MemoryOutcomeStore();
}
