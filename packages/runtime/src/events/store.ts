/**
 * Centralized workflow / agent event store for UI and observability.
 */

import type { MissionWorkflowState } from '../mission/workflow.js';
import { calculateWorkflowProgress } from '../progress/calculator.js';
import type { ExecutionPlan, RuntimeEvent, RuntimeEventKind } from '../types.js';

export type AgentEventType =
  | 'agent.created'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.tool_started'
  | 'agent.tool_completed'
  | 'agent.finding'
  | 'agent.blocked'
  | 'agent.question'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.cancelled'
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.blocked'
  | 'workflow.started'
  | 'workflow.progress'
  | 'workflow.verifying'
  | 'workflow.completed'
  | 'workflow.failed';

export interface AgentEvent {
  id: string;
  agentId?: string;
  taskId?: string;
  type: AgentEventType;
  timestamp: number;
  status?: string;
  progress?: number;
  message: string;
  artifact?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const RUNTIME_TO_AGENT: Partial<Record<RuntimeEventKind, AgentEventType>> = {
  subagent_created: 'agent.created',
  agent_created: 'agent.created',
  subagent_started: 'agent.started',
  agent_started: 'agent.started',
  task_started: 'task.started',
  subagent_progress: 'agent.progress',
  agent_progress: 'agent.progress',
  subagent_tool_call: 'agent.tool_started',
  agent_tool_started: 'agent.tool_started',
  agent_tool_completed: 'agent.tool_completed',
  agent_finding: 'agent.finding',
  subagent_waiting: 'agent.blocked',
  agent_blocked: 'agent.blocked',
  agent_question: 'agent.question',
  subagent_completed: 'agent.completed',
  agent_completed: 'agent.completed',
  task_done: 'task.completed',
  subagent_failed: 'agent.failed',
  agent_failed: 'agent.failed',
  task_failed: 'task.failed',
  task_blocked: 'task.blocked',
  subagent_cancelled: 'agent.cancelled',
  agent_cancelled: 'agent.cancelled',
  workflow_started: 'workflow.started',
  workflow_progress: 'workflow.progress',
  workflow_verifying: 'workflow.verifying',
  workflow_completed: 'workflow.completed',
  workflow_failed: 'workflow.failed',
  verify_started: 'workflow.verifying',
};

export interface WorkflowSnapshot {
  workflow: MissionWorkflowState;
  plan: ExecutionPlan;
  progress: ReturnType<typeof calculateWorkflowProgress>;
  agents: AgentTeamAgentRow[];
  events: AgentEvent[];
}

export interface AgentTeamAgentRow {
  agentId: string;
  taskId: string;
  role: string;
  title: string;
  deliverable: string;
  status: string;
  progressLabel?: string;
  progressPercent?: number;
  model?: string;
  activity?: string;
  blockedBy?: string;
  findings?: string[];
  toolsUsed?: string[];
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
}

export interface AgentTeamSummary {
  total: number;
  completed: number;
  working: number;
  queued: number;
  blocked: number;
  failed: number;
  percent?: number;
  phaseLabel: string;
}

const MAX_EVENTS = 2_000;

export class WorkflowEventStore {
  private seq = 0;
  private readonly events: AgentEvent[] = [];
  private workflow: MissionWorkflowState | undefined;
  private plan: ExecutionPlan | undefined;

  setWorkflow(workflow: MissionWorkflowState, plan: ExecutionPlan): void {
    this.workflow = workflow;
    this.plan = plan;
  }

  updatePlan(plan: ExecutionPlan): void {
    this.plan = plan;
  }

  updateWorkflow(workflow: MissionWorkflowState): void {
    this.workflow = workflow;
  }

  ingestRuntimeEvent(ev: RuntimeEvent): AgentEvent | undefined {
    const type = RUNTIME_TO_AGENT[ev.kind];
    if (!type) {
      return undefined;
    }
    const agentEvent: AgentEvent = {
      id: `ev-${++this.seq}`,
      type,
      timestamp: ev.ts,
      taskId: ev.taskId,
      agentId: (ev.data?.assignedAgentId as string | undefined) ?? ev.taskId,
      message: ev.message,
      progress: ev.data?.progress as number | undefined,
      status: ev.data?.status as string | undefined,
      metadata: ev.data,
    };
    this.events.push(agentEvent);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    return agentEvent;
  }

  publish(event: Omit<AgentEvent, 'id' | 'timestamp'> & { timestamp?: number }): AgentEvent {
    const full: AgentEvent = {
      ...event,
      id: `ev-${++this.seq}`,
      timestamp: event.timestamp ?? Date.now(),
    };
    this.events.push(full);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    return full;
  }

  getEvents(): readonly AgentEvent[] {
    return this.events;
  }

  snapshot(): WorkflowSnapshot | undefined {
    if (!this.workflow || !this.plan) {
      return undefined;
    }
    const progress = calculateWorkflowProgress(this.plan);
    const agents = buildAgentRows(this.plan);
    return {
      workflow: { ...this.workflow, progress },
      plan: this.plan,
      progress,
      agents,
      events: [...this.events],
    };
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'done':
    case 'completed':
      return 'completed';
    case 'running':
      return 'working';
    case 'ready':
    case 'pending':
    case 'queued':
      return 'queued';
    case 'failed':
      return 'failed';
    case 'blocked':
    case 'waiting':
      return 'blocked';
    case 'verifying':
      return 'verifying';
    case 'cancelled':
      return 'cancelled';
    default:
      return status;
  }
}

export function buildAgentRows(plan: ExecutionPlan): AgentTeamAgentRow[] {
  return plan.nodes.map((node, index) => {
    const agentId = node.assignedAgentId ?? `agent-${String(index + 1).padStart(2, '0')}`;
    const status = statusLabel(node.status);
    const elapsedMs =
      node.startedAt && node.completedAt
        ? node.completedAt - node.startedAt
        : node.startedAt
          ? Date.now() - node.startedAt
          : undefined;
    return {
      agentId,
      taskId: node.id,
      role: node.role ?? node.specialty ?? 'specialist',
      title: node.title,
      deliverable: node.deliverable ?? node.expectedOutput ?? node.title,
      status,
      progressLabel:
        node.progress !== undefined && node.progress >= 0
          ? `${node.progress}%`
          : status === 'working'
            ? 'Working'
            : status === 'queued'
              ? 'Queued'
              : status === 'blocked'
                ? node.waitingReason ?? 'Waiting'
                : undefined,
      progressPercent:
        node.progress !== undefined && node.progress >= 0 ? node.progress : undefined,
      model: node.assignedModel,
      activity: node.objective ?? node.title,
      blockedBy: node.waitingReason,
      findings: node.result?.recommendations?.slice(0, 5),
      startedAt: node.startedAt,
      completedAt: node.completedAt,
      elapsedMs,
    };
  });
}

export function buildAgentTeamSummary(
  plan: ExecutionPlan,
  phaseLabel: string,
): AgentTeamSummary {
  const progress = calculateWorkflowProgress(plan);
  return {
    total: progress.totalTasks,
    completed: progress.completedTasks,
    working: progress.runningTasks,
    queued: progress.queuedTasks,
    blocked: progress.blockedTasks,
    failed: progress.failedTasks,
    percent: progress.percent,
    phaseLabel,
  };
}
