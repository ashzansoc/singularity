/**
 * BrainRuntime — continuous local cognitive loop.
 * Observes events, scores attention, stores/consolidates locally,
 * and wakes the ONE Brain LLM only when warranted.
 */

import { scoreAttention } from './attention.js';
import { BrainBudget } from './budget.js';
import type { BrainConfig } from './types.js';
import type { BrainModelClient } from './modelClient.js';
import { buildBrainMessages } from './prompt.js';
import { minimizeForRemote, packSections } from './privacy.js';
import { SemanticMemoryApi } from './semantic.js';
import { ImprovementManager } from './improvement.js';
import {
  classifyRuntimeEventKind,
  executeBrainTool,
  parseToolCall,
  toolSchemasForPrompt,
  type BrainToolContext,
} from './tools.js';
import type { BrainStore } from './store.js';
import type {
  AttentionDecision,
  BrainRuntimeSnapshot,
  ReasoningMode,
  RuntimeEvent,
  RuntimeStatus,
} from './types.js';

export type StoreHandler = (event: RuntimeEvent) => Promise<void>;

export interface BrainRuntimeOptions {
  store: BrainStore;
  config: BrainConfig;
  model: BrainModelClient;
  onStore?: StoreHandler;
  onStatus?: (snap: BrainRuntimeSnapshot) => void;
  onMemoryDelta?: (delta: { memories?: number; relationships?: number; learnings?: number; insights?: number }) => void;
  debounceMs?: number;
  maxAutonomy?: 1 | 2 | 3;
  getWorkspaceRoot?: () => string | undefined;
}

export class BrainRuntime {
  private queue: RuntimeEvent[] = [];
  private pendingReflect: RuntimeEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private status: RuntimeStatus = 'stopped';
  private lastEventAt?: number;
  private lastReflectionAt?: number;
  private running = false;
  private readonly budget: BrainBudget;
  private readonly semantic: SemanticMemoryApi;
  private readonly improvement: ImprovementManager;
  private readonly debounceMs: number;

  constructor(private opts: BrainRuntimeOptions) {
    this.budget = new BrainBudget(opts.store, opts.config);
    this.semantic = new SemanticMemoryApi(opts.store);
    this.improvement = new ImprovementManager(opts.store);
    this.debounceMs = opts.debounceMs ?? 800;
  }

  get improvementManager(): ImprovementManager {
    return this.improvement;
  }

  get semanticApi(): SemanticMemoryApi {
    return this.semantic;
  }

  start(): void {
    if (this.status !== 'stopped' && this.status !== 'idle') {
      return;
    }
    this.status = 'idle';
    this.opts.store.addActivity({
      ts: Date.now(),
      kind: 'runtime_start',
      message: 'Brain Runtime started',
    });
    this.armIdle();
    this.emitStatus();
  }

  stop(): void {
    this.status = 'stopped';
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.opts.store.addActivity({
      ts: Date.now(),
      kind: 'runtime_stop',
      message: 'Brain Runtime stopped',
    });
    this.emitStatus();
  }

