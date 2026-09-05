import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { isOutcomeEngineActive, readOutcomeFlags, type OutcomeFlags } from './flags.js';
import { OutcomeMetricsCollector } from './metrics.js';
import { LocalEventBuffer } from './events/localBuffer.js';
import { InMemoryEventBus } from './events/memoryBus.js';
import { OutboxPublisher } from './events/outboxPublisher.js';
import type { OutcomeEvent, EventBus } from './events/types.js';
import { OutcomeCompiler } from './compiler/outcome-compiler.js';
import {
  createRequirementExtractor,
  type RequirementExtractor,
} from './extraction/requirement-extractor.js';
import { VerificationPlanner } from './planning/verification-planner.js';
import { CommandVerifier } from './verification/adapters/command.js';
import { TestVerifier } from './verification/adapters/test.js';
import { CompilerVerifier } from './verification/adapters/compiler.js';
import type { CommandExecutor, VerificationAdapter } from './verification/adapter.js';
import { createDefaultExecutor } from './verification/exec.js';
import { VerificationRunner } from './verification/runner.js';
import { VerificationScheduler } from './verification/scheduler.js';
import { OutcomePipeline } from './workers/pipeline.js';
import type { MemorySink } from './workers/memorySink.js';
import { openOutcomeStore } from './persistence/sqlite.js';
import { MemoryOutcomeStore } from './persistence/memoryStore.js';
import type { OutcomeStore } from './persistence/store.js';
import { createMissionRecord } from './mission/controller.js';
import { nowIso } from './ids.js';
import type { ArchitectureReviewPort } from './review/port.js';
import type { HumanReviewDecision } from './domain/types.js';
import type { ReviewerIdentity } from './review/reviewerPolicy.js';

export interface OutcomeSubsystemOptions {
  workspaceRoot: string;
  projectId?: string;
  flags?: Partial<OutcomeFlags>;
  store?: OutcomeStore;
  extractor?: RequirementExtractor;
  executor?: CommandExecutor;
  adapters?: VerificationAdapter[];
  memorySink?: MemorySink;
  architecturePort?: ArchitectureReviewPort;
}

export class OutcomeSubsystem {
  readonly flags: OutcomeFlags;
  readonly metrics = new OutcomeMetricsCollector();
  readonly buffer: LocalEventBuffer;
  readonly store: OutcomeStore;
  readonly bus: EventBus;
  readonly publisher: OutboxPublisher;
  readonly pipeline: OutcomePipeline;
  readonly projectId: string;
  readonly workspaceRoot: string;
  private started = false;
  private readonly cacheDir: string;

  constructor(options: OutcomeSubsystemOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.projectId = options.projectId ?? 'default';
    this.flags = readOutcomeFlags(options.flags);
    this.cacheDir = join(options.workspaceRoot, '.singularity', 'outcome', 'cache');
    const wal = join(options.workspaceRoot, '.singularity', 'outcome', 'events.wal');
    this.buffer = new LocalEventBuffer({ walPath: wal, metrics: this.metrics });
    const dbPath = join(
      options.workspaceRoot,
      '.singularity',
      'outcome',
      'outcome.sqlite',
    );
    this.store = options.store ?? openOutcomeStore(dbPath);
    this.bus = new InMemoryEventBus();
    this.publisher = new OutboxPublisher(this.buffer, this.bus, this.metrics);
    const extractor = options.extractor ?? createRequirementExtractor();
    const compiler = new OutcomeCompiler();
    const planner = new VerificationPlanner(this.workspaceRoot);
    const adapters =
      options.adapters ?? [new CommandVerifier(), new TestVerifier(), new CompilerVerifier()];
    const runner = new VerificationRunner(adapters);
    const scheduler = new VerificationScheduler(
      this.flags.verify_concurrency,
      runner,
      this.metrics,
    );
    const executor = options.executor ?? createDefaultExecutor();
    this.pipeline = new OutcomePipeline(
      this.store,
      this.flags,
      this.metrics,
      (e) => this.emit(e),
      this.workspaceRoot,
      extractor,
      compiler,
      planner,
      scheduler,
      executor,
      options.memorySink,
      this.cacheDir,
      options.architecturePort,
    );
  }

