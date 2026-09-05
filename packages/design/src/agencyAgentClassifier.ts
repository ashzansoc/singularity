/**
 * Classify which design-lane agency agent should own Spec generation.
 */

import {
  DEFAULT_AGENCY_SKILL_ID,
  formatAgencyCatalogForClassifier,
  listAgencySkills,
  type AgencySkillCatalogEntry,
} from './agencySkill.js';

export type AgencyAgentSource = 'llm' | 'rules' | 'explicit' | 'timeout' | 'error';

export interface AgencyAgentClassification {
  skillId: string;
  confidence: number;
  reason: string;
  source: AgencyAgentSource;
  latencyMs: number;
}

export interface AgencyAgentClassifierConfig {
  apiKey?: string;
  baseUrl?: string;
  decisionModel?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  enabled?: boolean;
  /** Override catalog (tests). */
  catalog?: AgencySkillCatalogEntry[];
}

const CLASSIFIER_SYSTEM = `You are Singularity's agency-agent classifier for frontend/design work.
Pick ONE agency skill id that should own art direction for the user's request.

Reply with ONLY JSON (no markdown):
{"skillId":"design-ui-designer","confidence":0.9,"reason":"short why"}

Prefer:
- visual UI / branding / look-and-feel → design-ui-designer or design-brand-guardian
- UX flows / IA / product structure → design-ux-architect
- research / personas / user studies → design-ux-researcher or design-persona-walkthrough
- whimsy / delight / playful microcopy → design-whimsy-injector
- storytelling / narrative visuals → design-visual-storyteller
- inclusive / accessible imagery → design-inclusive-visuals-specialist
- image generation prompts → design-image-prompt-engineer
- polish / finish-gate review → design-ui-finish-gate-reviewer
- implement-heavy React/CSS coding (less art direction) → engineering-frontend-developer
Default when unclear: design-ui-designer.`;

/**
 * Ask the decision LLM which agency skill fits; fall back to keyword rules.
 */
export async function classifyAgencyAgent(
  prompt: string,
  options: {
    explicit?: string;
    config?: AgencyAgentClassifierConfig;
  } = {},
): Promise<AgencyAgentClassification> {
  const catalog = options.config?.catalog ?? listAgencySkills();
  const validIds = new Set(catalog.map((s) => s.id));

  if (options.explicit && validIds.has(options.explicit)) {
    return {
      skillId: options.explicit,
      confidence: 1,
      reason: 'explicit-override',
      source: 'explicit',
      latencyMs: 0,
    };
  }

  const cfg = options.config ?? {};
  const underTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  const explicitlyConfigured =
    cfg.enabled === true || Boolean(cfg.fetch) || Boolean(cfg.apiKey);
  const enabled =
    cfg.enabled ??
    (explicitlyConfigured ||
      (!underTest &&
        process.env.SINGULARITY_LLM_ROUTER !== '0' &&
        process.env.SINGULARITY_AGENCY_AGENT_LLM !== '0'));

  if (!enabled) {
    return rulesFallbackAgencyAgent(prompt, catalog, 'rules', 0);
  }

  const apiKey =
    cfg.apiKey ??
    process.env.SINGULARITY_DECISION_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    '';
  if (!apiKey) {
    return rulesFallbackAgencyAgent(prompt, catalog, 'error', 0);
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
    const parsed = await Promise.race([
      callAgencyAgentLlm({
        fetchFn,
        baseUrl,
        apiKey,
        model,
        timeoutMs,
        prompt,
        catalog,
        validIds,
      }),
      sleepReject(timeoutMs, 'agency-agent-timeout'),
    ]);
    return {
      ...parsed,
      latencyMs: Date.now() - started,
      source: 'llm',
    };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    const source: AgencyAgentSource = msg.includes('timeout') ? 'timeout' : 'error';
    return rulesFallbackAgencyAgent(prompt, catalog, source, ms);
  }
}

