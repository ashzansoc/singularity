import {
  createSingularityAI,
  type ModelSpec,
  type RouteDecision,
  type SingularityAI,
  type SingularityAIConfig,
  type Tier,
} from '@singularity/router';
import { classifyTask } from '@singularity/router';
import type {
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmPort,
  LlmStreamDelta,
} from './ports.js';

export interface SingularityLlmPortOptions {
  /** Existing SingularityAI instance (preferred). */
  ai?: SingularityAI;
  /** Used when `ai` is omitted. */
  config?: SingularityAIConfig;
  /** Default session for prompt affinity. */
  sessionId?: string;
}

const TIER_ORDER: Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

/**
 * Models verified against TokenRouter (api.tokenrouter.com).
 * DeepSeek V4 Pro is disabled — Flash-0731 only. Gemini for vision only.
 */
const TOKENROUTER_TIER_MODELS: Record<Tier, readonly string[]> = {
  T0: [
    'deepseek/deepseek-v4-flash-0731',
    'google/gemini-2.5-flash',
  ],
  T1: [
    'deepseek/deepseek-v4-flash-0731',
  ],
  T2: [
    'deepseek/deepseek-v4-flash-0731',
    'google/gemini-2.5-flash',
  ],
  T3: [
    'deepseek/deepseek-v4-flash-0731',
  ],
  T4: [
    'deepseek/deepseek-v4-flash-0731',
  ],
  T5: [
    'deepseek/deepseek-v4-flash-0731',
  ],
  T6: [
    'deepseek/deepseek-v4-flash-0731',
  ],
};

/**
 * LlmPort backed by createSingularityAI with Context Economy prompt pipeline
 * for planner/worker (integrator stays lighter).
 */
