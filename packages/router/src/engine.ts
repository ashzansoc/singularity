import { buildCacheKey, InMemoryRouteCache, shouldCacheRoute } from './cache.js';
import { extractFeatures } from './features.js';
import { buildFallbackChain, escalateDecision } from './fallback.js';
import { buildRequirements, CapabilityFilter } from './filter.js';
import { RuleIntentClassifier } from './intent/classifier.js';
import { DEFAULT_MODEL_CATALOG, findModel } from './models/catalog.js';
import { scoreCandidates } from './score.js';
import {
  FRONTEND_OWNER_MODEL_ID,
  FRONTEND_SYSTEM_HINT,
  isFrontendSpecialty,
  specialtyFromContext,
  type SpecialtyLane,
} from './specialty.js';
import {
  classifySpecialty,
  type SpecialtyClassifierConfig,
} from './specialtyClassifier.js';
import {
  getSpecialtyMemo,
  setSpecialtyMemo,
  specialtyMemoKey,
} from './specialtyMemo.js';
import { detectSpecialty } from './specialty.js';
import {
  decideFlashOrPro,
  FLASH_MODEL_ID,
  PRO_MODEL_ID,
} from './nemotronFlashPro/index.js';
import { emitTelemetry } from './telemetry.js';
import {
  INTENT_MAX_TOKENS,
  INTENT_SYSTEM_HINT,
  INTENT_TEMPERATURE,
  resolveToolPermissions,
} from './tiers.js';
import type {
  FallbackReason,
  RouteContext,
  RouteDecision,
  RouteDecisionCache,
  RoutingEngineConfig,
  TelemetryEvent,
} from './types.js';

export class RoutingEngine {
  private readonly models: import('./types.js').ModelSpec[];
  private readonly cache: InMemoryRouteCache | RouteDecisionCache;
  private readonly classifier: RuleIntentClassifier;
  private readonly filter: CapabilityFilter;
  private readonly userPreferenceModelIds: string[];
  private readonly onTelemetry?: (event: TelemetryEvent) => void;
  private readonly specialtyClassifier?: SpecialtyClassifierConfig;

  constructor(config: RoutingEngineConfig = {}) {
    this.models = config.models ?? [...DEFAULT_MODEL_CATALOG];
    this.cache =
      config.routeCache ?? new InMemoryRouteCache(config.cacheTtlMs ?? 60_000);
    this.onTelemetry = config.onTelemetry;
    this.classifier = new RuleIntentClassifier(config.onTelemetry);
    this.filter = new CapabilityFilter(config.onTelemetry);
    this.userPreferenceModelIds = config.userPreferenceModelIds ?? [];
    this.specialtyClassifier = config.specialtyClassifier;
  }