  async start(): Promise<void> {
    if (this.started || !isOutcomeEngineActive(this.flags)) {
      return;
    }
    const types = [
      'USER_INTENT_CAPTURED',
      'mission.created',
      'mission.execution.updated',
      'CODE_CHANGE_COMPLETED',
      'FILE_CREATED',
      'FILE_MODIFIED',
      'FILE_DELETED',
      'READY_FOR_VERIFICATION',
      'verification.requested',
      'REVIEW_EVALUATE_REQUESTED',
      'REVIEW_REQUIRED',
      'REVIEW_STARTED',
      'REVIEW_APPROVED',
      'REVIEW_REJECTED',
      'REVIEW_CHANGES_REQUESTED',
      'REVIEW_SUPERSEDED',
      'REVIEW_EXPIRED',
    ] as const;
    for (const t of types) {
      await this.bus.subscribe(t, (e) => this.pipeline.handle(e));
    }
    this.pipeline.reviews.seedDefaultPolicies();
    this.publisher.start();
    this.started = true;
  }

  setArchitecturePort(port: ArchitectureReviewPort): void {
    this.pipeline.reviews.setArchitecturePort(port);
  }

  stop(): void {
    this.publisher.stop();
    this.store.close();
    this.started = false;
  }

  /** Coding plane: fire-and-forget. Never throws. */
  emit(
    event: Omit<OutcomeEvent, 'event_id' | 'timestamp' | 'event_version'> & Partial<OutcomeEvent>,
  ): void {
    if (!isOutcomeEngineActive(this.flags)) {
      return;
    }
    try {
      this.buffer.append({
        ...event,
        project_id: event.project_id ?? this.projectId,
      });
    } catch {
      this.metrics.recordDropped();
    }
  }

  /** Cache-only prompt/status block. Never hits SQLite/workers. */
  lookup(_task?: string): string {
    try {
      const raw = readFileSync(join(this.cacheDir, 'latest.json'), 'utf8');
      const j = JSON.parse(raw) as { status?: string; score?: number; mission_id?: string };
      return `Outcome ${j.mission_id ?? ''}: ${j.status ?? 'UNKNOWN'} (${j.score ?? 0}% verified)`;
    } catch {
      return '';
    }
  }

  createMission(text: string, sessionId?: string): { id: string; status: string } {
    const mission = createMissionRecord({
      projectId: this.projectId,
      text,
      sessionId,
    });
    this.store.upsertMission(mission);
    this.emit({
      event_type: 'mission.created',
      project_id: this.projectId,
      mission_id: mission.id,
      session_id: sessionId,
      payload: { text, request_text: text },
    });
    return { id: mission.id, status: 'QUEUED' };
  }

  async queueVerify(requirementId: string): Promise<{ verificationRunId: string; status: string }> {
    const req = this.store.getRequirement(requirementId);
    if (!req) {
      return { verificationRunId: '', status: 'NOT_FOUND' };
    }
    const ids = await this.pipeline.queueRequirement(req);
    return { verificationRunId: ids[0] ?? '', status: 'QUEUED' };
  }

  async queueMissionVerify(missionId: string): Promise<{ queued: number }> {
    this.emit({
      event_type: 'READY_FOR_VERIFICATION',
      project_id: this.projectId,
      mission_id: missionId,
      timestamp: nowIso(),
    });
    return { queued: this.store.listRequirements(missionId).length };
  }

  queueReviewEvaluate(missionId: string): { status: string; missionId: string } {
    this.emit({
      event_type: 'REVIEW_EVALUATE_REQUESTED',
      project_id: this.projectId,
      mission_id: missionId,
    });
    return { status: 'QUEUED', missionId };
  }

  startReview(reviewId: string, identity: ReviewerIdentity) {
    return this.pipeline.reviews.startReview(reviewId, identity);
  }

  decideReview(
    reviewId: string,
    decision: HumanReviewDecision,
    identity: ReviewerIdentity,
    reason?: string,
  ) {
    const result = this.pipeline.reviews.decide(reviewId, decision, identity, reason);
    if (!result.error) {
      this.pipeline.rollupMission(result.review.mission_id);
    }
    return result;
  }
}

export function createOutcomeSubsystem(options: OutcomeSubsystemOptions): OutcomeSubsystem {
  return new OutcomeSubsystem(options);
}

export function createMemoryStore(): MemoryOutcomeStore {
  return new MemoryOutcomeStore();
}
