import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outcomeFromRequirements } from '../domain/aggregator.js';
import { judgeRequirement } from '../domain/judge.js';
import type {
  Evidence,
  Mission,
  OutcomeRequirement,
  RequirementStatus,
  VerificationPlan,
  VerificationRun,
} from '../domain/types.js';
import { OutcomeCompiler } from '../compiler/outcome-compiler.js';
import type { RequirementExtractor } from '../extraction/requirement-extractor.js';
import { newId, nowIso } from '../ids.js';
import { bumpMission, createMissionRecord, draftsToRequirements } from '../mission/controller.js';
import type { OutcomeMetricsCollector } from '../metrics.js';
import type { OutcomeFlags } from '../flags.js';
import type { OutcomeStore } from '../persistence/store.js';
import { VerificationPlanner } from '../planning/verification-planner.js';
import { buildRemediation } from '../remediation/planner.js';
import type { CommandExecutor } from '../verification/adapter.js';
import { resultToEvidence } from '../verification/runner.js';
import { sanitizeEvidenceText } from '../evidence/sanitize.js';
import type { VerificationScheduler } from '../verification/scheduler.js';
import type { OutcomeEvent } from '../events/types.js';
import type { MemorySink } from './memorySink.js';
import { ReviewEngine } from '../review/engine.js';
import type { ArchitectureReviewPort } from '../review/port.js';

export type EnqueueFn = (
  event: Omit<OutcomeEvent, 'event_id' | 'timestamp' | 'event_version'> & Partial<OutcomeEvent>,
) => void;

