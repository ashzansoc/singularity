import {
  createCacheManager,
  FingerprintHistoryStore,
  type CacheManager,
  type CacheManagerConfig,
  type CacheRequest,
  type ContextFingerprintInput,
  type InteractionMode as CacheInteractionMode,
  type PrefixHints,
} from '@singularity/cache';
import {
  buildEconomyReport,
  createPromptEngine,
  normalizePromptIntent,
  type BuilderUpdate,
  type ContextEconomyReport,
  type PromptEngine,
  type PromptEngineDebugSnapshot,
  type PromptFingerprint,
  type RenderedPrompt,
  type RouteMetadata,
} from '@singularity/prompt';
import { DEFAULT_MODEL_CATALOG, findModel } from './models/catalog.js';
import { createRoutingEngine, type RoutingEngine } from './engine.js';
import { ModelAdapter, type ModelAdapterConfig } from './providers/adapter.js';
import {
  ProviderError,
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type ChatMessage,
} from './providers/types.js';
import {
  requestTracer,
  hashPromptForTrace,
  type TracePhase,
} from './telemetry/requestTrace.js';
import { classifyTask, taskClassToIntent } from './taskClassifier.js';
import type {
  Intent,
  InteractionMode,
  ModelSpec,
  RouteContext,
  RouteDecision,
  RouteDecisionCache,
  RoutingEngineConfig,
} from './types.js';

export interface SingularityAIConfig {
  workspaceId?: string;
  durableCacheDir?: string;
  routing?: RoutingEngineConfig;
  adapter?: ModelAdapterConfig;
  cache?: Partial<CacheManagerConfig>;
  /** Default system prefix for provider prefix-cache hints. */
  systemPrefix?: string;
  /** Token budget for the prompt compiler (L10). */
  promptBudgetTokens?: number;
}

export interface SingularityCompleteRequest {
  prompt: string;
  mode?: InteractionMode;
  messages?: ChatMessage[];
  language?: string;
  openFileCount?: number;
  context?: Partial<ContextFingerprintInput>;
  /**
   * Structured IDE context for Prompt Engine v2.
   * When set (or when messages are omitted), prompts are compiled via Prompt IR.
   */
  builderUpdate?: BuilderUpdate;
  /** Session key for incremental builder + IR cache reuse. */
  sessionId?: string;
  requiresTools?: boolean;
  hasImages?: boolean;
  cacheable?: boolean;
  temperature?: number;
  modelId?: string;
  /** Cancellation propagated to the provider fetch when supported. */
  signal?: AbortSignal;
  /** Skip prompt compiler and use raw messages/prompt (escape hatch). */
  skipPromptPipeline?: boolean;
}

export interface SingularityCompleteResult {
  decision: RouteDecision;
  result: ChatCompletionResult;
  fromCache: boolean;
  cacheLayer?: 'L3' | 'L4';
  prefixHints: PrefixHints;
  /** Present when the prompt compiler ran. */
  prompt?: {
    irHash: string;
    fromIrCache: boolean;
    totalTokens: number;
    droppedSegmentIds: string[];
    rendered: RenderedPrompt;
    route?: RouteMetadata;
    fingerprint?: PromptFingerprint;
    blockFingerprints?: PromptFingerprint['blockFingerprints'];
  };
  /** Context Economy telemetry. */
  economy?: ContextEconomyReport;
}

/**
 * Unified AI runtime: route → cache lookup → provider complete → write-through.
 */
export class SingularityAI {
  readonly engine: RoutingEngine;
  readonly cache: CacheManager;
  readonly adapter: ModelAdapter;
  readonly workspaceId: string;
  /** Prompt Engine v2 (graph → IR → adapters). */
  readonly promptEngine: PromptEngine;
  private readonly promptBudgetTokens: number;
  private readonly fingerprintHistory: FingerprintHistoryStore;