export function createLlmPortFromSingularityAI(
  options: SingularityLlmPortOptions = {},
): LlmPort {
  const ai = options.ai ?? createSingularityAI(options.config);
  const lastDecisionByModel = new Map<string, RouteDecision>();

  const resolveCandidates = (
    req: LlmCompleteRequest,
  ): Array<{ modelId: string; decision: RouteDecision }> => {
    const mode = req.role === 'worker' ? 'agent' : 'chat';
    const task = classifyTask(req.prompt);
    const preferred =
      resolvePreferredTier(req) ??
      (task.tierHint.match(/T([0-6])/)
        ? (`T${task.tierHint.match(/T([0-6])/)![1]}` as Tier)
        : undefined);
    return buildCandidateModelIds(ai, req, preferred).map((modelId) => {
      const decisionTemplate = ai.engine.route({
        prompt: req.prompt.slice(0, 500),
        mode: mode as 'chat' | 'agent',
        requiresTools: task.preferTools,
        specialty:
          /deepseek\/deepseek-v4-pro/.test(modelId) ||
          /deepseek\/deepseek-v4-pro/.test(req.modelId ?? '')
            ? 'frontend'
            : undefined,
      });
      const decision =
        forceModel(ai, modelId, decisionTemplate) ?? decisionTemplate;
      lastDecisionByModel.set(decision.model.id, decision);
      return { modelId: decision.model.id, decision };
    });
  };

  return {
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      const mode = req.role === 'worker' ? 'agent' : 'chat';
      const task = classifyTask(req.prompt);
      const preferred =
        resolvePreferredTier(req) ??
        (task.tierHint.match(/T([0-6])/)
          ? (`T${task.tierHint.match(/T([0-6])/)![1]}` as Tier)
          : undefined);
      const candidates = buildCandidateModelIds(ai, req, preferred);

      const usePipeline =
        req.skipPromptPipeline !== true &&
        req.role !== 'integrator' &&
        (req.builderUpdate !== undefined || req.role === 'planner' || req.role === 'worker');

      let lastError: unknown;
      for (const modelId of candidates) {
        try {
          const decisionTemplate = ai.engine.route({
            prompt: req.prompt.slice(0, 500),
            mode: mode as 'chat' | 'agent',
            requiresTools: task.preferTools,
            specialty:
              /deepseek\/deepseek-v4-pro/.test(modelId) ||
              /deepseek\/deepseek-v4-pro/.test(req.modelId ?? '')
                ? 'frontend'
                : undefined,
          });
          const decision =
            forceModel(ai, modelId, decisionTemplate) ?? decisionTemplate;
          lastDecisionByModel.set(decision.model.id, decision);

          const result = await ai.complete({
            prompt: req.prompt,
            mode,
            modelId: decision.model.id,
            temperature: req.temperature ?? 0.2,
            sessionId: req.sessionId ?? options.sessionId,
            skipPromptPipeline: !usePipeline,
            ...(req.signal ? { signal: req.signal } : {}),
            builderUpdate: usePipeline
              ? {
                  userPrompt: req.prompt,
                  systemPrompt: req.systemPrompt,
                  intent: mapIntent(req.builderUpdate?.intent),
                  files: req.builderUpdate?.files,
                  conversation: req.builderUpdate?.conversation as
                    | import('@singularity/prompt').ConversationTurn[]
                    | undefined,
                  currentFileUri: req.builderUpdate?.currentFileUri,
                }
              : undefined,
            messages: usePipeline
              ? undefined
              : [
                  ...(req.systemPrompt
                    ? [{ role: 'system' as const, content: req.systemPrompt }]
                    : []),
                  { role: 'user' as const, content: req.prompt },
                ],
            cacheable: req.cacheable ?? req.role === 'planner',
          });

          const text = result.result.choices[0]?.message.content ?? '';
          if (!String(text).trim()) {
            throw Object.assign(
              new Error(`Empty completion from ${decision.model.id}`),
              { status: 503 },
            );
          }
          const usage = result.result.usage;
          const tokensUsed =
            (usage?.promptTokens ?? 0) +
            (usage?.completionTokens ?? Math.ceil(text.length / 4));

          return {
            text,
            modelId: result.decision.model.id,
            tokensUsed,
            tier: result.decision.tier,
          };
        } catch (err) {
          lastError = err;
          if (!isRetryableGatewayError(err)) {
            throw err;
          }
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError ?? 'All Runtime models failed'));
    },

    async *completeStream(
      req: LlmCompleteRequest,
    ): AsyncIterable<LlmStreamDelta> {
      const mode = req.role === 'worker' ? 'agent' : 'chat';
      const usePipeline =
        req.skipPromptPipeline !== true &&
        req.role !== 'integrator' &&
        (req.builderUpdate !== undefined || req.role === 'planner' || req.role === 'worker');

      const streamable =
        typeof (ai as { completeStream?: unknown }).completeStream === 'function';
      if (!streamable) {
        const result = await this.complete(req);
        yield { delta: result.text, modelId: result.modelId, tokensUsed: result.tokensUsed, done: true };
        return;
      }

      let lastError: unknown;
      for (const { modelId } of resolveCandidates(req)) {
        try {
          let emitted = false;
          for await (const ev of (
            ai as {
              completeStream(request: unknown): AsyncIterable<{
                delta?: string;
                reasoningDelta?: string;
                modelId?: string;
                tokensUsed?: number;
                done?: boolean;
              }>;
            }
          ).completeStream({
            prompt: req.prompt,
            mode,
            modelId,
            temperature: req.temperature ?? 0.2,
            sessionId: req.sessionId ?? options.sessionId,
            skipPromptPipeline: !usePipeline,
            ...(req.signal ? { signal: req.signal } : {}),
            builderUpdate: usePipeline
              ? {
                  userPrompt: req.prompt,
                  systemPrompt: req.systemPrompt,
                  intent: mapIntent(req.builderUpdate?.intent),
                  files: req.builderUpdate?.files,
                  conversation: req.builderUpdate?.conversation as
                    | import('@singularity/prompt').ConversationTurn[]
                    | undefined,
                  currentFileUri: req.builderUpdate?.currentFileUri,
                }
              : undefined,
            messages:
              usePipeline ||
              (req.skipPromptPipeline === true && req.systemPrompt !== undefined)
                ? undefined
                : [
                    ...(req.systemPrompt
                      ? [{ role: 'system' as const, content: req.systemPrompt }]
                      : []),
                    { role: 'user' as const, content: req.prompt },
                  ],
          })) {
            if (ev.delta || ev.reasoningDelta) {
              emitted = true;
            }
            yield ev;
          }
          if (!emitted) {
            throw Object.assign(
              new Error(`Empty stream from ${modelId}`),
              { status: 503 },
            );
          }
          return;
        } catch (err) {
          lastError = err;
          if (!isRetryableGatewayError(err)) {
            break;
          }
        }
      }

      // Streaming unavailable/failed — fall back to the buffered path so callers
      // still get output (behavior-preserving). Rate-limited runs skip the
      // fallback: an immediate buffered retry would just re-hammer a
      // throttled gateway (Phase 13 amplification rule).
      if (isRateLimitFailure(lastError)) {
        throw lastError;
      }
      try {
        const result = await this.complete(req);
        yield { delta: result.text, modelId: result.modelId, tokensUsed: result.tokensUsed, done: true };
      } catch (err) {
        throw lastError instanceof Error && !(err instanceof Error)
          ? lastError
          : err;
      }
    },

    async escalate(previousModelId, reason) {
      const previous =
        lastDecisionByModel.get(previousModelId) ??
        forceModel(
          ai,
          previousModelId,
          ai.engine.route({ prompt: 'escalate', mode: 'agent' }),
        );
      if (!previous) {
        return undefined;
      }
      const next = ai.engine.escalate(previous, reason);
      if (!next) {
        const idx = TIER_ORDER.indexOf(previous.tier);
        for (let i = idx + 1; i < TIER_ORDER.length; i++) {
          const id = TOKENROUTER_TIER_MODELS[TIER_ORDER[i]!]![0];
          if (id && id !== previousModelId) {
            return { modelId: id, tier: TIER_ORDER[i]! };
          }
        }
        return undefined;
      }
      const safe = TOKENROUTER_TIER_MODELS[next.tier]?.[0] ?? next.model.id;
      lastDecisionByModel.set(safe, forceModel(ai, safe, next) ?? next);
      return { modelId: safe, tier: next.tier };
    },
  };
}

