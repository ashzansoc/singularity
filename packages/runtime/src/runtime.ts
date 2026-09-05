import { ContextBus } from './bus/contextBus.js';
import { allocateAgents } from './allocation/engine.js';
import {
  detectRecommendationConflicts,
  resolveConflicts,
} from './conflict/resolver.js';
import {
  createExecutionSubstrate,
  type ExecutionSubstrate,
} from './execution/substrate.js';
import { WorkflowEventStore } from './events/store.js';
import { integrateResults } from './integrate/integrator.js';
import {
  bumpMissionPhase,
  createMissionWorkflow,
  type MissionWorkflowState,
} from './mission/workflow.js';
import { calculateWorkflowProgress } from './progress/calculator.js';
import { synthesizeFinalOutcome } from './synthesis/synthesizer.js';
import {
  requestTracer,
  hashPromptForTrace,
  type TracePhase,
} from '@singularity/router';
import {
  createLlmPortFromSingularityAI,
  type SingularityLlmPortOptions,
} from './llm.js';
import {
  createExecutionPlan,
  createFallbackPlan,
} from './planner/planner.js';
import type {
  DesignPreviewGatePort,
  EditPort,
  LlmPort,
  ToolPort,
  WorkspacePort,
} from './ports.js';
import {
  aggregateUsage,
  collectSubagentResults,
  createSubagentOrchestrator,
  DEFAULT_SUBAGENT_BOUNDS,
} from './subagent/index.js';
import { verifyAgainstRequirements } from './tools/requirementVerifier.js';
import { verifyWithTools } from './tools/verifier.js';
import { scoreRisk, verificationPolicyFor } from './tools/riskPolicy.js';
import {
  classifyComplexity,
  classifyFastPath,
  isFastPathEnabled,
  tryFastPath,
  type ComplexityLane,
} from './fastpath/classifier.js';
import type {
  RuntimeEvent,
  RuntimeRunRequest,
  RuntimeRunResult,
} from './types.js';
import type { WorkflowSnapshot } from './events/store.js';

export interface RuntimeEngineConfig {
  llm: LlmPort;
  workspace: WorkspacePort;
  edit: EditPort;
  /** Default concurrency for the worker pool / maxConcurrentSubagents. */
  concurrency?: number;
  lockTimeoutMs?: number;
  sessionId?: string;
  onEvent?: (event: RuntimeEvent) => void;
  /** Workspace root for Design DNA / Design Spec (.singularity/). */
  workspaceRoot?: string;
  /** Optional browser port for visual QA captures. */
  browser?: import('@singularity/design').BrowserPort;
  previewUrl?: string;
  designPreviewGate?: DesignPreviewGatePort;
  tools?: ToolPort;
  enableSubagentLoop?: boolean;
  enableVerification?: boolean;
  shellExec?: (command: string) => Promise<{ ok: boolean; output: string }>;
  onContextRequest?: (req: {
    requested_files: string[];
    reason: string;
  }) => Promise<string | undefined>;
  /** Fire-and-forget. Must not await verification. */
  onOutcomeCheckpoint?: (payload: {
    kind: 'READY_FOR_VERIFICATION';
    sessionId: string;
    missionId?: string;
    goal: string;
    ok: boolean;
  }) => void;
  missionId?: string;
  multiAgentLimits?: RuntimeRunRequest['multiAgentLimits'];
  executionSubstrate?: ExecutionSubstrate;
  /** Live workflow snapshots for chat UI. */
  onWorkflowSnapshot?: (snapshot: WorkflowSnapshot) => void;
}

export interface RuntimeEngine {
  run(request: RuntimeRunRequest): Promise<RuntimeRunResult>;
}

/** Medium-lane cap: planner + minimal workers, never a wide DAG. */
const MEDIUM_LANE_MAX_SUBAGENTS = 3;

/**
 * Create the Runtime v4 engine (planner → subagent orchestrator → scheduler → integrator → verify).
 */