  constructor(config: SingularityAIConfig = {}) {
    this.workspaceId = config.workspaceId ?? 'default';
    this.promptBudgetTokens = config.promptBudgetTokens ?? 12_000;
    this.cache = createCacheManager({
      workspaceId: this.workspaceId,
      durableDir: config.durableCacheDir,
      ...config.cache,
    });
    this.fingerprintHistory = new FingerprintHistoryStore({
      workspaceId: this.workspaceId,
      dir: config.durableCacheDir,
    });

    const routeCache = createRouteDecisionCacheBridge(
      this.cache,
      this.workspaceId,
    );

    this.engine = createRoutingEngine({
      ...config.routing,
      routeCache,
    });
    this.adapter = new ModelAdapter(config.adapter);
    this.promptEngine = createPromptEngine({
      workspaceId: this.workspaceId,
      durableDir: config.durableCacheDir
        ? `${config.durableCacheDir}/prompt-engine`
        : undefined,
      budgetTokens: this.promptBudgetTokens,
    });
  }

  /** Status snapshot for IDE status bar / diagnostics. */
  status(): {
    workspaceId: string;
    cacheMetrics: ReturnType<CacheManager['metrics']['snapshot']>;
    catalogSize: number;
    promptCache: { hits: number; misses: number; size: number };
  } {
    return {
      workspaceId: this.workspaceId,
      cacheMetrics: this.cache.metrics.snapshot(),
      catalogSize: this.engine.catalog.length,
      promptCache: this.promptEngine.cache.stats(),
    };
  }

  getPromptDebug(): PromptEngineDebugSnapshot | undefined {
    return this.promptEngine.getLastDebug();
  }

  clearCaches(): void {
    this.engine.clearCache();
    this.cache.responseCache.clear();
    this.cache.semanticCache.clear();
    this.cache.routingCache.clear();
    this.promptEngine.cache.invalidate();
  }

