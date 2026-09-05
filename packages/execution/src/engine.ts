import { randomUUID } from 'node:crypto';
import {
  createExecutionPlan,
  createFallbackPlan,
  integrateResults,
  verifyWithTools,
  classifyComplexity,
  type ComplexityLane,
  type ExecutionPlan,
  type LlmPort,
  type ToolPort,
  type WorkspacePort,
  type EditPort,
  type WorkerResult,
} from '@singularity/runtime';
import { ContextBus } from '@singularity/runtime';
import type { AgentExecutor, AgentTaskContext, AgentTaskResult, TaskNode } from '@singularity/runtime';
import { analyzeDependencies, type RepoContext } from '@singularity/runtime';
import { createExecutionGraph, type ExecutionGraph } from './graph.js';
import { openExecutionStore } from './persistence/sqlite.js';
import type { ExecutionStore } from './persistence/store.js';
import { ensureExecutionLayout, writeGraphSnapshot } from './layout.js';
import { TodoProjection } from './projections/todoMd.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint.js';
import { createCorrectiveTasks, shouldRetry } from './replanner.js';
import { artifactFromSubagentResult } from './artifacts.js';
import type { ExecutionEvent } from './events/types.js';
import type { IntegrationRecord, VerificationRecord } from './types.js';
import type { ExecutionFlags } from './flags.js';

export interface ExecutionEngineOptions {
  workspaceRoot: string;
  sessionId?: string;
  llm: LlmPort;
  workspace: WorkspacePort;
  edit: EditPort;
  tools?: ToolPort;
  executor: AgentExecutor;
  flags?: Partial<ExecutionFlags>;
  onEvent?: (event: ExecutionEvent) => void;
  onTodoProjection?: (markdown: string) => void;
  signal?: AbortSignal;
  repoContext?: RepoContext;
  /** When true, integration and verification run through the executor (runSubagent) instead of LLM-only phases. */
  runPhasesViaExecutor?: boolean;
  /** Skip Design Intelligence pipeline injection (default true for runSubagent orchestration). */
  skipDesignPipeline?: boolean;
}

export interface ExecutionRunResult {
  executionId: string;
  ok: boolean;
  plan: ExecutionPlan;
  results: AgentTaskResult[];
  appliedPaths: string[];
  summary: string;
  verification?: VerificationRecord;
}

function laneMeetsThreshold(lane: ComplexityLane, threshold: ExecutionFlags['autoPlanThreshold']): boolean {
  const order: ComplexityLane[] = ['fast', 'medium', 'deep'];
  const laneIdx = order.indexOf(lane);
  const thresholdIdx = threshold === 'low' ? 0 : threshold === 'medium' ? 1 : 2;
  return laneIdx >= thresholdIdx;
}

function syntheticPhaseTask(id: string, title: string, description: string): TaskNode {
  return {
    id,
    title,
    description,
    deps: [],
    ownedPaths: [],
    expectedOutput: description,
    estimatedTokens: 4000,
    recommendedTier: 'T2',
    priority: 1,
    retryLimit: 1,
    status: 'ready',
  };
}

export class ExecutionEngine {
  private readonly store: ExecutionStore;
  private readonly layout;
  private readonly todoProjection = new TodoProjection();

  constructor(private readonly opts: ExecutionEngineOptions) {
    this.layout = ensureExecutionLayout(opts.workspaceRoot);
    this.store = openExecutionStore(this.layout.dbPath);
  }

  private emit(kind: ExecutionEvent['kind'], executionId: string, message: string, taskId?: string, payload?: Record<string, unknown>): void {
    const event: ExecutionEvent = {
      id: randomUUID(),
      executionId,
      kind,
      taskId,
      message,
      payload,
      ts: Date.now(),
    };
    this.store.appendEvent(event);
    this.opts.onEvent?.(event);
  }

  shouldUseEngine(goal: string): boolean {
    const threshold = this.opts.flags?.autoPlanThreshold ?? 'medium';
    const lane = classifyComplexity(goal);
    return laneMeetsThreshold(lane, threshold);
  }