export function createRuntimeEngine(config: RuntimeEngineConfig): RuntimeEngine {
  return {
    async run(request: RuntimeRunRequest): Promise<RuntimeRunResult> {
      const events: RuntimeEvent[] = [];
      const eventStore = new WorkflowEventStore();
      let missionState: MissionWorkflowState | undefined;

      const publishSnapshot = (): void => {
        const snap = eventStore.snapshot();
        if (snap) {
          config.onWorkflowSnapshot?.(snap);
        }
      };

      const onEvent = (ev: RuntimeEvent): void => {
        events.push(ev);
        eventStore.ingestRuntimeEvent(ev);
        if (ev.taskId && missionState && eventStore.snapshot()?.plan) {
          publishSnapshot();
        }
        config.onEvent?.(ev);
      };

      const emitWorkflow = (
        kind: RuntimeEvent['kind'],
        message: string,
        data?: Record<string, unknown>,
      ): void => {
        onEvent({ kind, ts: Date.now(), message, data });
        publishSnapshot();
      };

      const bus = new ContextBus();
      const concurrency =
        request.maxConcurrentSubagents ??
        request.concurrency ??
        config.concurrency ??
        DEFAULT_SUBAGENT_BOUNDS.maxConcurrentSubagents;
      const lockTimeoutMs = request.lockTimeoutMs ?? config.lockTimeoutMs ?? 30_000;
      const sessionId = config.sessionId ?? `runtime-${Date.now().toString(36)}`;
      const missionId = request.missionId ?? config.missionId;
      const substrate =
        config.executionSubstrate ?? createExecutionSubstrate('native');
      const traceId = requestTracer.begin({
        sessionId,
        source: 'runtime.run',
        promptHash: hashPromptForTrace(request.goal),
      });
      const mark = (phase: TracePhase): void => requestTracer.mark(traceId, phase);
      const enableVerification =
        request.enableVerification ?? config.enableVerification ?? true;
      const enableSubagentLoop =
        request.enableSubagentLoop ?? config.enableSubagentLoop ?? true;

      // Phase 13 — deterministic complexity lanes: simple goals take the
      // one-call lane; medium goals get bounded orchestration (planner +
      // minimal workers, no review tail); deep/complex/high-risk goals run
      // the unchanged full pipeline. Uncertain ⇒ deep.
      const fastPathAllowed =
        isFastPathEnabled() && request.fastPath !== false && !request.plan;
      let lane: ComplexityLane = 'deep';
      if (fastPathAllowed) {
        lane = classifyComplexity(request.goal);
        const fpDecision = classifyFastPath(request.goal);
        requestTracer.setMeta(traceId, {
          fastPath: fpDecision.use,
          lane,
        } as never);
        if (lane === 'fast') {
          const fp = await tryFastPath({
            goal: request.goal,
            llm: config.llm,
            workspace: config.workspace,
            edit: config.edit,
            structuredContext: request.structuredContext,
            sessionId,
            signal: request.signal,
            onEvent,
          });
          if (fp.ranFast && fp.result) {
            mark('request_finished');
            requestTracer.finish(traceId, { ok: fp.result.ok });
            return fp.result;
          }
          // Lightweight check failed or errored — auto-escalate to deep path.
          lane = 'deep';
          onEvent({
            kind: 'plan_created',
            ts: Date.now(),
            message: 'Fast path declined; escalating to full pipeline',
            data: { reason: fpDecision.reason },
          });
        }
      }
      // Medium lane: bounded orchestration — no auto tester/reviewer tails,
      // capped fan-out. Deep lane keeps every existing behavior.
      const mediumLane =
        fastPathAllowed &&
        lane === 'medium' &&
        (request.maxConcurrentSubagents ?? 99) > MEDIUM_LANE_MAX_SUBAGENTS;
      const orchestrator = createSubagentOrchestrator({
        bounds:
          lane === 'medium'
            ? { ...request.subagentBounds, maxTotalSubagents: MEDIUM_LANE_MAX_SUBAGENTS }
            : request.subagentBounds,
        ensureReviewTail: !mediumLane,
        onEvent,
      });
      if (mediumLane) {
        onEvent({
          kind: 'plan_created',
          ts: Date.now(),
          message: `Medium lane: bounded orchestration (≤${MEDIUM_LANE_MAX_SUBAGENTS} tasks, no review tail)`,
          data: { lane: 'medium' },
        });
      }

      try {
        let plan = request.plan;
        const fileHints = config.workspace.listFiles
          ? await config.workspace.listFiles()
          : undefined;
        if (!plan) {
          mark('planning_started');
          onEvent({
            kind: 'agent_progress',
            ts: Date.now(),
            message: 'Planner — calling model to build task graph…',
          });
          try {
            plan = await createExecutionPlan(
              {
                goal: request.goal,
                projectSummary: request.projectSummary,
                codingStandards: request.codingStandards,
                structuredContext: request.structuredContext,
                verificationChecklist: request.verificationChecklist,
                fileHints,
                signal: request.signal,
                ...(lane === 'medium' ? { maxTasks: MEDIUM_LANE_MAX_SUBAGENTS } : {}),
              },
              {
                llm: config.llm,
                preferredTier: 'T5',
                sessionId: `${sessionId}-planner`,
              },
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            mark('planning_finished');
            plan = createFallbackPlan({
              goal: request.goal,
              projectSummary: request.projectSummary,
              codingStandards: request.codingStandards,
              structuredContext: request.structuredContext,
              verificationChecklist: request.verificationChecklist,
              fileHints,
            });
            onEvent({
              kind: 'plan_created',
              ts: Date.now(),
              message: `Planner failed (${message}); using fallback plan`,
              data: { taskCount: plan.nodes.length },
            });
          }
        }

        plan = orchestrator.normalize(plan);

        onEvent({
          kind: 'agent_progress',
          ts: Date.now(),
          message: 'Planner — allocating agents and building mission DAG…',
        });

        const allocation = allocateAgents({
          goal: request.goal,
          plan,
          complexityLane: lane,
          repositoryFileCount: fileHints?.length,
          limits: request.multiAgentLimits ?? config.multiAgentLimits,
        });
        plan = allocation.plan;

        missionState = createMissionWorkflow({
          sessionId,
          goal: request.goal,
          missionId,
          executionMode: allocation.mode,
          agentCount: allocation.agentCount,
        });
        eventStore.setWorkflow(missionState, plan);
        emitWorkflow('workflow_started', `Assembling ${allocation.agentCount} agents (${allocation.mode})`, {
          workflowId: missionState.workflowId,
          mode: allocation.mode,
          agentCount: allocation.agentCount,
        });
        for (const node of plan.nodes) {
          onEvent({
            kind: 'agent_created',
            ts: Date.now(),
            taskId: node.id,
            message: `${node.assignedAgentId} — ${node.role ?? 'specialist'}`,
            data: {
              assignedAgentId: node.assignedAgentId,
              role: node.role,
              deliverable: node.deliverable,
              model: node.assignedModel,
            },
          });
        }

        mark('planning_finished');

        onEvent({
          kind: 'plan_created',
          ts: Date.now(),
          message: `Plan ${plan.id}: ${plan.nodes.length} tasks`,
          data: {
            planId: plan.id,
            estimates: plan.estimates,
            tasks: plan.nodes.map((n) => ({
              id: n.id,
              title: n.title,
              deps: n.deps,
              ownedPaths: n.ownedPaths,
              specialty: n.specialty,
              role: n.role,
              objective: n.objective ?? n.title,
              status: n.status,
              tools: n.tools,
              modelPolicy: n.modelPolicy,
            })),
          },
        });

        if (missionState) {
          missionState = bumpMissionPhase(missionState, 'running');
          eventStore.updateWorkflow(missionState);
          publishSnapshot();
        }

        const runConcurrency = Math.min(
          allocation.recommendedConcurrency,
          mediumLane ? Math.min(concurrency, MEDIUM_LANE_MAX_SUBAGENTS) : concurrency,
        );

        const scheduled = await substrate.run({
          plan,
          llm: config.llm,
          workspace: config.workspace,
          bus,
          concurrency: runConcurrency,
          lockTimeoutMs,
          onEvent: (ev) => {
            onEvent(ev);
            eventStore.updatePlan(plan);
            if (ev.kind === 'task_started' || ev.kind === 'subagent_started') {
              const node = plan.nodes.find((n) => n.id === ev.taskId);
              if (node) {
                node.startedAt = node.startedAt ?? Date.now();
                onEvent({
                  kind: 'agent_started',
                  ts: Date.now(),
                  taskId: node.id,
                  message: `${node.assignedAgentId} started`,
                  data: { assignedAgentId: node.assignedAgentId, role: node.role },
                });
              }
            }
            if (ev.kind === 'task_done' || ev.kind === 'subagent_completed') {
              const node = plan.nodes.find((n) => n.id === ev.taskId);
              if (node) {
                node.completedAt = Date.now();
                node.status = 'done';
              }
            }
            emitWorkflow('workflow_progress', calculateWorkflowProgress(plan).label, {
              progress: calculateWorkflowProgress(plan),
            });
          },
          signal: request.signal,
          sessionId,
          workspaceRoot: config.workspaceRoot,
          browser: config.browser,
          previewUrl: config.previewUrl,
          designPreviewGate: config.designPreviewGate,
          tools: config.tools,
          orchestrator,
          enableSubagentLoop,
          shellExec: config.shellExec,
          onContextRequest: config.onContextRequest,
        });

        eventStore.updatePlan(plan);

        if (missionState) {
          missionState = bumpMissionPhase(missionState, 'integrating');
          eventStore.updateWorkflow(missionState);
        }

        const integrated = await integrateResults(plan, scheduled.results, {
          edit: config.edit,
          workspace: config.workspace,
          llm: config.llm,
          bus,
          onEvent,
          sessionId: `${sessionId}-integrator`,
          signal: request.signal,
        });

        const subagentResults = collectSubagentResults(plan);
        const conflicts = detectRecommendationConflicts(subagentResults);
        if (conflicts.length > 0) {
          await resolveConflicts({
            llm: config.llm,
            goal: request.goal,
            conflicts,
            sessionId: `${sessionId}-conflict`,
            signal: request.signal,
            onEvent,
          });
        }

        let verification: RuntimeRunResult['verification'];
        if (enableVerification && scheduled.ok) {
          if (missionState) {
            missionState = bumpMissionPhase(missionState, 'verifying');
            eventStore.updateWorkflow(missionState);
            emitWorkflow('workflow_verifying', 'Running verification…', {});
          }
          mark('verification_started');

          // Step 9 — risk-based verification policy. Uncertain/high ⇒ full
          // current path; low skips only the LLM checklist pass.
          const risk = scoreRisk(scheduled.results.flatMap((r) => r.diffs));
          const policy = verificationPolicyFor(risk.tier);
          onEvent({
            kind: 'verify_started',
            ts: Date.now(),
            message:
              risk.tier === 'high'
                ? 'Running full verification (high risk)'
                : `Risk-based verification (${risk.tier}, score ${risk.score})`,
            data: { tier: risk.tier, score: risk.score, signals: risk.signals.slice(0, 12) },
          });

          const toolsPort = config.tools ?? {};
          let toolVerify = await verifyWithTools(toolsPort, {
            paths: integrated.appliedPaths,
            skipTests: !policy.runFullVerification,
          });

          // High-risk runs with no wired tools must not look vacuously green.
          if (!config.tools?.typecheck && policy.runFullVerification) {
            toolVerify = {
              ...toolVerify,
              ok: false,
              summary: `${toolVerify.summary} · no typecheck tool wired for high-risk change`,
            };
          }

          const implSummary = [
            integrated.summary,
            ...scheduled.results
              .filter((r) => r.subagentResult)
              .map((r) => r.subagentResult!.summary),
          ].join('\n');

          const reqVerify = policy.runChecklistVerifier
            ? await verifyAgainstRequirements({
                llm: config.llm,
                task: request.goal,
                checklist: plan.verificationChecklist ?? '',
                implementationSummary: implSummary,
                sessionId: `${sessionId}-verify`,
                signal: request.signal,
              })
            : {
                ok: true,
                items: [],
                summary: 'Checklist verifier skipped (low-risk change)',
                tokensUsed: 0,
              };

          const verifyOk = toolVerify.ok && reqVerify.ok;
          verification = {
            toolsOk: toolVerify.ok,
            requirementsOk: reqVerify.ok,
            summary: [toolVerify.summary, reqVerify.summary]
              .filter(Boolean)
              .join(' · '),
          };

          if (!toolVerify.ok && config.onContextRequest) {
            const failOut = toolVerify.steps
              .filter((s) => !s.ok)
              .map((s) => `${s.name}\n${s.output}`)
              .join('\n');
            try {
              await config.onContextRequest({
                requested_files: integrated.appliedPaths,
                reason: failOut || toolVerify.summary,
              });
            } catch {
              /* context expansion is best-effort */
            }
          }

          onEvent({
            kind: verifyOk ? 'verify_done' : 'verify_failed',
            ts: Date.now(),
            message: verification.summary,
            data: { toolVerify, reqVerify },
          });
          mark('verification_finished');
          try {
            config.onOutcomeCheckpoint?.({
              kind: 'READY_FOR_VERIFICATION',
              sessionId,
              missionId,
              goal: request.goal,
              ok: verifyOk,
            });
          } catch {
            /* outcome plane optional */
          }
        }

        const subagentResultsFinal = collectSubagentResults(plan);
        const usage = aggregateUsage(scheduled.results);

        const verifyFailed = verification
          ? verification.toolsOk === false || verification.requirementsOk === false
          : false;
        const ok = scheduled.ok && integrated.ok && !verifyFailed;
        const summary = [
          `Plan: ${plan.nodes.length} tasks (critical path ${plan.estimates.criticalPathLength})`,
          `Workers: ${scheduled.results.filter((r) => r.status === 'ok').length} ok / ${scheduled.results.length} results`,
          integrated.summary,
          verification ? `Verify: ${verification.summary}` : '',
          `Usage: ${usage.inputTokens}+${usage.outputTokens} tokens · ~$${usage.estimatedCost.toFixed(4)}`,
        ]
          .filter(Boolean)
          .join('\n');

        let synthesis: string | undefined;
        if (plan.nodes.length > 1 && missionState) {
          missionState = bumpMissionPhase(missionState, 'synthesizing');
          eventStore.updateWorkflow(missionState);
          synthesis = await synthesizeFinalOutcome({
            llm: config.llm,
            goal: request.goal,
            plan,
            result: {
              ok,
              summary,
              appliedPaths: integrated.appliedPaths,
              subagentResults: subagentResultsFinal,
              verification,
            },
            sessionId: `${sessionId}-synth`,
            signal: request.signal,
          });
        }

        if (missionState) {
          missionState = bumpMissionPhase(
            missionState,
            ok ? 'completed' : 'failed',
          );
          eventStore.updateWorkflow(missionState);
          emitWorkflow(
            ok ? 'workflow_completed' : 'workflow_failed',
            ok ? 'Mission complete' : 'Mission failed',
            {
              appliedPaths: integrated.appliedPaths,
              agentCount: plan.nodes.length,
            },
          );
        }

        onEvent({
          kind: ok ? 'run_done' : 'run_failed',
          ts: Date.now(),
          message: synthesis ?? summary,
          data: {
            appliedPaths: integrated.appliedPaths,
            usage,
            subagentResults: subagentResultsFinal,
            verification,
            synthesis,
          },
        });

        requestTracer.setMeta(traceId, {
          modelId: usage.model,
          ok,
          workflowAgents: plan.nodes.length,
          workflowMode: allocation.mode,
          workflowParallelism: runConcurrency,
        } as never);
        requestTracer.addUsage(traceId, {
          completionTokens: usage.outputTokens,
        });
        requestTracer.setTokenFlow(traceId, usage.outputTokens, usage.outputTokens);
        requestTracer.finish(traceId, { ok });

        return {
          plan,
          results: scheduled.results,
          appliedPaths: integrated.appliedPaths,
          events,
          ok,
          summary: synthesis ?? summary,
          synthesis,
          workflowId: missionState?.workflowId,
          missionId,
          executionMode: allocation.mode,
          subagentResults: subagentResultsFinal,
          usage,
          verification,
          error: ok ? undefined : 'Runtime completed with failures or conflicts',
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onEvent({
          kind: 'run_failed',
          ts: Date.now(),
          message,
        });
        requestTracer.finish(traceId, { ok: false, error: message });
        return {
          plan: request.plan ?? {
            id: 'empty',
            goal: request.goal,
            projectSummary: '',
            nodes: [],
            estimates: { totalTokens: 0, taskCount: 0, criticalPathLength: 0 },
            createdAt: Date.now(),
          },
          results: [],
          appliedPaths: [],
          events,
          ok: false,
          summary: message,
          error: message,
        };
      }
    },
  };
}

export interface CreateRuntimeEngineFromAIOptions {
  ai: NonNullable<SingularityLlmPortOptions['ai']>;
  workspace: WorkspacePort;
  edit: EditPort;
  concurrency?: number;
  lockTimeoutMs?: number;
  sessionId?: string;
  onEvent?: (event: RuntimeEvent) => void;
  workspaceRoot?: string;
  browser?: import('@singularity/design').BrowserPort;
  previewUrl?: string;
  designPreviewGate?: DesignPreviewGatePort;
  tools?: ToolPort;
  enableSubagentLoop?: boolean;
  enableVerification?: boolean;
  shellExec?: (command: string) => Promise<{ ok: boolean; output: string }>;
  onContextRequest?: RuntimeEngineConfig['onContextRequest'];
  onOutcomeCheckpoint?: RuntimeEngineConfig['onOutcomeCheckpoint'];
  onWorkflowSnapshot?: RuntimeEngineConfig['onWorkflowSnapshot'];
  missionId?: string;
  multiAgentLimits?: RuntimeRunRequest['multiAgentLimits'];
  executionSubstrate?: ExecutionSubstrate;
}

/** Convenience: wire SingularityAI as the LlmPort. */
export function createRuntimeEngineFromAI(
  options: CreateRuntimeEngineFromAIOptions,
): RuntimeEngine {
  return createRuntimeEngine({
    llm: createLlmPortFromSingularityAI({
      ai: options.ai,
      sessionId: options.sessionId,
    }),
    workspace: options.workspace,
    edit: options.edit,
    concurrency: options.concurrency,
    lockTimeoutMs: options.lockTimeoutMs,
    sessionId: options.sessionId,
    onEvent: options.onEvent,
    workspaceRoot: options.workspaceRoot,
    browser: options.browser,
    previewUrl: options.previewUrl,
    designPreviewGate: options.designPreviewGate,
    tools: options.tools,
    enableSubagentLoop: options.enableSubagentLoop,
    enableVerification: options.enableVerification,
    shellExec: options.shellExec,
    onContextRequest: options.onContextRequest,
    onOutcomeCheckpoint: options.onOutcomeCheckpoint,
    onWorkflowSnapshot: options.onWorkflowSnapshot,
    missionId: options.missionId,
    multiAgentLimits: options.multiAgentLimits,
    executionSubstrate: options.executionSubstrate,
  });
}
