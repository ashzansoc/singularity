import { buildContextFingerprint } from './fingerprint.js';
import {
  buildResponseCacheKey,
  buildRouteCacheKey,
  fingerprintBucket,
  normalizePrompt,
} from './keys.js';
import { ContextCache } from './layers/context.js';
import { PromptPrefixCache } from './layers/prompt-prefix.js';
import { ResponseCache } from './layers/response.js';
import { createRoutingCacheAdapter, RoutingCache } from './layers/routing.js';
import { SemanticPromptCache } from './layers/semantic.js';
import { InMemoryMemoryHub, type MemoryHub } from './memory/hub.js';
import { CacheMetrics } from './metrics.js';
import { InvalidationController, type InvalidationEvent } from './invalidation.js';
import { MemoryStore } from './storage/memory.js';
import { SqliteStore } from './storage/sqlite.js';
import { HashEmbedder } from './storage/vector.js';
import {
  CACHEABLE_INTENTS,
  type CacheLookupResult,
  type CacheManagerConfig,
  type CacheMiss,
  type CacheRequest,
  type WriteThroughPayload,
} from './types.js';

const DEFAULT_PREFIX_BODY =
  'You are Singularity, an AI coding assistant. Follow user instructions carefully.';

export class CacheManager {
  readonly metrics = new CacheMetrics();
  readonly contextCache: ContextCache;
  readonly prefixCache: PromptPrefixCache;
  readonly semanticCache: SemanticPromptCache;
  readonly responseCache: ResponseCache;
  readonly routingCache: RoutingCache;
  readonly memory: MemoryHub;
  readonly invalidation: InvalidationController;

  private readonly workspaceId: string;
  private readonly templateVersion: string;
  private readonly refreshAfterMs: number;
  private readonly enableBackgroundRefresh: boolean;
  private readonly pendingRefresh = new Set<string>();

  constructor(config: CacheManagerConfig) {
    this.workspaceId = config.workspaceId;
    this.templateVersion = config.templateVersion ?? '1';
    this.refreshAfterMs = config.refreshAfterMs ?? 12 * 60 * 60_000;
    this.enableBackgroundRefresh = config.enableBackgroundRefresh ?? false;

    const durable =
      config.durableDir !== undefined
        ? new SqliteStore({ dir: config.durableDir })
        : new MemoryStore(config.maxMemoryEntries ?? 4096);
    const hot = new MemoryStore(config.maxMemoryEntries ?? 1024);

    this.contextCache = new ContextCache(hot);
    this.prefixCache = new PromptPrefixCache({
      prefixVersion: config.prefixVersion ?? '1',
    });
    this.semanticCache = new SemanticPromptCache({
      embedder: config.embedder ?? new HashEmbedder(),
      threshold: config.semanticThreshold,
      ttlMs: config.semanticTtlMs,
    });
    this.responseCache = new ResponseCache({
      store: durable,
      ttlMs: config.responseTtlMs,
    });
    this.routingCache = new RoutingCache({
      store: durable,
      ttlMs: config.routingTtlMs,
    });
    this.memory = new InMemoryMemoryHub();
    this.invalidation = new InvalidationController({
      templateVersion: this.templateVersion,
      prefixVersion: config.prefixVersion ?? '1',
      settingsVersion: '1',
      depsVersion: '1',
      branch: 'main',
      workspaceId: this.workspaceId,
    });
  }

  routingAdapter() {
    return createRoutingCacheAdapter(this.routingCache, this.workspaceId);
  }

  isCacheable(req: CacheRequest): boolean {
    if (req.forceCacheable) {
      return true;
    }
    if (req.temperature > 0) {
      return false;
    }
    const intentOk = (CACHEABLE_INTENTS as readonly string[]).includes(req.intent);
    if (req.cacheable === true && intentOk) {
      return true;
    }
    if (req.mode === 'agent' || req.requiresTools) {
      return false;
    }
    if (req.cacheable === false) {
      return false;
    }
    return intentOk || req.mode === 'chat' || req.mode === 'inline';
  }

  allowSemantic(req: CacheRequest): boolean {
    if (!this.isCacheable(req)) {
      return false;
    }
    if (req.requiresTools || req.mode === 'agent') {
      return false;
    }
    return (CACHEABLE_INTENTS as readonly string[]).includes(req.intent);
  }

