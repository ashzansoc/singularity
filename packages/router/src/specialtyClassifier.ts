import { applySingularityBundledEnv } from './bundledEnv.js';
import {
  extractRetryAfterFromText,
  gateLlmRequest,
  noteRateLimited,
} from './rateLimit.js';
import { detectSpecialty, FRONTEND_OWNER_MODEL_ID, type SpecialtyLane } from './specialty.js';
import type { RouteFeatures } from './types.js';

export type SpecialtySource = 'llm' | 'rules' | 'explicit' | 'timeout' | 'error';

export interface SpecialtyClassification {
  specialty: SpecialtyLane;
  confidence: number;
  reason: string;
  source: SpecialtySource;
  latencyMs: number;
  /** When specialty is frontend, always DeepSeek V4 Flash-0731 (implementer) via TokenRouter. */
  modelId?: string;
}

export interface SpecialtyClassifierConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Default: nvidia/nemotron-3-ultra-550b-a55b:free */
  decisionModel?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** When false, skip network and use keyword rules only. */
  enabled?: boolean;
}

const SPECIALTY_SYSTEM = `You are Singularity's specialty classifier (Nemotron decision layer).
Decide which WORK LANE owns this user request. Understand intent — do not rely only on keywords.

Lanes:
- frontend → UI/React/CSS/pages/components/layouts/design/visual polish. Owner model: deepseek/deepseek-v4-flash-0731 via TokenRouter (Design Director is separate)
- backend → APIs, databases, auth servers, services
- ai-pipeline → LLM/RAG/embeddings/model inference jobs
- infrastructure → docker, k8s, CI/CD, deploy
- general → multi-lane product goals OR unclear / mixed ownership (planner will split)

Rules:
- "polish the landing page" / "make the dashboard less cluttered" → frontend (even without saying React)
- "wire Stripe webhooks" → backend
- "Build SaaS with UI + API + AI processing" → general (multi-lane)
- Pure questions about code with no build intent → general
- Prefer frontend when the user clearly wants UI work and nothing else

Reply with ONLY JSON (no markdown):
{"specialty":"frontend","confidence":0.92,"reason":"short why","modelId":"deepseek/deepseek-v4-flash-0731"}

When specialty is frontend, modelId MUST be "deepseek/deepseek-v4-flash-0731".
Otherwise omit modelId or set null.`;

const LANES: readonly SpecialtyLane[] = [
  'frontend',
  'backend',
  'ai-pipeline',
  'infrastructure',
  'general',
];

// P2 — decision-model resilience. A hard credential/quota failure (401/402/403)
// cannot heal within seconds; probing it on every request stalls each call for
// the full timeout. After such a failure we skip the hop for a cooldown
// window and let keyword rules answer immediately.
let decisionCooldownUntil = 0;