  async run(goal: string, existingExecutionId?: string): Promise<ExecutionRunResult> {
    const executionId = existingExecutionId ?? randomUUID();
    let record = this.store.getExecution(executionId);
    if (!record) {
      record = {
        id: executionId,
        objective: goal,
        status: 'planning',
        sessionId: this.opts.sessionId,
        workspaceRoot: this.opts.workspaceRoot,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.store.upsertExecution(record);
      this.emit('ExecutionCreated', executionId, `Execution created for: ${goal}`);
    }

    let plan = this.store.getPlan(executionId);
    let graph: ExecutionGraph;

    if (!plan) {
      this.emit('ExecutionStarted', executionId, 'Planning started');
      const skipDesignPipeline = this.opts.skipDesignPipeline ?? true;
      const planRequest = { goal, signal: this.opts.signal, skipDesignPipeline };
      try {
        plan = await createExecutionPlan(
          planRequest,
          { llm: this.opts.llm, sessionId: executionId },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emit('ReplannerTriggered', executionId, `Planner failed (${message}); using fallback plan`);
        plan = createFallbackPlan(planRequest);
      }
      const enriched = analyzeDependencies(plan, this.opts.repoContext ?? {});
      plan = enriched.plan;
      graph = createExecutionGraph(executionId, plan, this.store);
      for (const dep of enriched.dependencies) {
        if (dep.kind !== 'explicit') {
          graph.addDependency(dep.fromTaskId, dep.toTaskId, dep.kind, dep.reason);
        }
      }
      this.store.savePlan(executionId, plan);
      writeGraphSnapshot(this.layout, graph.toEnrichedGraph());
      this.projectTodos(executionId, plan);
    } else {
      graph = createExecutionGraph(executionId, plan, this.store);
    }

    record.status = 'running';
    record.updatedAt = Date.now();
    this.store.upsertExecution(record);

    const checkpoint = loadCheckpoint(this.store, executionId);
    const done = new Set<string>(checkpoint?.completedTaskIds ?? []);
    const results: AgentTaskResult[] = [];
    const maxConcurrent = this.opts.flags?.maxConcurrentAgents ?? 8;
    let batchIndex = checkpoint?.batchIndex ?? 0;

    while (done.size < plan.nodes.length) {
      if (this.opts.signal?.aborted) {
        record.status = 'cancelled';
        this.store.upsertExecution(record);
        break;
      }

      const ready = graph.getReadyNodes(done);
      if (ready.length === 0) {
        const pending = plan.nodes.filter(n => !done.has(n.id) && n.status !== 'failed' && n.status !== 'cancelled');
        if (pending.length > 0) {
          record.status = 'failed';
          this.store.upsertExecution(record);
          this.emit('ExecutionFailed', executionId, 'Deadlock: no ready tasks');
          break;
        }
        break;
      }

      this.emit('BatchStarted', executionId, `Batch ${batchIndex} started`, undefined, { batchIndex, taskIds: ready.map(t => t.id) });
      for (const task of ready) {
        this.emit('TaskReady', executionId, `Task ready: ${task.title}`, task.id);
      }
      const batch = ready.slice(0, maxConcurrent);
      const inFlight: string[] = [];

      const batchResults = await Promise.all(batch.map(async (task) => {
        inFlight.push(task.id);
        graph.updateTaskStatus(task.id, 'running');
        this.emit('TaskStarted', executionId, `Task started: ${task.title}`, task.id);

        const ctx: AgentTaskContext = {
          executionId,
          task,
          workspaceRoot: this.opts.workspaceRoot,
          sessionId: this.opts.sessionId,
          signal: this.opts.signal,
        };

        try {
          const result = await this.opts.executor.executeTask(ctx);
          if (result.ok && result.subagentResult) {
            this.store.insertArtifact(artifactFromSubagentResult(task.id, result.subagentResult));
          }
          if (result.ok) {
            graph.updateTaskStatus(task.id, 'completed');
            done.add(task.id);
            this.emit('TaskCompleted', executionId, `Task completed: ${task.title}`, task.id);
          } else {
            const failureClass = result.failureClass ?? 'default';
            const attempts = (task.attempts ?? 0) + 1;
            if (shouldRetry(failureClass, attempts)) {
              graph.updateTaskStatus(task.id, 'ready');
              this.emit('TaskRetry', executionId, `Retrying task: ${task.title}`, task.id, { failureClass, attempts });
            } else {
              graph.updateTaskStatus(task.id, 'failed');
              await createCorrectiveTasks(
                { llm: this.opts.llm, store: this.store, graph, executionId, onEvent: this.opts.onEvent },
                task,
                failureClass,
                result.error ?? 'Task failed',
              );
              done.add(task.id);
              this.emit('TaskFailed', executionId, `Task failed: ${task.title}`, task.id);
            }
          }
          return result;
        } catch (err) {
          graph.updateTaskStatus(task.id, 'failed');
          this.emit('TaskFailed', executionId, `Task error: ${task.title}`, task.id, { error: String(err) });
          return { taskId: task.id, ok: false, error: String(err) } satisfies AgentTaskResult;
        }
      }));

      results.push(...batchResults);
      batchIndex++;
      saveCheckpoint(this.store, executionId, {
        batchIndex,
        completedTaskIds: [...done],
        inFlightTaskIds: [],
        status: 'running',
      });
      this.projectTodos(executionId, graph.getPlan());
      writeGraphSnapshot(this.layout, graph.toEnrichedGraph());
      this.emit('BatchCompleted', executionId, `Batch ${batchIndex - 1} completed`, undefined, { batchIndex: batchIndex - 1 });
    }

    const workerResults: WorkerResult[] = results
      .filter(r => r.workerResult)
      .map(r => r.workerResult!);

    record.status = 'integrating';
    this.store.upsertExecution(record);
    this.emit('IntegrationStarted', executionId, 'Integration phase started');

    let integrateResult: { ok: boolean; summary: string; appliedPaths: string[]; conflicts?: unknown[] };
    if (this.opts.runPhasesViaExecutor) {
      const integrationTask = syntheticPhaseTask(
        '__integration__',
        'Integration',
        'Reconcile parallel worker outputs, resolve conflicts, and produce a coherent integrated codebase.',
      );
      const integrationCtx: AgentTaskContext = {
        executionId,
        task: integrationTask,
        workspaceRoot: this.opts.workspaceRoot,
        sessionId: this.opts.sessionId,
        signal: this.opts.signal,
      };
      const integrationResult = await this.opts.executor.executeTask(integrationCtx);
      results.push(integrationResult);
      integrateResult = {
        ok: integrationResult.ok,
        summary: integrationResult.subagentResult?.summary ?? integrationResult.error ?? 'Integration completed',
        appliedPaths: integrationResult.subagentResult?.filesModified ?? [],
        conflicts: [],
      };
    } else {
      const bus = new ContextBus();
      const llmIntegrate = await integrateResults(plan, workerResults, {
        edit: this.opts.edit,
        workspace: this.opts.workspace,
        llm: this.opts.llm,
        bus,
        signal: this.opts.signal,
      });
      integrateResult = llmIntegrate;
    }

    const integration: IntegrationRecord = {
      executionId,
      status: integrateResult.ok ? 'completed' : 'failed',
      reportJson: { summary: integrateResult.summary, conflicts: integrateResult.conflicts },
      appliedPaths: integrateResult.appliedPaths,
      createdAt: Date.now(),
      completedAt: Date.now(),
    };
    this.store.upsertIntegration(integration);
    this.emit(integrateResult.ok ? 'IntegrationCompleted' : 'IntegrationFailed', executionId, integrateResult.summary);

    record.status = 'verifying';
    this.store.upsertExecution(record);
    this.emit('VerificationStarted', executionId, 'Verification phase started');

    let verification: VerificationRecord | undefined;
    if (this.opts.runPhasesViaExecutor) {
      const verificationTask = syntheticPhaseTask(
        '__verification__',
        'Verification',
        'Independently verify acceptance criteria, run tests/build, and report pass/fail with evidence.',
      );
      const verificationCtx: AgentTaskContext = {
        executionId,
        task: verificationTask,
        workspaceRoot: this.opts.workspaceRoot,
        sessionId: this.opts.sessionId,
        signal: this.opts.signal,
      };
      const verificationResult = await this.opts.executor.executeTask(verificationCtx);
      results.push(verificationResult);
      const verdict = verificationResult.ok ? 'PASS' : 'FAIL';
      verification = {
        executionId,
        verdict,
        reportJson: { summary: verificationResult.subagentResult?.summary ?? verificationResult.error ?? '' },
        createdAt: Date.now(),
      };
      this.store.insertVerification(verification);
      this.emit(verificationResult.ok ? 'VerificationCompleted' : 'VerificationFailed', executionId, String(verification.reportJson?.summary ?? ''));
    } else if (this.opts.tools) {
      const verifyResult = await verifyWithTools(this.opts.tools);
      const verdict = verifyResult.ok ? 'PASS' : 'FAIL';
      verification = {
        executionId,
        verdict,
        reportJson: { steps: verifyResult.steps, summary: verifyResult.summary },
        createdAt: Date.now(),
      };
      this.store.insertVerification(verification);
      this.emit(verifyResult.ok ? 'VerificationCompleted' : 'VerificationFailed', executionId, verifyResult.summary);

      if (!verifyResult.ok) {
        const failedNode = plan.nodes[0];
        if (failedNode) {
          await createCorrectiveTasks(
            { llm: this.opts.llm, store: this.store, graph, executionId, onEvent: this.opts.onEvent },
            { ...failedNode, id: `${failedNode.id}-verify-fix` },
            'verification_fail',
            verifyResult.summary,
          );
        }
      }
    }

    const ok = integrateResult.ok && (!verification || verification.verdict !== 'FAIL');
    record.status = ok ? 'completed' : 'failed';
    record.updatedAt = Date.now();
    this.store.upsertExecution(record);
    this.emit(ok ? 'ExecutionCompleted' : 'ExecutionFailed', executionId, ok ? 'Execution completed' : 'Execution failed');

    return {
      executionId,
      ok,
      plan,
      results,
      appliedPaths: integrateResult.appliedPaths,
      summary: integrateResult.summary,
      verification,
    };
  }

  async resume(executionId: string): Promise<ExecutionRunResult> {
    const record = this.store.getExecution(executionId);
    if (!record) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    return this.run(record.objective, executionId);
  }

  getStore(): ExecutionStore {
    return this.store;
  }

  private projectTodos(executionId: string, plan: ExecutionPlan): void {
    const md = this.todoProjection.render(plan);
    this.opts.onTodoProjection?.(md);
    this.emit('TaskCreated', executionId, 'Todo projection updated');
  }
}

export function createExecutionEngine(opts: ExecutionEngineOptions): ExecutionEngine {
  return new ExecutionEngine(opts);
}