function gitSha(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

export class OutcomePipeline {
  readonly reviews: ReviewEngine;

  constructor(
    private readonly store: OutcomeStore,
    private readonly flags: OutcomeFlags,
    private readonly metrics: OutcomeMetricsCollector,
    private readonly enqueue: EnqueueFn,
    private readonly workspaceRoot: string,
    private readonly extractor: RequirementExtractor,
    private readonly compiler: OutcomeCompiler,
    private readonly planner: VerificationPlanner,
    private readonly scheduler: VerificationScheduler,
    private readonly executor: CommandExecutor,
    private readonly memorySink?: MemorySink,
    private readonly cacheDir?: string,
    architecturePort?: ArchitectureReviewPort,
  ) {
    this.reviews = new ReviewEngine(store, metrics, enqueue, architecturePort);
  }

  async handle(event: OutcomeEvent): Promise<void> {
    try {
      switch (event.event_type) {
        case 'USER_INTENT_CAPTURED':
        case 'mission.created':
          await this.onIntent(event);
          break;
        case 'mission.execution.updated':
        case 'CODE_CHANGE_COMPLETED':
        case 'FILE_MODIFIED':
        case 'FILE_CREATED':
        case 'FILE_DELETED':
          this.onCodeChange(event);
          break;
        case 'READY_FOR_VERIFICATION':
          await this.onReady(event);
          break;
        case 'verification.requested':
          await this.onVerifyRequested(event);
          break;
        case 'REVIEW_EVALUATE_REQUESTED':
        case 'REVIEW_REQUIRED':
        case 'REVIEW_STARTED':
        case 'REVIEW_APPROVED':
        case 'REVIEW_REJECTED':
        case 'REVIEW_CHANGES_REQUESTED':
        case 'REVIEW_SUPERSEDED':
        case 'REVIEW_EXPIRED':
          this.onReviewEvent(event);
          break;
        default:
          break;
      }
    } catch {
      /* intelligence plane isolation */
    }
  }

  private async onIntent(event: OutcomeEvent): Promise<void> {
    if (!this.flags.outcome_extraction_enabled) {
      return;
    }
    const text =
      (typeof event.payload?.text === 'string' && event.payload.text) ||
      (typeof event.payload?.request_text === 'string' && event.payload.request_text) ||
      '';
    if (!text.trim()) {
      return;
    }
    if (event.event_type === 'USER_INTENT_CAPTURED') {
      const active = this.store.activeMissions(event.project_id);
      const current = active[0];
      if (current && current.lifecycle !== 'CREATED') {
        return;
      }
    }
    let mission: Mission | undefined;
    if (event.mission_id) {
      mission = this.store.getMission(event.mission_id);
    }
    if (!mission) {
      mission = createMissionRecord({
        projectId: event.project_id,
        text,
        sessionId: event.session_id,
        codeRevision: event.commit_id ?? gitSha(this.workspaceRoot),
      });
      this.store.upsertMission(mission);
    }
    const drafts = await this.extractor.extract(text);
    const reqs = draftsToRequirements(mission, drafts);
    for (const r of reqs) {
      this.store.upsertRequirement(r);
    }
    mission = bumpMission(mission, { lifecycle: 'REQUIREMENTS_EXTRACTED' });
    this.store.upsertMission(mission);
    this.enqueue({
      event_type: 'requirements.extracted',
      project_id: event.project_id,
      mission_id: mission.id,
      payload: { count: reqs.length },
    });

    for (const r of reqs) {
      const compiled = this.compiler.compile(r);
      for (const ac of compiled.acceptanceCriteria) {
        this.store.upsertCriterion(ac);
        const plan = this.planner.plan(ac);
        this.store.upsertPlan(plan);
      }
    }
    mission = bumpMission(mission, {
      lifecycle: 'VERIFICATION_PLANNED',
      status: 'IN_PROGRESS',
    });
    this.store.upsertMission(mission);
    this.enqueue({
      event_type: 'outcome.compiled',
      project_id: event.project_id,
      mission_id: mission.id,
    });
    this.enqueue({
      event_type: 'verification.planned',
      project_id: event.project_id,
      mission_id: mission.id,
    });
    this.writeCache(mission);
  }

  private onCodeChange(event: OutcomeEvent): void {
    const missions = event.mission_id
      ? [this.store.getMission(event.mission_id)].filter((m): m is Mission => !!m)
      : this.store.activeMissions(event.project_id);
    const revision = event.commit_id ?? gitSha(this.workspaceRoot);
    for (const mission of missions) {
      const reqs = this.store.listRequirements(mission.id);
      for (const r of reqs) {
        if (r.status === 'PASS' || r.status === 'FAIL' || r.status === 'UNKNOWN') {
          this.store.upsertRequirement({
            ...r,
            status: 'STALE',
            updated_at: nowIso(),
            version: r.version + 1,
          });
        }
      }
      this.store.upsertMission(
        bumpMission(mission, {
          lifecycle: 'IMPLEMENTATION_IN_PROGRESS',
          code_revision: revision,
          status: 'IN_PROGRESS',
        }),
      );
      this.rollupMission(mission.id);
    }
  }

  private async onReady(event: OutcomeEvent): Promise<void> {
    const missionId = event.mission_id ?? String(event.payload?.missionId ?? '');
    const mission =
      this.store.getMission(missionId) ?? this.store.activeMissions(event.project_id)[0];
    if (!mission) {
      return;
    }
    this.store.upsertMission(
      bumpMission(mission, { lifecycle: 'READY_FOR_VERIFICATION', status: 'VERIFYING' }),
    );
    // Runtime's hot-path pre-verifier may have attached structured
    // observations. Persist them as Evidence so the Outcome store remains the
    // single verification authority (runtime itself never writes here).
    this.ingestRuntimeVerifyEvidence(mission.id, event);
    const reqs = this.store.listRequirements(mission.id);
    for (const r of reqs) {
      await this.queueRequirement(r, event);
    }
  }

  /**
   * Persist runtime hot-path verification observations as insert-only Evidence.
   * Best-effort and idempotent per (mission, revision): a duplicate checkpoint
   * for an already-recorded revision is skipped rather than double-recorded.
   */
  private ingestRuntimeVerifyEvidence(missionId: string, event: OutcomeEvent): void {
    try {
      const raw = event.payload?.['verification_evidence'];
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const ev = raw as {
        toolChecks?: unknown;
        requirementChecks?: unknown;
      };
      const revision = event.commit_id ?? gitSha(this.workspaceRoot);
      const marker = `runtime-hotpath:${missionId}:${revision}`;
      for (const prior of this.store.listEvidenceForMission(missionId)) {
        if (prior.source === marker) {
          return;
        }
      }
      const now = nowIso();
      const base = {
        mission_id: missionId,
        verification_id: newId('VER'),
        requirement_id: '',
        criterion_id: '',
        requirement_version_hash: 'runtime-hotpath',
        code_revision: revision,
        environment: 'test',
        timestamp: now,
        created_at: now,
        updated_at: now,
        version: 1 as const,
      };
      const rows: Evidence[] = [];
      const toolChecks = Array.isArray(ev.toolChecks) ? ev.toolChecks : [];
      for (const [i, c] of toolChecks.entries()) {
        if (!c || typeof c !== 'object') {
          continue;
        }
        const chk = c as { name?: unknown; ok?: unknown; summary?: unknown };
        rows.push({
          ...base,
          id: newId('EVID'),
          verification_id: `${base.verification_id}-${i}`,
          type: 'static_analysis',
          source: marker,
          result: chk.ok === true ? 'PASS' : chk.ok === false ? 'FAIL' : 'UNKNOWN',
          duration_ms: 0,
          stdout:
            typeof chk.summary === 'string'
              ? sanitizeEvidenceText(chk.summary.slice(0, 16_000))
              : undefined,
          artifact: typeof chk.name === 'string' ? chk.name : undefined,
        });
      }
      const reqChecks = Array.isArray(ev.requirementChecks) ? ev.requirementChecks : [];
      for (const [i, c] of reqChecks.entries()) {
        if (!c || typeof c !== 'object') {
          continue;
        }
        const chk = c as {
          text?: unknown;
          status?: unknown;
          evidence?: unknown;
          id?: unknown;
        };
        rows.push({
          ...base,
          id: newId('EVID'),
          verification_id: `${base.verification_id}-req-${i}`,
          type: 'runtime',
          source: marker,
          result:
            chk.status === 'pass'
              ? 'PASS'
              : chk.status === 'fail'
                ? 'FAIL'
                : 'UNKNOWN',
          duration_ms: 0,
          stdout:
            typeof chk.text === 'string'
              ? sanitizeEvidenceText(chk.text.slice(0, 16_000))
              : undefined,
          stderr:
            typeof chk.evidence === 'string'
              ? sanitizeEvidenceText(chk.evidence.slice(0, 16_000))
              : undefined,
          artifact: typeof chk.id === 'string' ? chk.id : undefined,
        });
      }
      for (const row of rows) {
        this.store.insertEvidence(row);
      }
    } catch {
      // Evidence ingestion is best-effort; never break the verify pipeline.
    }
  }

  async queueRequirement(req: OutcomeRequirement, event?: OutcomeEvent): Promise<string[]> {
    const plans = this.store.listPlansForRequirement(req.id);
    const runIds: string[] = [];
    const revision = event?.commit_id ?? gitSha(this.workspaceRoot);
    for (const plan of plans) {
      const key = [plan.id, req.mission_id, revision, req.requirement_version_hash].join(':');
      const existing = this.store.findRunByIdempotency(key);
      if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) {
        runIds.push(existing.id);
        continue;
      }
      const now = nowIso();
      const run: VerificationRun = {
        id: newId('VER'),
        mission_id: req.mission_id,
        plan_id: plan.id,
        requirement_id: req.id,
        criterion_id: plan.criterion_id,
        status: 'QUEUED',
        code_revision: revision,
        requirement_version_hash: req.requirement_version_hash,
        idempotency_key: key,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      this.store.insertRun(run);
      runIds.push(run.id);
      this.enqueue({
        event_type: 'verification.requested',
        project_id: event?.project_id ?? 'default',
        mission_id: req.mission_id,
        payload: { runId: run.id, planId: plan.id, requirementId: req.id, idempotencyKey: key },
      });
    }
    return runIds;
  }

  private async onVerifyRequested(event: OutcomeEvent): Promise<void> {
    if (!this.flags.outcome_verification_enabled) {
      return;
    }
    if (event.event_id && !this.store.tryClaimIdempotency(`evt:${event.event_id}`)) {
      return;
    }
    const runId = String(event.payload?.runId ?? '');
    const run = this.store.getRun(runId);
    if (!run) {
      return;
    }
    if (run.status === 'RUNNING' || run.status === 'COMPLETED') {
      return;
    }
    const plan = this.store.getPlan(run.plan_id);
    const req = this.store.getRequirement(run.requirement_id);
    if (!plan || !req) {
      return;
    }
    const key = run.idempotency_key;
    if (this.scheduler.isInflight(key)) {
      return;
    }
    run.status = 'RUNNING';
    run.updated_at = nowIso();
    this.store.updateRun(run);
    const mission = this.store.getMission(run.mission_id);
    if (mission) {
      this.store.upsertMission(bumpMission(mission, { lifecycle: 'VERIFYING', status: 'VERIFYING' }));
    }
    const t0 = Date.now();
    const result = await this.scheduler.enqueue(key, plan, {
      workspaceRoot: this.workspaceRoot,
      missionId: run.mission_id,
      codeRevision: run.code_revision ?? 'unknown',
      requirementVersionHash: req.requirement_version_hash,
      executor: this.executor,
    });
    const evidence = resultToEvidence(result, {
      missionId: run.mission_id,
      runId: run.id,
      requirementId: req.id,
      criterionId: plan.criterion_id,
      requirementVersionHash: req.requirement_version_hash,
      codeRevision: run.code_revision ?? 'unknown',
      type:
        plan.type === 'COMPILER' ? 'compiler' : plan.type === 'TEST' ? 'test' : 'command',
    });
    this.store.insertEvidence(evidence);
    run.status = 'COMPLETED';
    run.result = result.result;
    run.updated_at = nowIso();
    run.version += 1;
    this.store.updateRun(run);
    this.metrics.recordVerification({
      duration_ms: Date.now() - t0,
      result: result.result === 'PASS' || result.result === 'FAIL' ? result.result : 'UNKNOWN',
      timedOut: result.timedOut,
    });
    this.applyJudgement(req, plan, evidence);
  }

  private applyJudgement(
    req: OutcomeRequirement,
    plan: VerificationPlan,
    evidence: Evidence,
  ): void {
    const ac = this.store.getCriterion(plan.criterion_id);
    if (ac) {
      this.store.upsertCriterion({
        ...ac,
        status: evidence.result,
        updated_at: nowIso(),
        version: ac.version + 1,
      });
    }
    const criteria = this.store.listCriteria(req.id);
    const status = judgeRequirement(criteria);
    this.store.upsertRequirement({
      ...req,
      status,
      updated_at: nowIso(),
      version: req.version + 1,
    });
    this.metrics.recordRequirement(
      status === 'PASS' || status === 'FAIL' ? status : 'UNKNOWN',
    );
    const eventType =
      status === 'PASS'
        ? 'requirement.passed'
        : status === 'FAIL'
          ? 'requirement.failed'
          : 'requirement.unknown';
    this.enqueue({
      event_type: eventType,
      project_id: this.workspaceRoot,
      mission_id: req.mission_id,
      payload: { requirementId: req.id, status },
    });

    if (status === 'FAIL' && this.flags.outcome_remediation_enabled) {
      const evid = this.store.listEvidenceForRequirement(req.id);
      const rem = buildRemediation({ ...req, status }, evid);
      this.store.insertRemediation(rem);
      this.enqueue({
        event_type: 'remediation.requested',
        project_id: this.workspaceRoot,
        mission_id: req.mission_id,
        payload: {
          requirementId: req.id,
          remediationId: rem.id,
          planner_prompt: rem.planner_prompt,
        },
      });
      const mission = this.store.getMission(req.mission_id);
      if (mission) {
        this.store.upsertMission(bumpMission(mission, { lifecycle: 'REMEDIATION' }));
      }
    }

    this.rollupMission(req.mission_id);
  }

  private onReviewEvent(event: OutcomeEvent): void {
    const key = `evt:${event.event_id}`;
    if (!this.store.tryClaimIdempotency(key)) {
      return;
    }
    const missionId =
      event.mission_id ??
      String(event.payload?.mission_id ?? event.payload?.missionId ?? '');
    if (event.event_type === 'REVIEW_EVALUATE_REQUESTED') {
      const mission =
        this.store.getMission(missionId) ?? this.store.activeMissions(event.project_id)[0];
      if (mission && this.flags.human_review_enabled) {
        this.reviews.ensureReviews(mission);
        this.rollupMission(mission.id);
      }
      const adrStatus = event.payload?.adr_status;
      const adrId = event.payload?.adr_id;
      if (typeof adrId === 'string' && typeof adrStatus === 'string') {
        this.reviews.syncAdrDecision({
          adr_id: adrId,
          status: adrStatus,
          actor_id: String(event.payload?.actor_id ?? 'user'),
          project_id: event.project_id,
        });
        const m =
          this.store.getMission(missionId) ?? this.store.activeMissions(event.project_id)[0];
        if (m) {
          this.rollupMission(m.id);
        }
      }
      return;
    }
    if (missionId) {
      this.rollupMission(missionId);
    }
  }

  rollupMission(missionId: string): void {
    const mission = this.store.getMission(missionId);
    if (!mission) {
      return;
    }
    const reqs = this.store.listRequirements(missionId);
    let outcome = outcomeFromRequirements(missionId, reqs, this.store.getOutcome(missionId));
    let lifecycle = mission.lifecycle;
    let status = outcome.status;
    let execution_gate: 'OPEN' | 'HUMAN_GATE_BLOCKED' = 'OPEN';
    if (this.flags.human_review_enabled) {
      this.reviews.ensureReviews(mission);
      const overlay = this.reviews.overlay(outcome.status, mission);
      status = overlay.status;
      if (overlay.lifecycle) {
        lifecycle = overlay.lifecycle;
      }
      execution_gate = overlay.execution_gate;
      outcome = { ...outcome, status, updated_at: nowIso(), version: outcome.version };
    } else if (outcome.status === 'ACHIEVED') {
      lifecycle = 'ACHIEVED';
    }
    this.store.upsertOutcome(outcome);
    this.store.upsertMission(bumpMission(mission, { status, lifecycle }));
    this.metrics.recordMissionOutcome(outcome.status === 'ACHIEVED');
    this.metrics.setAwaitingHumanReview(this.store.listOpenReviews().filter((r) => r.blocking).length);
    this.writeCache(this.store.getMission(missionId)!, execution_gate);
    try {
      this.memorySink?.remember({
        project_id: mission.project_id,
        type: 'LESSON_LEARNED',
        title: `Mission ${mission.id} ${outcome.status}`,
        content: `score=${outcome.score} pass=${outcome.pass_count} fail=${outcome.fail_count} unknown=${outcome.unknown_count}`,
        source_id: mission.id,
      });
    } catch {
      /* memory optional */
    }
    const ev =
      outcome.status === 'ACHIEVED'
        ? 'outcome.achieved'
        : outcome.status === 'BLOCKED'
          ? 'outcome.blocked'
          : 'outcome.not_achieved';
    this.enqueue({
      event_type: ev,
      project_id: mission.project_id,
      mission_id: mission.id,
      payload: { status: outcome.status, score: outcome.score, execution_gate },
    });
  }

  private writeCache(mission: Mission, execution_gate: 'OPEN' | 'HUMAN_GATE_BLOCKED' = 'OPEN'): void {
    if (!this.cacheDir) {
      return;
    }
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      const outcome = this.store.getOutcome(mission.id);
      const reqs = this.store.listRequirements(mission.id);
      const reviews = this.store.listReviews(mission.id);
      writeFileSync(
        join(this.cacheDir, 'latest.json'),
        JSON.stringify({
          mission_id: mission.id,
          status: outcome?.status ?? mission.status,
          score: outcome?.score ?? 0,
          review_status: reviews[0]?.status,
          execution_gate,
          requirements: reqs.map((r) => ({ id: r.id, status: r.status, description: r.description })),
        }),
      );
    } catch {
      /* cache optional */
    }
  }
}

export type { RequirementStatus };