  async complete(req: SingularityCompleteRequest): Promise<SingularityCompleteResult> {
    const traceId = requestTracer.begin({
      sessionId: req.sessionId,
      source: 'SingularityAI.complete',
      promptHash: hashPromptForTrace(req.prompt),
    });
    const mark = (phase: TracePhase): void => requestTracer.mark(traceId, phase);
    try {
      return await this.completeInner(req, mark, traceId);
    } catch (err) {
      requestTracer.setMeta(traceId, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      requestTracer.finish(traceId, { ok: false });
      throw err;
    }
  }

  private async completeInner(
    req: SingularityCompleteRequest,
    mark: (phase: TracePhase) => void,
    traceId: string,
  ): Promise<SingularityCompleteResult> {
    const mode = req.mode ?? 'chat';
    const task = classifyTask(req.prompt);
    const routeCtx: RouteContext = {
      prompt: req.prompt,
      mode,
      language: req.language,
      openFileCount: req.openFileCount,
      requiresTools: req.requiresTools ?? task.preferTools,
      hasImages: req.hasImages,
      ...(req.modelId ? { modelId: req.modelId } : {}),
    };
    // Prefer Nemotron specialty understanding; sync keywords only if async fails.
    let decision: RouteDecision;
    mark('routing_started');
    try {
      decision = await this.engine.routeAsync(routeCtx);
    } catch {
      decision = this.engine.route(routeCtx);
    }
    mark('routing_finished');
    // Task classifier can nudge intent when confidence is high
    if (task.confidence >= 0.75 && task.taskClass !== 'general') {
      const classifiedIntent = taskClassToIntent(task.taskClass) as Intent;
      if (classifiedIntent && classifiedIntent !== decision.intent) {
        decision = {
          ...decision,
          intent: classifiedIntent,
        };
      }
    }

    const temperature = req.temperature ?? decision.temperature;
    const model = resolveModel(decision, req.modelId);
    const modelId = model.id;
    const context = buildContext(this.workspaceId, req.context);
    const cacheReq = toCacheRequest({
      prompt: req.prompt,
      mode,
      intent: decision.intent,
      modelId,
      temperature,
      context,
      requiresTools: req.requiresTools,
      hasImages: req.hasImages,
      cacheable: req.cacheable,
      providerKind: model.provider,
    });

    const lookup = await this.cache.lookup(cacheReq);
    if (lookup.hit) {
      requestTracer.setMeta(traceId, { fromCache: true, ok: true });
      requestTracer.finish(traceId, { ok: true });
      return {
        decision: { ...decision, model, fromCache: true },
        result: cachedResult(modelId, lookup.responseText),
        fromCache: true,
        cacheLayer: lookup.layer,
        prefixHints: lookup.prefixHints,
      };
    }

    const usePipeline =
      !req.skipPromptPipeline && (req.builderUpdate !== undefined || !req.messages);

    let messages: ChatMessage[];
    let promptMeta: SingularityCompleteResult['prompt'];
    let promptCacheKey: string | undefined;

    if (usePipeline) {
      const compiled = await this.compilePromptMessages(req, decision, model);
      messages = compiled.messages;
      promptMeta = compiled.prompt;
      promptCacheKey = compiled.prompt.rendered.cacheHints?.promptCacheKey;
      if (compiled.prompt.route) {
        routeCtx.requiresTools =
          routeCtx.requiresTools || compiled.prompt.route.requiresTools;
        routeCtx.hasImages = routeCtx.hasImages || compiled.prompt.route.hasImages;
      }
    } else {
      messages = req.messages ?? [
        { role: 'system' as const, content: decision.systemPromptHint },
        { role: 'user' as const, content: req.prompt },
      ];
    }

    const started = Date.now();
    const options: Omit<ChatCompletionOptions, 'model'> = {
      messages,
      temperature,
      maxTokens: decision.maxTokens,
      ...(req.signal ? { signal: req.signal } : {}),
      ...(promptCacheKey ? { promptCacheKey } : {}),
      ...(lookup.prefixHints.promptCacheKey && !promptCacheKey
        ? { promptCacheKey: lookup.prefixHints.promptCacheKey }
        : {}),
    };
    mark('model_request_started');
    const result = await this.adapter.complete(model, options);
    const text = result.choices[0]?.message.content ?? '';
    const tokenEstimate =
      result.usage?.totalTokens ??
      Math.max(1, Math.ceil((req.prompt.length + text.length) / 4));

    requestTracer.setMeta(traceId, {
      modelId: model.id,
      tier: decision.tier,
      intent: decision.intent,
      ok: true,
    });
    if (result.usage?.completionTokens) {
      requestTracer.addUsage(traceId, {
        completionTokens: result.usage.completionTokens,
      });
      requestTracer.setTokenFlow(
        traceId,
        result.usage.completionTokens,
        result.usage.completionTokens,
      );
    }
    requestTracer.finish(traceId, { ok: true });

    await this.cache.writeThrough(lookup, cacheReq, {
      responseText: text,
      tokenEstimate,
      confidence: 1,
      routingDecision: {
        modelId: model.id,
        tier: decision.tier,
        intent: decision.intent,
      },
      latencyMs: Date.now() - started,
      outcome: 'success',
    });

    let economy: ContextEconomyReport | undefined;
    if (promptMeta && this.promptEngine.getLastDebug()?.ir) {
      const ir = this.promptEngine.getLastDebug()!.ir;
      economy = buildEconomyReport({
        ir,
        prompt: req.prompt,
        modelId: model.id,
        tier: decision.tier,
        outputTokens: result.usage?.completionTokens,
        estimatedCostUsd: estimateCostUsd(model, result.usage?.promptTokens, result.usage?.completionTokens),
        fromCache: false,
        cachedPrefixTokens:
          result.usage?.cachedPromptTokens ??
          ir.blocks
            .filter((b) => b.cacheBreakpoint)
            .reduce((n, b) => n + (b.tokenCount || b.estimatedTokens), 0),
        filesIndexed: this.promptEngine.graph.listNodes('file').length,
      });
    }

    return {
      decision: { ...decision, model },
      result,
      fromCache: false,
      prefixHints: lookup.prefixHints,
      prompt: promptMeta,
      economy,
    };
  }

  /**
   * Streaming variant of `complete`. Reuses identical routing, caching, and
   * prompt pipeline; only the provider call differs (SSE). Falls back to a
   * single buffered delta when the provider lacks streaming support.
   */
  async *completeStream(
    req: SingularityCompleteRequest,
  ): AsyncIterable<{
    delta?: string;
    reasoningDelta?: string;
    modelId?: string;
    tokensUsed?: number;
    done?: boolean;
  }> {
    const traceId = requestTracer.begin({
      sessionId: req.sessionId,
      source: 'SingularityAI.completeStream',
      promptHash: hashPromptForTrace(req.prompt),
    });
    const mark = (phase: TracePhase): void => requestTracer.mark(traceId, phase);
    let model: ModelSpec | undefined;
    try {
      const mode = req.mode ?? 'chat';
      const task = classifyTask(req.prompt);
      const routeCtx: RouteContext = {
        prompt: req.prompt,
        mode,
        language: req.language,
        openFileCount: req.openFileCount,
        requiresTools: req.requiresTools ?? task.preferTools,
        hasImages: req.hasImages,
        ...(req.modelId ? { modelId: req.modelId } : {}),
      };
      mark('routing_started');
      let decision: RouteDecision;
      try {
        decision = await this.engine.routeAsync(routeCtx);
      } catch {
        decision = this.engine.route(routeCtx);
      }
      mark('routing_finished');
      // Honor an explicitly requested model on the streaming path, mirroring
      // complete(): resolveModel() pins the decision's model to req.modelId
      // when one is provided. Without this, a forced modelId is silently
      // ignored and the routed (possibly gateway-invalid) model is used.
      model = resolveModel(decision, req.modelId);
      requestTracer.setMeta(traceId, {
        modelId: model.id,
        tier: decision.tier,
        intent: decision.intent,
      });

      const usePipeline =
        !req.skipPromptPipeline && (req.builderUpdate !== undefined || !req.messages);
      let messages: ChatMessage[];
      let promptCacheKey: string | undefined;
      if (usePipeline) {
        const compiled = await this.compilePromptMessages(req, decision, model);
        messages = compiled.messages;
        promptCacheKey = compiled.prompt.rendered.cacheHints?.promptCacheKey;
      } else {
        messages = req.messages ?? [
          { role: 'system' as const, content: decision.systemPromptHint },
          { role: 'user' as const, content: req.prompt },
        ];
      }

      mark('model_request_started');
      let emitted = false;
      let usage: ChatCompletionResult['usage'] | undefined;
      let firstDeltaTs: number | undefined;
      for await (const ev of this.adapter.streamComplete(model, {
        messages,
        temperature: req.temperature ?? decision.temperature,
        maxTokens: decision.maxTokens,
        ...(req.signal ? { signal: req.signal } : {}),
        ...(promptCacheKey ? { promptCacheKey } : {}),
        // Chat/UI streaming rides the interactive lane: it must not queue
        // behind background worker LLM calls (which serialize at ~15s spacing
        // under the default 4 RPM), and its slot wait is bounded so a congested
        // gateway degrades to a visible fast failure instead of a silent
        // 10-minute "Evaluating".
        gateOptions: {
          lane: 'interactive' as const,
          slotTimeoutMs: interactiveSlotTimeoutMs(),
        },
      })) {
        if ((ev.delta || ev.reasoningDelta) && firstDeltaTs === undefined) {
          firstDeltaTs = Date.now();
          mark('first_token_received');
        }
        if (ev.usage) {
          usage = ev.usage;
        }
        if (ev.delta || ev.reasoningDelta) {
          emitted = true;
        }
        yield {
          ...(ev.delta ? { delta: ev.delta } : {}),
          ...(ev.reasoningDelta ? { reasoningDelta: ev.reasoningDelta } : {}),
          modelId: model.id,
          ...(ev.usage ? { tokensUsed: ev.usage.totalTokens } : {}),
        };
      }
      if (!emitted) {
        throw new ProviderError(`Empty stream from ${model.id}`);
      }

      if (usage) {
        requestTracer.addUsage(traceId, { completionTokens: usage.completionTokens });
        requestTracer.setTokenFlow(
          traceId,
          usage.completionTokens ?? 0,
          usage.completionTokens ?? 0,
        );
      }
      requestTracer.finish(traceId, { ok: true });
      yield { done: true, modelId: model.id, tokensUsed: usage?.totalTokens };
    } catch (err) {
      requestTracer.setMeta(traceId, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      requestTracer.finish(traceId, { ok: false });
      throw err;
    }
  }

  /**
   * Prompt Engine v2: graph → VM → IR → provider messages.
   */
  private async compilePromptMessages(
    req: SingularityCompleteRequest,
    decision: RouteDecision,
    model: ModelSpec,
  ): Promise<{ messages: ChatMessage[]; prompt: NonNullable<SingularityCompleteResult['prompt']> }> {
    const sessionId =
      req.sessionId ??
      req.context?.workspaceId ??
      this.workspaceId;
    const update = req.builderUpdate;

    const files = (update?.files ?? []).map((f) => ({
      uri: f.uri,
      content: f.content,
      version: f.version,
      languageId: f.languageId,
    }));

    const conversation =
      update?.conversation?.map((t) => ({
        id: t.id,
        role: t.role as 'user' | 'assistant' | 'system' | 'tool',
        content: t.content,
        createdAt: t.createdAt,
      })) ??
      req.messages?.map((m, i) => ({
        id: `msg-${i}`,
        role: m.role,
        content: m.content,
        createdAt: i,
      }));

    const pe = await this.promptEngine.run({
      sessionId,
      prompt: update?.userPrompt ?? req.prompt,
      systemPrompt: update?.systemPrompt ?? decision.systemPromptHint,
      intent: String(update?.intent ?? normalizePromptIntent(String(decision.intent))),
      provider: model.provider,
      conversation,
      files,
      budgetTokens: this.promptBudgetTokens,
      retrieval: {
        cursorUri: update?.currentFileUri ?? req.context?.activeUri,
        selectionText: update?.selection?.text,
        selectionUri: update?.selection?.uri,
        openFileUris: req.context?.openFiles,
        diagnostics: update?.diagnostics?.map((d) => ({
          uri: d.uri,
          message: d.message,
          severity: d.severity,
        })),
        gitDiff: undefined,
        agentState: update?.agent as Record<string, unknown> | undefined,
      },
    });

    if (update?.memories) {
      for (const m of update.memories) {
        this.promptEngine.memory.upsert({
          id: m.id,
          label: m.kind,
          scope: m.kind === 'user' ? 'user' : m.kind === 'project' ? 'project' : 'agent',
          content: m.text,
          priority: 5,
          importance: 0.6,
          tags: [m.kind],
          lastUsed: m.updatedAt,
        });
      }
    }

    const messages: ChatMessage[] = pe.rendered.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.providerExtras?.cache_control
        ? {
            cache_control: m.providerExtras.cache_control as { type: 'ephemeral' },
            providerExtras: m.providerExtras,
          }
        : m.providerExtras
          ? { providerExtras: m.providerExtras }
          : {}),
    }));

    // Prompt-prefix stability: register the stable (system/repository) prefix
    // body so provider KV-cache hits key on it; dynamic per-turn blocks are
    // already suffix-positioned by the IR compiler.
    const stablePrefix = pe.rendered.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    if (stablePrefix) {
      this.cache.prefixCache.register(stablePrefix, model.provider);
    }

    const fps = pe.fingerprint?.blockFingerprints ?? [];
    if (fps.length) {
      this.fingerprintHistory.record({
        sessionId,
        workspaceId: this.workspaceId,
        promptSha256: pe.fingerprint?.sha256 ?? pe.ir.irHash,
        recordedAt: Date.now(),
        blocks: fps.map((b) => ({
          blockId: b.blockId,
          role: b.role,
          contentSha256: b.contentSha256,
          tokenCount: b.tokenCount,
          cacheBreakpoint: b.cacheBreakpoint,
        })),
      });
    }

    return {
      messages,
      prompt: {
        irHash: pe.ir.irHash,
        fromIrCache: pe.fromCache,
        totalTokens: pe.ir.totalTokens,
        droppedSegmentIds: pe.ir.droppedSegmentIds,
        rendered: pe.rendered,
        route: pe.route,
        fingerprint: pe.fingerprint,
        blockFingerprints: pe.fingerprint?.blockFingerprints,
      },
    };
  }
}