function buildCandidateModelIds(
  ai: SingularityAI,
  req: LlmCompleteRequest,
  preferred: Tier | undefined,
): string[] {
  const out: string[] = [];
  const push = (id: string | undefined) => {
    if (id && !out.includes(id)) {
      out.push(id);
    }
  };

  if (req.modelId) {
    push(
      /deepseek-v4-pro/i.test(req.modelId)
        ? 'deepseek/deepseek-v4-flash-0731'
        : req.modelId,
    );
  }

  if (preferred) {
    for (const id of TOKENROUTER_TIER_MODELS[preferred] ?? []) {
      push(id);
    }
    const idx = TIER_ORDER.indexOf(preferred);
    for (const j of [idx - 1, idx + 1, idx - 2, idx + 2]) {
      if (j >= 0 && j < TIER_ORDER.length) {
        for (const id of TOKENROUTER_TIER_MODELS[TIER_ORDER[j]!] ?? []) {
          push(id);
        }
      }
    }
  }

  push('deepseek/deepseek-v4-flash-0731');
  push('google/gemini-2.5-flash');

  return out.filter(
    (id) =>
      ai.engine.catalog.some((m) => m.id === id) ||
      Object.values(TOKENROUTER_TIER_MODELS).some((list) => list.includes(id)),
  );
}

function resolvePreferredTier(req: LlmCompleteRequest): Tier | undefined {
  if (req.preferredTier) {
    return req.preferredTier;
  }
  if (req.role === 'planner' || req.role === 'integrator') {
    return 'T5';
  }
  if (req.role === 'worker') {
    return 'T3';
  }
  return undefined;
}

function isRateLimitFailure(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined;
  return status === 429 || /gateway error 429|429|rate.?limit|too many requests/i.test(msg);
}

function isRetryableGatewayError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const status =
    err && typeof err === 'object' && 'status' in err
      ? Number((err as { status?: number }).status)
      : undefined;
  if (status === 429 || /gateway error 429/.test(msg)) {
    return false; // rate-limited: model-hopping amplifies — handled by scheduler backoff
  }
  if (status === 400 || status === 404 || status === 503) {
    return true;
  }
  return /gateway error (400|404|503)|model_not_found|No available channel|invalid model|Empty completion/i.test(
    msg,
  );
}

function forceModel(
  ai: SingularityAI,
  modelId: string,
  template: RouteDecision,
): RouteDecision | undefined {
  let model: ModelSpec | undefined = ai.engine.catalog.find((m) => m.id === modelId);
  if (!model) {
    const tier = inferTierFromAllowlist(modelId) ?? template.tier;
    model = {
      ...template.model,
      id: modelId,
      displayName: modelId,
      tier,
      subTier: template.subTier,
    };
  }
  return {
    ...template,
    model,
    tier: model.tier,
    subTier: model.subTier,
    candidates: [
      { modelId: model.id, score: template.score, subTier: model.subTier },
      ...template.candidates.filter((c) => c.modelId !== model.id),
    ],
    fallbackChain: [
      ...template.fallbackChain.filter((id) => id !== modelId),
      ...ai.engine.catalog
        .filter((m) => m.id !== modelId)
        .map((m) => m.id)
        .slice(0, 6),
    ],
    fromCache: false,
  };
}

function inferTierFromAllowlist(modelId: string): Tier | undefined {
  for (const tier of TIER_ORDER) {
    if (TOKENROUTER_TIER_MODELS[tier]?.includes(modelId)) {
      return tier;
    }
  }
  return undefined;
}

function mapIntent(
  intent?: string,
):
  | 'EDIT'
  | 'DEBUG'
  | 'EXPLAIN'
  | 'REVIEW'
  | 'DOCUMENTATION'
  | 'AGENT'
  | 'PLAN'
  | 'TEST'
  | 'SEARCH'
  | 'ARCHITECTURE'
  | 'RENAME'
  | undefined {
  if (!intent) {
    return undefined;
  }
  const u = intent.toUpperCase();
  const allowed = new Set([
    'EDIT',
    'DEBUG',
    'EXPLAIN',
    'REVIEW',
    'DOCUMENTATION',
    'AGENT',
    'PLAN',
    'TEST',
    'SEARCH',
    'ARCHITECTURE',
    'RENAME',
  ]);
  if (allowed.has(u)) {
    return u as 'EDIT';
  }
  if (u === 'IMPLEMENT' || u === 'GENERAL') {
    return 'AGENT';
  }
  if (u === 'SUMMARY') {
    return 'DOCUMENTATION';
  }
  return 'AGENT';
}