  get catalog(): readonly import('./types.js').ModelSpec[] {
    return this.models;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Sync route — keyword specialty heuristics (fast path / tests).
   * Prefer {@link routeAsync} in production so Nemotron understands intent.
   */
  route(ctx: RouteContext): RouteDecision {
    const features = extractFeatures(ctx);
    const specialty = specialtyFromContext(ctx, features);
    return this.routeWithSpecialty(ctx, features, specialty, 'rules');
  }

  /**
   * Async route — Nemotron specialty classifier understands intent,
   * keywords only as fallback on timeout/error.
   *
   * Perf: the classification is memoized (60s TTL) and skipped entirely when
   * the caller forces a model/tier — a forced model makes the lane decision
   * moot, so the network hop buys nothing. `SINGULARITY_INLINE_CLASSIFIER=1`
   * restores the legacy always-classify behavior.
   */
  async routeAsync(ctx: RouteContext): Promise<RouteDecision> {
    const features = extractFeatures(ctx);
    const inlineClassifier = process.env.SINGULARITY_INLINE_CLASSIFIER === '1';
    const parallelClassifier = process.env.SINGULARITY_PARALLEL_CLASSIFIER === '1';
    const forced =
      Boolean(ctx.modelId) || Boolean(ctx.preferredTier);
    let classified: Awaited<ReturnType<typeof classifySpecialty>>;
    if (!inlineClassifier && forced) {
      // Zero network: forced model/tier already pins the lane outcome.
      classified = specialtyFromFeatures(ctx, features);
    } else {
      const memoKey = specialtyMemoKey(ctx.prompt);
      const memoized = !inlineClassifier ? getSpecialtyMemo(memoKey) : undefined;
      if (memoized) {
        classified = memoized;
      } else if (parallelClassifier && !inlineClassifier) {
        // Route this turn instantly on the deterministic keyword specialty
        // (identical to class. 'rules' fallback), then warm the Nemotron LLM
        // classification in the background so the NEXT turn routes on it.
        // This removes the serial 2.5s LLM hop from this turn's TTFT without
        // removing routing: the LLM still classifies and refines subsequent
        // turns, and routing architecture stays authoritative.
        classified = specialtyFromFeatures(ctx, features);
        void classifySpecialty(ctx.prompt, {
          features,
          explicit: ctx.specialty,
          config: this.specialtyClassifier,
        }).then((llm) => {
          if (llm?.source === 'llm') {
            setSpecialtyMemo(memoKey, llm);
          }
        }).catch(() => {
          /* background classification is best-effort */
        });
      } else {
        classified = await classifySpecialty(ctx.prompt, {
          features,
          explicit: ctx.specialty,
          config: this.specialtyClassifier,
        });
        setSpecialtyMemo(memoKey, classified);
      }
    }
    const decision = this.routeWithSpecialty(
      ctx,
      features,
      classified.specialty,
      classified.source === 'llm' ? 'nemotron' : classified.source,
    );
    const withLocal = await this.applyFlashProRouter(ctx.prompt, decision);
    return {
      ...withLocal,
      intentConfidence: Math.max(withLocal.intentConfidence, classified.confidence),
      specialty: classified.specialty,
    };
  }

  /**
   * Overlay Nemotron flash/pro (system + this prompt only, no history).
   */
  private async applyFlashProRouter(
    prompt: string,
    decision: RouteDecision,
  ): Promise<RouteDecision> {
    try {
      const local = await decideFlashOrPro(prompt);
      if (local.source !== 'llm') {
        return decision;
      }
      const model = findModel(this.models, local.modelId)
        ?? findModel(this.models, local.choice === 'pro' ? PRO_MODEL_ID : FLASH_MODEL_ID);
      if (!model) {
        return decision;
      }
      return {
        ...decision,
        model,
        tier: local.choice === 'pro' ? 'T2' : 'T0',
        subTier: local.choice === 'pro' ? 'T2.1' : 'T0.1',
        systemPromptHint: `${decision.systemPromptHint}\nNemotron router: ${local.choice}`,
      };
    } catch {
      return decision;
    }
  }

  private routeWithSpecialty(
    ctx: RouteContext,
    features: ReturnType<typeof extractFeatures>,
    specialty: SpecialtyLane,
    specialtySource: string,
  ): RouteDecision {
    const classification = this.classifier.classify(features);
    const { intent, confidence } = classification;

    const prefs = [
      ...this.userPreferenceModelIds,
      ...(ctx.userPreferenceModelIds ?? []),
    ];

    const cacheable = shouldCacheRoute(features.mode, features.requiresTools);
    const contextBucket = Math.floor(features.contextTokens / 16_000);
    const cacheKey = buildCacheKey({
      intent,
      mode: features.mode,
      promptCharCount: features.promptCharCount,
      hasImages: features.hasImages,
      requiresTools: features.requiresTools,
      contextBucket,
    });

    if (cacheable) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        emitTelemetry(this.onTelemetry, {
          type: 'cache_hit',
          payload: { cacheKey, modelId: cached.model.id, intent },
        });
        return { ...cached, specialty: cached.specialty ?? specialty };
      }
    }

    const requirements = buildRequirements(intent, features);
    let candidates = this.filter.filter(this.models, requirements);

    if (candidates.length === 0) {
      candidates = this.filter.filter(this.models, {
        ...requirements,
        minTier: 'T0',
      });
    }
    if (candidates.length === 0) {
      candidates = [...this.models];
    }

    // Frontend-owner model is never a candidate unless specialty is frontend.
    if (!isFrontendSpecialty(specialty)) {
      const nonOwner = candidates.filter((m) => m.id !== FRONTEND_OWNER_MODEL_ID);
      // Guard: never empty the candidate pool (single-model catalogs would crash).
      candidates = nonOwner.length > 0 ? nonOwner : candidates;
    }

