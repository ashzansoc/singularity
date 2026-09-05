import { TIER_RECOMMENDED_MODELS, DEFAULT_MODEL_CATALOG } from './models/catalog.js';
import { FRONTEND_OWNER_MODEL_ID } from './specialty.js';
import type { Intent, InteractionMode, SubTier, Tier } from './types.js';

export const DEFAULT_DECISION_MODEL = 'deepseek/deepseek-v4-flash-0731';

export interface LlmRouteRequest {
  prompt: string;
  mode?: InteractionMode;
  openFileCount?: number;
  hasImages?: boolean;
  contextTokens?: number;
}

export interface LlmRouteDecision {
  tier: Tier;
  subTier: SubTier;
  modelId: string;
  intent: Intent;
  confidence: number;
  reason: string;
  /** Wall time for the decision call. */
  latencyMs: number;
  source: 'llm' | 'rules' | 'timeout' | 'error';
  /** Specialty lane understood by Nemotron (frontend → DeepSeek Flash implementer). */
  specialty?: import('./specialty.js').SpecialtyLane;
}

export interface LlmDecisionEngineConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Default: inclusionai/ling-3.0-tiny:free */
  decisionModel?: string;
  /** Hard timeout — fall back to rules so chat never stalls. Default 600ms. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  appName?: string;
}

/**
 * Compact catalog card for the decision LLM (keep tiny for 90+ TPS models).
 */
function buildCatalogCard(): string {
  const lines: string[] = [];
  for (const m of DEFAULT_MODEL_CATALOG) {
    if (m.id.startsWith('local/')) {
      continue;
    }
    lines.push(
      `${m.subTier}|${m.id}|${m.primaryPurpose}|spd=${m.capabilities.speed}|code=${m.capabilities.coding}|reas=${m.capabilities.reasoning}|ctx=${m.capabilities.context}|vis=${m.capabilities.vision ? 1 : 0}`,
    );
  }
  return lines.join('\n');
}

const CATALOG_CARD = buildCatalogCard();

const SYSTEM_PROMPT = `You are Singularity's model router (Nemotron decision layer). Pick ONE model from the catalog for the user prompt.
Understand specialty intent beyond keywords.

Reply with ONLY compact JSON (no markdown):
{"tier":"T2","subTier":"T2.1","modelId":"deepseek/deepseek-v4-pro-0813","intent":"AGENT","confidence":0.9,"reason":"ui polish","specialty":"frontend"}

Rules:
- Greetings / hello / hi / thanks → T0.1 deepseek/deepseek-v4-flash-0731, specialty=general
- Autocomplete / one-line → T0.1 or T0.2 flash
- Frontend UI/React/CSS/dashboard/design polish → specialty=frontend AND modelId=deepseek/deepseek-v4-pro-0813 (Design Director runs separately in Runtime)
- Multi-lane SaaS (UI+API+AI) → specialty=general (do not force frontend owner)
- Explain / docs → T2.3 flash when cheap; Pro-0813 when long/coding follows
- Bugs / stack traces → T3.* deepseek/deepseek-v4-pro-0813
- Multi-file refactor / architecture → T5.* deepseek/deepseek-v4-pro-0813
- Images → google/gemini-2.5-flash (DeepSeek has no vision)
- Prefer DeepSeek Flash-0731 or Pro-0813 in almost all cases
- modelId MUST be an id from the catalog

Catalog (subTier|id|purpose|…):
${CATALOG_CARD}`;

/**
 * LLM decision engine powered by a high-TPS OpenRouter free model.
 * Always races against a hard timeout and falls back to deterministic rules.
 */
export class LlmDecisionEngine {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly decisionModel: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly appName: string;

  constructor(config: LlmDecisionEngineConfig = {}) {
    this.apiKey =
      config.apiKey ??
      process.env.OPENROUTER_API_KEY ??
      process.env.AI_GATEWAY_API_KEY ??
      '';
    this.baseUrl = (
      config.baseUrl ??
      process.env.OPENROUTER_BASE_URL ??
      'https://openrouter.ai/api/v1'
    ).replace(/\/$/, '');
    this.decisionModel =
      config.decisionModel ??
      process.env.SINGULARITY_DECISION_MODEL ??
      process.env.OPENROUTER_DECISION_MODEL ??
      DEFAULT_DECISION_MODEL;
    this.timeoutMs =
      config.timeoutMs ??
      (Number(process.env.SINGULARITY_DECISION_TIMEOUT_MS ?? process.env.OPENROUTER_DECISION_TIMEOUT_MS) ||
        10_000);
    this.fetchFn = config.fetch ?? fetch;
    this.appName = config.appName ?? 'Singularity Router';
  }

  /** Fast path for trivial prompts — skip network entirely. */
  tryInstant(req: LlmRouteRequest): LlmRouteDecision | undefined {
    const p = req.prompt.trim().toLowerCase();
    if (!p) {
      return undefined;
    }
    if (
      /^(hi|hello|hey|thanks|thank you|ok|okay|yo|sup|good\s*(morning|evening|night))[\s!.?]*$/i.test(
        p,
      )
    ) {
      return {
        tier: 'T0',
        subTier: 'T0.1',
        modelId: 'deepseek/deepseek-v4-flash-0731',
        intent: 'UNKNOWN',
        confidence: 1,
        reason: 'trivial-greeting',
        latencyMs: 0,
        source: 'rules',
      };
    }
    if (req.mode === 'autocomplete') {
      return {
        tier: 'T0',
        subTier: 'T0.1',
        modelId: 'deepseek/deepseek-v4-flash-0731',
        intent: 'AUTOCOMPLETE',
        confidence: 1,
        reason: 'autocomplete-mode',
        latencyMs: 0,
        source: 'rules',
      };
    }
    return undefined;
  }