  async lookup(req: CacheRequest): Promise<CacheLookupResult> {
    const versions = this.invalidation.getState();
    const context = {
      ...req.context,
      workspaceId: req.context.workspaceId || this.workspaceId,
      settingsVersion: req.context.settingsVersion || versions.settingsVersion,
      branch: req.context.branch || versions.branch,
      depsVersion: req.context.depsVersion ?? versions.depsVersion,
      memoryDigest: req.context.memoryDigest ?? this.memory.digest(),
    };

    const fingerprint = this.contextCache.fingerprint(context);
    const promptNormalized = normalizePrompt(req.prompt);
    const templateVersion = req.templateVersion ?? versions.templateVersion;
    const key = buildResponseCacheKey({
      templateVersion,
      modelId: req.modelId,
      temperature: req.temperature,
      fingerprint,
      promptNormalized,
      workspaceId: context.workspaceId,
    });
    const routeKey = buildRouteCacheKey({
      intent: req.intent,
      mode: req.mode,
      fpBucket: fingerprintBucket(fingerprint),
      hasImages: req.hasImages ?? false,
      requiresTools: req.requiresTools ?? false,
      promptNormalized,
      workspaceId: context.workspaceId,
    });
    const prefixHints = this.prefixCache.hintsFor(
      DEFAULT_PREFIX_BODY,
      req.providerKind ?? 'openrouter',
    );

    const cacheable = this.isCacheable(req);
    if (!cacheable) {
      this.metrics.recordMiss('L4');
      return {
        hit: false,
        fingerprint,
        key,
        prefixHints,
        routeKey,
        allowSemantic: false,
        cacheable: false,
      };
    }

    const exact = this.responseCache.get(key);
    if (exact) {
      this.metrics.recordHit('L4', exact.tokenEstimate);
      this.maybeBackgroundRefresh(req, key, exact.createdAt);
      return {
        hit: true,
        layer: 'L4',
        responseText: exact.responseText,
        confidence: exact.confidence,
        tokenEstimate: exact.tokenEstimate,
        fingerprint,
        key,
        routeKey,
        prefixHints,
        allowSemantic: this.allowSemantic(req),
        cacheable: true,
      };
    }
    this.metrics.recordMiss('L4');

    if (this.allowSemantic(req)) {
      const sem = await this.semanticCache.query({
        promptNormalized,
        mode: req.mode,
        intent: req.intent,
        fpBucket: fingerprintBucket(fingerprint),
        workspaceId: context.workspaceId,
        templateVersion,
      });
      if (sem) {
        this.metrics.recordHit('L3', sem.tokenEstimate);
        return {
          hit: true,
          layer: 'L3',
          responseText: sem.responseText,
          confidence: sem.confidence,
          tokenEstimate: sem.tokenEstimate,
          fingerprint,
          key,
          routeKey,
          prefixHints,
          allowSemantic: true,
          cacheable: true,
        };
      }
      this.metrics.recordMiss('L3');
    }

    const miss: CacheMiss = {
      hit: false,
      fingerprint,
      key,
      prefixHints,
      routeKey,
      allowSemantic: this.allowSemantic(req),
      cacheable: true,
    };
    return miss;
  }

  async writeThrough(
    lookup: CacheLookupResult,
    req: CacheRequest,
    payload: WriteThroughPayload,
  ): Promise<void> {
    const versions = this.invalidation.getState();
    const contextWs = req.context.workspaceId || this.workspaceId;
    const promptNormalized = normalizePrompt(req.prompt);
    const templateVersion = req.templateVersion ?? versions.templateVersion;
    const confidence = payload.confidence ?? 1;

    if (lookup.cacheable) {
      this.responseCache.set({
        key: lookup.key,
        modelId: req.modelId,
        promptNormalized,
        fingerprint: lookup.fingerprint,
        templateVersion,
        responseText: payload.responseText,
        confidence,
        tokenEstimate: payload.tokenEstimate,
        workspaceId: contextWs,
      });
      this.metrics.recordWrite();

      if (this.allowSemantic(req)) {
        await this.semanticCache.storeResponse(
          {
            promptNormalized,
            mode: req.mode,
            intent: req.intent,
            fpBucket: fingerprintBucket(lookup.fingerprint),
            workspaceId: contextWs,
            templateVersion,
          },
          payload.responseText,
          { confidence, tokenEstimate: payload.tokenEstimate },
        );
      }
    }

    if (payload.routingDecision || payload.outcome || payload.latencyMs !== undefined) {
      this.routingCache.recordOutcome(lookup.routeKey, contextWs, {
        decision: payload.routingDecision,
        latencyMs: payload.latencyMs,
        costUsd: payload.costUsd,
        qualityScore: payload.qualityScore,
        kind: payload.outcome ?? 'success',
      });
    }
  }

  invalidate(event: InvalidationEvent): void {
    const state = this.invalidation.apply(event);
    this.metrics.recordInvalidation();
    if (event.scope === 'provider_change') {
      this.prefixCache.setPrefixVersion(state.prefixVersion);
    }
    // Soft invalidation only — keys miss via version/fingerprint change.
    if (event.scope === 'workspace_change') {
      this.responseCache.clear();
      this.routingCache.clear();
      this.semanticCache.clear();
    }
  }

  /** Serve stale while optionally refreshing — no-op provider hook in v1. */
  backgroundRefresh(
    key: string,
    refresher: () => Promise<WriteThroughPayload | void>,
  ): void {
    if (!this.enableBackgroundRefresh || this.pendingRefresh.has(key)) {
      return;
    }
    this.pendingRefresh.add(key);
    void Promise.resolve()
      .then(() => refresher())
      .finally(() => {
        this.pendingRefresh.delete(key);
      });
  }

  private maybeBackgroundRefresh(
    req: CacheRequest,
    key: string,
    createdAt: number,
  ): void {
    if (!this.enableBackgroundRefresh) {
      return;
    }
    if (Date.now() - createdAt < this.refreshAfterMs) {
      return;
    }
    this.backgroundRefresh(key, async () => {
      // Caller may attach a real refresher later; placeholder marks intent.
      void req;
      return undefined;
    });
  }
}

export function createCacheManager(config: CacheManagerConfig): CacheManager {
  return new CacheManager(config);
}

/** Re-export fingerprint helper for callers that only need L1. */
export { buildContextFingerprint };