  enqueue(event: RuntimeEvent): void {
    if (!this.opts.config.enabled || this.status === 'stopped') {
      return;
    }
    const kind = classifyRuntimeEventKind(event);
    this.queue.push({ ...event, kind, ts: event.ts ?? Date.now() });
    this.lastEventAt = Date.now();
    this.status = 'active';
    this.emitStatus();
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.drain();
    }, this.debounceMs);
    this.armIdle();
  }

  /** Manual UltraThink trigger. */
  async ultrathink(brief: string, projectId?: string): Promise<{ noAction: boolean; insightIds: string[] }> {
    if (this.opts.config.ultrathink === 'off') {
      return { noAction: true, insightIds: [] };
    }
    return this.invokeModel({
      kind: 'idle_reflection',
      text: brief,
      projectId,
      ts: Date.now(),
    }, 'ultrathink');
  }

  snapshot(): BrainRuntimeSnapshot {
    const b = this.budget.snapshot();
    return {
      status: this.status,
      lastEventAt: this.lastEventAt,
      lastReflectionAt: this.lastReflectionAt,
      callsToday: b.calls,
      tokensToday: b.tokens,
      pendingEvents: this.queue.length + this.pendingReflect.length,
      insightsNew: this.opts.store.listInsights(20, 'new').length,
    };
  }

  private armIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      void this.idleReflect();
    }, this.opts.config.idleMs);
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const batch = this.queue.splice(0, this.queue.length);
      let highest: { event: RuntimeEvent; decision: AttentionDecision } | undefined;
      for (const event of batch) {
        const scored = scoreAttention(event, {
          backgroundLevel: this.opts.config.backgroundLevel,
          ultrathink: this.opts.config.ultrathink,
        });
        this.opts.store.addActivity({
          ts: Date.now(),
          kind: `attention_${scored.decision.toLowerCase()}`,
          message: `${scored.decision} (${scored.score.toFixed(2)}): ${scored.reason}`,
          projectId: event.projectId,
        });

        if (scored.decision === 'IGNORE') {
          continue;
        }
        if (scored.decision === 'STORE' || scored.decision === 'CONSOLIDATE') {
          if (this.opts.onStore) {
            await this.opts.onStore(event);
          }
          if (scored.decision === 'CONSOLIDATE') {
            this.opts.store.refreshDegrees();
          }
          continue;
        }
        // REFLECT / ULTRATHINK — still store first, then queue for model.
        if (this.opts.onStore) {
          await this.opts.onStore(event);
        }
        this.pendingReflect.push(event);
        if (!highest || scored.decision === 'ULTRATHINK') {
          highest = { event, decision: scored.decision };
        }
      }

      if (highest) {
        const mode: ReasoningMode = highest.decision === 'ULTRATHINK' ? 'ultrathink' : 'default';
        if (mode === 'ultrathink' && this.opts.config.ultrathink === 'off') {
          /* skip */
        } else {
          await this.invokeModel(highest.event, mode);
        }
      }

      this.pendingReflect = [];
      this.status = 'idle';
      this.emitStatus();
    } finally {
      this.running = false;
    }
  }

  private async idleReflect(): Promise<void> {
    if (this.status === 'stopped' || this.running) {
      return;
    }
    if (this.pendingReflect.length === 0 && this.queue.length === 0) {
      // Look for stale high-value signals: new insights empty + recent decisions.
      const recent = this.opts.store.recentEpisodes(10);
      const decisions = recent.filter((e) => e.kind === 'decision' || /decision|architecture/i.test(e.summary));
      if (!decisions.length && this.opts.store.listInsights(5, 'new').length === 0) {
        this.status = 'idle';
        this.emitStatus();
        this.armIdle();
        return;
      }
      await this.invokeModel({
        kind: 'idle_reflection',
        text: 'Idle reflection: review recent activity for meaningful patterns. Prefer NO_ACTION if nothing is well-supported.',
        projectId: recent[0]?.projectId,
        workspaceRoot: recent[0]?.workspaceRoot,
        ts: Date.now(),
      }, 'default');
    }
    this.armIdle();
  }

  private async invokeModel(event: RuntimeEvent, mode: ReasoningMode): Promise<{ noAction: boolean; insightIds: string[] }> {
    const insightIds: string[] = [];
    if (!this.opts.model.configured) {
      this.opts.store.addActivity({
        ts: Date.now(),
        kind: 'model_skipped',
        message: 'Brain model not configured — local memory only',
        projectId: event.projectId,
      });
      return { noAction: true, insightIds };
    }
    const gate = this.budget.canCall();
    if (!gate.ok) {
      this.opts.store.addActivity({
        ts: Date.now(),
        kind: 'budget_block',
        message: gate.reason ?? 'budget',
        projectId: event.projectId,
      });
      return { noAction: true, insightIds };
    }

    this.status = 'reflecting';
    this.emitStatus();
    this.opts.store.addActivity({
      ts: Date.now(),
      kind: mode === 'ultrathink' ? 'ultrathink_start' : 'reflection_start',
      message: mode === 'ultrathink' ? 'UltraThink started' : 'Brain reflection started',
      projectId: event.projectId,
    });

    const localPack = this.buildLocalPack(event, mode);
    const minimized = minimizeForRemote(localPack, this.opts.config, mode === 'ultrathink' ? this.opts.config.contextLimit : Math.floor(this.opts.config.contextLimit * 0.6));
    const messages = buildBrainMessages({
      mode,
      userBrief: minimized.brief,
      toolSchemasJson: toolSchemasForPrompt(),
    });

    const maxRounds = mode === 'ultrathink' ? 6 : 3;
    let noAction = false;
    try {
      for (let round = 0; round < maxRounds; round++) {
        const result = await this.opts.model.complete(messages, {
          mode,
          maxTokens: this.opts.config.maxTokensPerCall,
        });
        this.budget.recordCall(result.usage?.totalTokens ?? 500);
        const call = parseToolCall(result.content);
        if (!call) {
          noAction = true;
          this.opts.store.addActivity({
            ts: Date.now(),
            kind: 'no_action',
            message: 'Unparseable model output treated as NO_ACTION',
            projectId: event.projectId,
          });
          break;
        }
        const toolCtx: BrainToolContext = {
          store: this.opts.store,
          semantic: this.semantic,
          improvement: this.improvement,
          workspaceRoot: event.workspaceRoot ?? this.opts.getWorkspaceRoot?.(),
          maxAutonomy: this.opts.maxAutonomy ?? 2,
          projectId: event.projectId,
        };
        const exec = await executeBrainTool(call.tool, call.args, toolCtx, mode);
        if (exec.noAction) {
          noAction = true;
          this.opts.store.addActivity({
            ts: Date.now(),
            kind: 'no_action',
            message: 'No significant finding',
            projectId: event.projectId,
          });
          break;
        }
        if (call.tool === 'brain.createInsight' && exec.ok && exec.result && typeof exec.result === 'object' && 'id' in (exec.result as object)) {
          insightIds.push(String((exec.result as { id: string }).id));
          this.opts.onMemoryDelta?.({ insights: 1 });
        }
        messages.push({ role: 'assistant', content: result.content });
        messages.push({
          role: 'user',
          content: `Tool result for ${call.tool}: ${JSON.stringify(exec).slice(0, 4000)}\nContinue with another tool call, or brain.noAction if done.`,
        });
        if (!exec.ok) {
          continue;
        }
        // Stop after successful insight creation unless ultrathink wants more.
        if (call.tool === 'brain.createInsight' && mode === 'default') {
          break;
        }
      }
    } catch (err) {
      this.opts.store.addActivity({
        ts: Date.now(),
        kind: 'model_error',
        message: err instanceof Error ? err.message : String(err),
        projectId: event.projectId,
      });
      noAction = true;
    }

    this.lastReflectionAt = Date.now();
    this.status = 'idle';
    this.emitStatus();
    return { noAction, insightIds };
  }

  private buildLocalPack(event: RuntimeEvent, mode: ReasoningMode): string {
    const limit = mode === 'ultrathink' ? 12 : 6;
    const semantic = this.semantic.search(event.text ?? event.kind, limit).map((s) => `[${s.type}] ${s.content}`.slice(0, 160));
    const graph = this.opts.store.topEntities(limit).map((e) => `${e.type}:${e.label}`);
    const episodes = this.opts.store.recentEpisodes(limit).map((e) => `${e.kind}: ${e.summary}`.slice(0, 140));
    const procedures = this.opts.store.listProcedures(limit).map((p) => `${p.name} (${p.steps.length} steps)`);
    const insights = this.opts.store.listInsights(5, 'new').map((i) => i.title);
    const packed = packSections([
      { title: 'Trigger', lines: [`kind=${event.kind}`, (event.text ?? '').slice(0, 800)] },
      { title: 'Semantic', lines: semantic },
      { title: 'Graph', lines: graph },
      { title: 'Episodes', lines: episodes },
      { title: 'Procedures', lines: procedures },
      { title: 'Open insights', lines: insights },
    ], mode === 'ultrathink' ? this.opts.config.contextLimit : Math.floor(this.opts.config.contextLimit * 0.6));
    return `Reason about this Brain event. Prefer brain.noAction unless evidence supports a durable conclusion.\n${packed}`;
  }

  private emitStatus(): void {
    this.opts.onStatus?.(this.snapshot());
  }
}