export function rulesFallbackAgencyAgent(
  prompt: string,
  catalog: AgencySkillCatalogEntry[] = listAgencySkills(),
  source: AgencyAgentSource = 'rules',
  latencyMs = 0,
): AgencyAgentClassification {
  const valid = new Set(catalog.map((s) => s.id));
  const pick = (id: string, reason: string, confidence: number): AgencyAgentClassification => ({
    skillId: valid.has(id) ? id : DEFAULT_AGENCY_SKILL_ID,
    confidence,
    reason,
    source,
    latencyMs,
  });

  const p = prompt.toLowerCase();

  if (/\b(whimsy|delight|playful|fun micro|easter egg|joy)\b/.test(p)) {
    return pick('design-whimsy-injector', 'keyword:whimsy', 0.75);
  }
  if (/\b(storytell|narrative visual|visual story)\b/.test(p)) {
    return pick('design-visual-storyteller', 'keyword:story', 0.75);
  }
  if (/\b(inclusive|diversity|representation|accessible imag)\b/.test(p)) {
    return pick('design-inclusive-visuals-specialist', 'keyword:inclusive', 0.75);
  }
  if (/\b(image prompt|midjourney|flux|dall-?e|stable diffusion)\b/.test(p)) {
    return pick('design-image-prompt-engineer', 'keyword:image-prompt', 0.8);
  }
  if (/\b(persona|user interview|diary study|usability test)\b/.test(p)) {
    return pick('design-persona-walkthrough', 'keyword:persona', 0.75);
  }
  if (/\b(ux research|user research|research synthes)\b/.test(p)) {
    return pick('design-ux-researcher', 'keyword:ux-research', 0.75);
  }
  if (/\b(finish gate|polish pass|visual qa|pixel perfect review)\b/.test(p)) {
    return pick('design-ui-finish-gate-reviewer', 'keyword:finish-gate', 0.75);
  }
  if (/\b(brand guardian|brand system|brand consistency|brand identity)\b/.test(p)) {
    return pick('design-brand-guardian', 'keyword:brand', 0.75);
  }
  if (/\b(ux architect|information architecture|\bia\b|user flow|wireframe|journey map)\b/.test(p)) {
    return pick('design-ux-architect', 'keyword:ux-architect', 0.75);
  }
  if (
    /\b(implement|react|tsx|css|tailwind|component library|code the ui|build the page)\b/.test(p) &&
    !/\b(design system|art direction|look and feel|visual identity|brand)\b/.test(p)
  ) {
    return pick('engineering-frontend-developer', 'keyword:implement', 0.65);
  }
  if (/\b(ui|visual|landing|hero|dashboard|palette|typography|layout|design)\b/.test(p)) {
    return pick('design-ui-designer', 'keyword:ui', 0.7);
  }

  return pick(DEFAULT_AGENCY_SKILL_ID, `keyword-fallback:${source}`, source === 'rules' ? 0.6 : 0.5);
}

export function parseAgencyAgentContent(
  content: string,
  validIds: Set<string>,
): Omit<AgencyAgentClassification, 'latencyMs' | 'source'> {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) {
    throw new Error('no-agency-agent-json');
  }
  const raw = JSON.parse(m[0]) as Record<string, unknown>;
  let skillId = String(raw.skillId ?? raw.id ?? DEFAULT_AGENCY_SKILL_ID)
    .toLowerCase()
    .trim();
  if (!validIds.has(skillId)) {
    // tolerate missing design- prefix
    const withDesign = skillId.startsWith('design-') ? skillId : `design-${skillId}`;
    const withEng = skillId.startsWith('engineering-')
      ? skillId
      : `engineering-${skillId}`;
    if (validIds.has(withDesign)) skillId = withDesign;
    else if (validIds.has(withEng)) skillId = withEng;
    else skillId = DEFAULT_AGENCY_SKILL_ID;
  }
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0.8)));
  return {
    skillId,
    confidence,
    reason: String(raw.reason ?? 'llm'),
  };
}

async function callAgencyAgentLlm(args: {
  fetchFn: typeof fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  prompt: string;
  catalog: AgencySkillCatalogEntry[];
  validIds: Set<string>;
}): Promise<Omit<AgencyAgentClassification, 'latencyMs' | 'source'>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await args.fetchFn(`${args.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://singularity.local',
        'X-Title': 'Singularity Agency Agent Classifier',
      },
      body: JSON.stringify({
        model: args.model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              prompt: args.prompt.slice(0, 2000),
              catalog: formatAgencyCatalogForClassifier(args.catalog),
              ask: 'Pick the best skillId for this request.',
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`agency-agent-llm ${res.status}: ${text.slice(0, 180)}`);
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
      throw new Error('empty-agency-agent-content');
    }
    return parseAgencyAgentContent(content, args.validIds);
  } finally {
    clearTimeout(timer);
  }
}

function sleepReject(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