    if (isFrontendSpecialty(specialty)) {
      // Flash implements UI; when the turn includes images, prefer vision-capable Pro
      // (Design Director / critic / screenshot explain) instead of blind Flash.
      let owner = findModel(this.models, FRONTEND_OWNER_MODEL_ID);
      if (features.hasImages && owner && !owner.capabilities.vision) {
        owner =
          findModel(this.models, 'google/gemini-2.5-flash') ??
          findModel(this.models, 'deepseek/deepseek-v4-flash-0731') ??
          this.models.find((m) => m.capabilities.vision) ??
          owner;
      }
      if (owner) {
        const scoredRest = scoreCandidates(
          candidates.filter((m) => m.id !== owner!.id),
          {
            intent,
            features,
            targetTier: requirements.minTier,
            userPreferenceModelIds: prefs,
            lowConfidence: confidence < 0.4,
          },
        );
        const fallbackChain = buildFallbackChain(owner, scoredRest, this.models);
        const decision: RouteDecision = {
          model: owner,
          tier: owner.tier,
          subTier: owner.subTier,
          intent,
          intentConfidence: confidence,
          temperature: INTENT_TEMPERATURE[intent],
          maxTokens: Math.min(
            INTENT_MAX_TOKENS[intent],
            features.estimatedOutputTokens * 2 || INTENT_MAX_TOKENS[intent],
          ),
          systemPromptHint: `${FRONTEND_SYSTEM_HINT}\n${INTENT_SYSTEM_HINT[intent]}`,
          toolPermissions: resolveToolPermissions(intent, features.requiresTools),
          score: 1,
          candidates: [
            { modelId: owner.id, score: 1, subTier: owner.subTier },
            ...scoredRest.slice(0, 7).map((s) => ({
              modelId: s.model.id,
              score: s.score,
              subTier: s.model.subTier,
            })),
          ],
          fallbackChain,
          fromCache: false,
          specialty,
        };

        if (cacheable) {
          this.cache.set(cacheKey, decision);
        }

        emitTelemetry(this.onTelemetry, {
          type: 'route',
          payload: {
            intent,
            confidence,
            modelId: decision.model.id,
            tier: decision.tier,
            subTier: decision.subTier,
            score: decision.score,
            matchedRule: `specialty:frontend:${specialtySource}`,
            candidateCount: decision.candidates.length,
            specialty,
            specialtySource,
          },
        });

        return decision;
      }
    }

    const scored = scoreCandidates(candidates, {
      intent,
      features,
      targetTier: requirements.minTier,
      userPreferenceModelIds: prefs,
      lowConfidence: confidence < 0.4,
    });

    const winner = scored[0];
    if (!winner) {
      emitTelemetry(this.onTelemetry, {
        type: 'route',
        payload: { intent, confidence, error: 'no_candidates', specialty, specialtySource },
      });
      throw new Error(
        `Routing failed: no candidate models available (catalog size: ${this.models.length}). ` +
          'Provide RoutingEngineConfig.models or restore DEFAULT_MODEL_CATALOG.',
      );
    }
    const fallbackChain = buildFallbackChain(winner.model, scored.slice(1), this.models);

    const decision: RouteDecision = {
      model: winner.model,
      tier: requirements.minTier,
      subTier: winner.model.subTier,
      intent,
      intentConfidence: confidence,
      temperature: INTENT_TEMPERATURE[intent],
      maxTokens: Math.min(
        INTENT_MAX_TOKENS[intent],
        features.estimatedOutputTokens * 2 || INTENT_MAX_TOKENS[intent],
      ),
      systemPromptHint: INTENT_SYSTEM_HINT[intent],
      toolPermissions: resolveToolPermissions(intent, features.requiresTools),
      score: winner.score,
      candidates: scored.slice(0, 8).map((s) => ({
        modelId: s.model.id,
        score: s.score,
        subTier: s.model.subTier,
      })),
      fallbackChain,
      fromCache: false,
      specialty,
    };

    if (cacheable) {
      this.cache.set(cacheKey, decision);
    }

    emitTelemetry(this.onTelemetry, {
      type: 'route',
      payload: {
        intent,
        confidence,
        modelId: decision.model.id,
        tier: decision.tier,
        subTier: decision.subTier,
        score: decision.score,
        matchedRule: classification.matchedRule,
        candidateCount: scored.length,
        specialty,
        specialtySource,
      },
    });

    return decision;
  }

  escalate(decision: RouteDecision, reason: FallbackReason): RouteDecision | undefined {
    const next = escalateDecision(decision, this.models, reason);
    if (next) {
      emitTelemetry(this.onTelemetry, {
        type: 'escalate',
        payload: {
          reason,
          from: decision.model.id,
          to: next.model.id,
          remaining: next.fallbackChain.length,
        },
      });
    }
    return next;
  }

  getModel(id: string): import('./types.js').ModelSpec | undefined {
    return findModel(this.models, id);
  }
}

/**
 * Zero-network specialty classification (keyword rules only). Used when the
 * caller forces a model/tier so the lane outcome is already pinned.
 */
function specialtyFromFeatures(
  ctx: RouteContext,
  features: ReturnType<typeof extractFeatures>,
): import('./specialtyClassifier.js').SpecialtyClassification {
  const specialty = ctx.specialty ?? detectSpecialty(ctx.prompt, features);
  return {
    specialty,
    confidence: 0.7,
    reason: ctx.specialty ? 'explicit-override' : 'forced-model-skip',
    source: ctx.specialty ? 'explicit' : 'rules',
    latencyMs: 0,
  };
}

export function createRoutingEngine(config: RoutingEngineConfig = {}): RoutingEngine {
  return new RoutingEngine(config);
}