function decisionCooldownMs(): number {
  const raw = Number(process.env.SINGULARITY_DECISION_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 300_000;
}

/** True while the decision model is considered down (cooldown active). */
export function decisionModelCoolingDown(): boolean {
  return Date.now() < decisionCooldownUntil;
}

/** Clear the cooldown (new credentials wired, manual retry, tests). */
export function resetDecisionModelHealth(): void {
  decisionCooldownUntil = 0;
}

function noteDecisionModelOutcome(message: string): void {
  if (/specialty-llm 429\b/.test(message)) {
    noteRateLimited(extractRetryAfterFromText(message));
    return;
  }
  if (/specialty-llm (401|402|403)\b/.test(message)) {
    decisionCooldownUntil = Math.max(
      decisionCooldownUntil,
      Date.now() + decisionCooldownMs(),
    );
  }
}

/**
 * Ask Nemotron to understand specialty; fall back to keyword heuristics on
 * timeout / error / disabled. Explicit specialty always wins.
 */
export async function classifySpecialty(
  prompt: string,
  options: {
    features?: RouteFeatures;
    explicit?: SpecialtyLane;
    config?: SpecialtyClassifierConfig;
  } = {},
): Promise<SpecialtyClassification> {
  if (options.explicit) {
    return {
      specialty: options.explicit,
      confidence: 1,
      reason: 'explicit-override',
      source: 'explicit',
      latencyMs: 0,
      modelId:
        options.explicit === 'frontend' ? FRONTEND_OWNER_MODEL_ID : undefined,
    };
  }

  applySingularityBundledEnv();
  const cfg = options.config ?? {};
  const underTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  // Explicit fetch/apiKey in config means the caller wants the LLM path (tests + custom wiring).
  const explicitlyConfigured = cfg.enabled === true || Boolean(cfg.fetch) || Boolean(cfg.apiKey);
  const enabled =
    cfg.enabled ??
    (explicitlyConfigured ||
      (!underTest &&
        process.env.SINGULARITY_LLM_ROUTER !== '0' &&
        process.env.SINGULARITY_SPECIALTY_LLM !== '0'));

  if (!enabled) {
    return rulesFallback(prompt, options.features, 'rules', 0);
  }

  const apiKey =
    cfg.apiKey ??
    process.env.SINGULARITY_DECISION_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    '';
  if (!apiKey) {
    return rulesFallback(prompt, options.features, 'error', 0);
  }

  // P2: a known-dead credential must not cost every request its timeout —
  // fail fast to rules while the cooldown is active.
  if (decisionModelCoolingDown()) {
    return rulesFallback(prompt, options.features, 'error', 0);
  }

  const baseUrl = (
    cfg.baseUrl ??
    process.env.SINGULARITY_DECISION_BASE_URL ??
    process.env.OPENROUTER_BASE_URL ??
    'https://openrouter.ai/api/v1'
  ).replace(/\/$/, '');
  const model =
    cfg.decisionModel ??
    process.env.SINGULARITY_DECISION_MODEL ??
    process.env.OPENROUTER_DECISION_MODEL ??
    'nvidia/nemotron-3-ultra-550b-a55b:free';
  const timeoutMs =
    cfg.timeoutMs ??
    (Number(process.env.SINGULARITY_DECISION_TIMEOUT_MS ?? 2_500) || 2_500);
  const fetchFn = cfg.fetch ?? fetch;

  const started = Date.now();
  try {
    // The shared rate gate must respect this hop's deadline: queue waits count
    // against the budget, and an expired probe releases the queue promptly.
    const gateSignal = new AbortController();
    const gateTimer = setTimeout(() => gateSignal.abort(), timeoutMs);
    let parsed;
    try {
      parsed = await gateLlmRequest(
        () =>
          callSpecialtyLlm({
            fetchFn,
            baseUrl,
            apiKey,
            model,
            timeoutMs,
            prompt,
          }),
        gateSignal.signal,
      );
    } finally {
      clearTimeout(gateTimer);
    }
    return {
      ...parsed,
      latencyMs: Date.now() - started,
      source: 'llm',
      modelId:
        parsed.specialty === 'frontend'
          ? FRONTEND_OWNER_MODEL_ID
          : parsed.modelId,
    };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    noteDecisionModelOutcome(msg);
    const source: SpecialtySource =
      msg.includes('timeout') || /abort/i.test(msg) ? 'timeout' : 'error';
    return rulesFallback(prompt, options.features, source, ms);
  }
}

function rulesFallback(
  prompt: string,
  features: RouteFeatures | undefined,
  source: SpecialtySource,
  latencyMs: number,
): SpecialtyClassification {
  const specialty = detectSpecialty(prompt, features);
  return {
    specialty,
    confidence: source === 'rules' ? 0.7 : 0.55,
    reason: `keyword-fallback:${source}`,
    source,
    latencyMs,
    modelId: specialty === 'frontend' ? FRONTEND_OWNER_MODEL_ID : undefined,
  };
}

async function callSpecialtyLlm(args: {
  fetchFn: typeof fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  prompt: string;
}): Promise<Omit<SpecialtyClassification, 'latencyMs' | 'source'>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await args.fetchFn(`${args.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://singularity.local',
        'X-Title': 'Singularity Specialty Classifier',
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: 'system', content: SPECIALTY_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              prompt: args.prompt.slice(0, 2000),
              ask: 'Classify specialty lane. Understand intent beyond keywords.',
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`specialty-llm ${res.status}: ${text.slice(0, 180)}`);
    }
    const json = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }>;
    };
    const content = (
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.message?.reasoning ??
      ''
    ).toString();
    if (!content.trim()) {
      throw new Error('empty-specialty-content');
    }
    return parseSpecialtyContent(content);
  } finally {
    clearTimeout(timer);
  }
}

export function parseSpecialtyContent(
  content: string,
): Omit<SpecialtyClassification, 'latencyMs' | 'source'> {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) {
    throw new Error('no-specialty-json');
  }
  const raw = JSON.parse(m[0]) as Record<string, unknown>;
  const specialty = normalizeSpecialty(String(raw.specialty ?? 'general'));
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0.8)));
  return {
    specialty,
    confidence,
    reason: String(raw.reason ?? 'llm'),
    modelId: specialty === 'frontend' ? FRONTEND_OWNER_MODEL_ID : undefined,
  };
}

function normalizeSpecialty(value: string): SpecialtyLane {
  const v = value.toLowerCase().trim().replace(/_/g, '-');
  if (v === 'ai' || v === 'ml' || v === 'ai-pipeline') return 'ai-pipeline';
  if (v === 'infra' || v === 'infrastructure') return 'infrastructure';
  if ((LANES as readonly string[]).includes(v)) {
    return v as SpecialtyLane;
  }
  return 'general';
}