export function createSingularityAI(config?: SingularityAIConfig): SingularityAI {
  return new SingularityAI(config);
}

/** Bounded slot wait for interactive-lane chat requests (env-overridable). */
function interactiveSlotTimeoutMs(): number {
  const raw = Number(process.env.SINGULARITY_LLM_SLOT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

function resolveModel(decision: RouteDecision, modelId?: string): ModelSpec {
  if (!modelId || modelId === decision.model.id) {
    return decision.model;
  }
  return findModel(DEFAULT_MODEL_CATALOG, modelId) ?? { ...decision.model, id: modelId };
}

function estimateCostUsd(
  model: ModelSpec,
  promptTokens?: number,
  completionTokens?: number,
): number {
  const inCost = model.costPer1MInput ?? 1;
  const outCost = model.costPer1MOutput ?? 3;
  return ((promptTokens ?? 0) * inCost + (completionTokens ?? 0) * outCost) / 1_000_000;
}

function createRouteDecisionCacheBridge(
  cache: CacheManager,
  _workspaceId: string,
): RouteDecisionCache {
  const adapter = cache.routingAdapter();
  return {
    get(key: string): RouteDecision | undefined {
      const decision = adapter.get(key);
      if (!decision || typeof decision !== 'object') {
        return undefined;
      }
      const full = decision['__full'];
      if (full && typeof full === 'object' && 'model' in (full as object)) {
        return full as RouteDecision;
      }
      return undefined;
    },
    set(key: string, decision: RouteDecision): void {
      adapter.set(key, {
        modelId: decision.model.id,
        tier: decision.tier,
        intent: decision.intent,
        fromCache: decision.fromCache,
        __full: decision,
      });
    },
    clear(): void {
      adapter.clear();
    },
  };
}

function buildContext(
  workspaceId: string,
  partial?: Partial<ContextFingerprintInput>,
): ContextFingerprintInput {
  return {
    openFiles: partial?.openFiles ?? [],
    activeUri: partial?.activeUri,
    selectionHash: partial?.selectionHash,
    diagnosticsHash: partial?.diagnosticsHash,
    gitDiffHash: partial?.gitDiffHash,
    terminalTailHash: partial?.terminalTailHash,
    clipboardHash: partial?.clipboardHash,
    imageIds: partial?.imageIds,
    toolOutputHashes: partial?.toolOutputHashes,
    settingsVersion: partial?.settingsVersion ?? '1',
    branch: partial?.branch ?? 'main',
    workspaceId: partial?.workspaceId ?? workspaceId,
    memoryDigest: partial?.memoryDigest,
    depsVersion: partial?.depsVersion,
  };
}

function toCacheRequest(parts: {
  prompt: string;
  mode: InteractionMode;
  intent: Intent;
  modelId: string;
  temperature: number;
  context: ContextFingerprintInput;
  requiresTools?: boolean;
  hasImages?: boolean;
  cacheable?: boolean;
  providerKind: CacheRequest['providerKind'];
}): CacheRequest {
  return {
    prompt: parts.prompt,
    mode: parts.mode as CacheInteractionMode,
    intent: parts.intent,
    modelId: parts.modelId,
    temperature: parts.temperature,
    context: parts.context,
    requiresTools: parts.requiresTools,
    hasImages: parts.hasImages,
    cacheable: parts.cacheable,
    providerKind: parts.providerKind,
  };
}

function cachedResult(modelId: string, content: string): ChatCompletionResult {
  return {
    id: `cache-${Date.now()}`,
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finishReason: 'stop',
      },
    ],
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };
}