  async decide(req: LlmRouteRequest): Promise<LlmRouteDecision> {
    const instant = this.tryInstant(req);
    if (instant) {
      return instant;
    }

    if (!this.apiKey) {
      return this.ruleFallback(req, 'error', 0);
    }

    const started = Date.now();
    try {
      const llm = await Promise.race([
        this.callLlm(req),
        sleepReject(this.timeoutMs, 'decision-timeout'),
      ]);
      return { ...llm, latencyMs: Date.now() - started, source: 'llm' };
    } catch (e) {
      const ms = Date.now() - started;
      const reason = e instanceof Error ? e.message : 'error';
      const source = reason.includes('timeout') ? 'timeout' : 'error';
      return this.ruleFallback(req, source, ms);
    }
  }

  private async callLlm(req: LlmRouteRequest): Promise<Omit<LlmRouteDecision, 'latencyMs' | 'source'>> {
    const user = JSON.stringify({
      prompt: req.prompt.slice(0, 1500),
      mode: req.mode ?? 'chat',
      openFiles: req.openFileCount ?? 0,
      images: Boolean(req.hasImages),
      ctxTokens: req.contextTokens ?? 0,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://singularity.local',
          'X-Title': this.appName,
        },
        body: JSON.stringify({
          model: this.decisionModel,
          temperature: 0,
          max_tokens: 80,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: user },
          ],
          provider: { allow_fallbacks: true },
        }),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`openrouter ${res.status}: ${text.slice(0, 200)}`);
      }
      const json = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? '';
      return parseDecision(content);
    } finally {
      clearTimeout(timer);
    }
  }

  private ruleFallback(
    req: LlmRouteRequest,
    source: LlmRouteDecision['source'],
    latencyMs: number,
  ): LlmRouteDecision {
    const p = req.prompt.toLowerCase();
    let tier: Tier = 'T1';
    let subTier: SubTier = 'T1.1';
    let intent: Intent = 'UNKNOWN';

    if (req.mode === 'autocomplete' || p.length < 40) {
      tier = 'T0';
      subTier = 'T0.1';
      intent = 'AUTOCOMPLETE';
    } else if (/\b(bug|error|stack|crash|fix|debug)\b/.test(p)) {
      tier = 'T3';
      subTier = 'T3.1';
      intent = 'DEBUG';
    } else if (/\b(explain|what|how|why)\b/.test(p)) {
      tier = 'T2';
      subTier = 'T2.1';
      intent = 'EXPLAIN';
    } else if (/\b(refactor|architect)\b/.test(p)) {
      tier = 'T5';
      subTier = 'T5.1';
      intent = 'REFACTOR';
    } else if (req.hasImages) {
      tier = 'T0';
      subTier = 'T0.4';
      intent = 'EXPLAIN';
    }

    const modelId =
      TIER_RECOMMENDED_MODELS[tier][Number(subTier.split('.')[1]) - 1] ??
      TIER_RECOMMENDED_MODELS[tier][0]!;

    return {
      tier,
      subTier,
      modelId,
      intent,
      confidence: 0.55,
      reason: `fallback:${source}`,
      latencyMs,
      source,
    };
  }
}

export function createLlmDecisionEngine(
  config?: LlmDecisionEngineConfig,
): LlmDecisionEngine {
  return new LlmDecisionEngine(config);
}

function parseDecision(content: string): Omit<LlmRouteDecision, 'latencyMs' | 'source'> {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('no-json');
  }
  const raw = JSON.parse(match[0]) as Partial<LlmRouteDecision> & { specialty?: string };
  let specialty = normalizeDecisionSpecialty(raw.specialty);
  let modelId = String(raw.modelId ?? '');
  if (specialty === 'frontend') {
    modelId = FRONTEND_OWNER_MODEL_ID;
  }
  const known = DEFAULT_MODEL_CATALOG.find((m) => m.id === modelId);
  if (!known) {
    const tier = specialty === 'frontend' ? 'T2' : ((raw.tier as Tier) || 'T0');
    const list = TIER_RECOMMENDED_MODELS[tier] ?? TIER_RECOMMENDED_MODELS.T0;
    return {
      tier,
      subTier: specialty === 'frontend' ? 'T2.1' : ((raw.subTier as SubTier) || 'T0.1'),
      modelId: specialty === 'frontend' ? FRONTEND_OWNER_MODEL_ID : list[0]!,
      intent: (raw.intent as Intent) || 'UNKNOWN',
      confidence: Number(raw.confidence ?? 0.5),
      reason: String(raw.reason ?? 'recovered'),
      specialty,
    };
  }
  return {
    tier: specialty === 'frontend' ? 'T0' : ((raw.tier as Tier) || known.tier),
    subTier: specialty === 'frontend' ? 'T0.2' : ((raw.subTier as SubTier) || known.subTier),
    modelId: known.id,
    intent: (raw.intent as Intent) || 'UNKNOWN',
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.8))),
    reason: String(raw.reason ?? 'llm'),
    specialty,
  };
}

function normalizeDecisionSpecialty(
  value: unknown,
): import('./specialty.js').SpecialtyLane {
  const v = String(value ?? 'general').toLowerCase().trim().replace(/_/g, '-');
  if (v === 'frontend') return 'frontend';
  if (v === 'backend') return 'backend';
  if (v === 'ai' || v === 'ai-pipeline') return 'ai-pipeline';
  if (v === 'infra' || v === 'infrastructure') return 'infrastructure';
  return 'general';
}

function sleepReject(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
