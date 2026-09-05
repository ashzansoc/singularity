/**
 * Visual Critic — owns EVALUATION only (no file edits).
 */

import {
  DEFAULT_VISUAL_QA_THRESHOLDS,
  type DesignSpecification,
  formatDesignSpecForPrompt,
  type VisualQaThresholds,
} from './designSpec.js';

/** Vision-capable critic — Gemini only (DeepSeek has no vision; Pro is disabled). */
export const VISUAL_CRITIC_MODEL_ID = 'google/gemini-2.5-flash' as const;

export type CriticSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CriticFinding {
  severity: CriticSeverity;
  issue: string;
  evidence: string;
  recommendation: string;
  target?: string;
}

export interface VisualScores {
  genericness: number;
  brandDistinctiveness: number;
  productCommunication: number;
  visualHierarchy: number;
  typography: number;
  responsiveQuality: number;
  overallDesignQuality: number;
}

export interface VisualCriticVerdict {
  version: 1;
  pass: boolean;
  scores: VisualScores;
  findings: CriticFinding[];
  summary: string;
  viewport?: string;
  iteration?: number;
}

export interface BrowserCaptureResult {
  url: string;
  viewport: { width: number; height: number };
  screenshotPath?: string;
  /** Base64 PNG when path unavailable (tests / in-memory). */
  screenshotBase64?: string;
  consoleErrors: string[];
  runtimeErrors: string[];
  domSummary?: string;
  title?: string;
}

export interface VisualCriticInput {
  goal: string;
  spec: DesignSpecification;
  captures: BrowserCaptureResult[];
  thresholds?: Partial<VisualQaThresholds>;
  iteration?: number;
}

export interface VisualCriticLlm {
  complete(req: {
    systemPrompt: string;
    prompt: string;
    modelId?: string;
    temperature?: number;
    /** Optional multimodal attachments (implementation-defined). */
    images?: Array<{ mimeType: string; dataBase64?: string; path?: string }>;
  }): Promise<{ text: string; modelId: string; tokensUsed: number }>;
}

export const VISUAL_CRITIC_SYSTEM = `You are Singularity's Visual Critic.
You OWN evaluation ONLY — you must NOT edit files or write implementation code.

Score the UI against the Design Specification and anti-generic rules.
Return ONLY JSON:
{
  "version": 1,
  "pass": boolean,
  "scores": {
    "genericness": 0-100,
    "brandDistinctiveness": 0-100,
    "productCommunication": 0-100,
    "visualHierarchy": 0-100,
    "typography": 0-100,
    "responsiveQuality": 0-100,
    "overallDesignQuality": 0-100
  },
  "findings": [
    {
      "severity": "critical"|"high"|"medium"|"low",
      "issue": string,
      "evidence": string,
      "recommendation": string,
      "target": string (optional file/component)
    }
  ],
  "summary": string
}

Scoring:
- genericness 100 = could be any AI/SaaS startup; 0 = highly specific and distinctive
- Be harsh on zinc+blue-purple, Lucide icon grids, MeshDistort blobs, lazy Inter/Geist (unless Spec font personality lists them), generic AI copy
- Require a product-specific signature visual that communicates what the product does
- Findings must be actionable (not "make it prettier")`;

export function resolveThresholds(
  partial?: Partial<VisualQaThresholds>,
): VisualQaThresholds {
  return { ...DEFAULT_VISUAL_QA_THRESHOLDS, ...partial };
}

/**
 * Apply gate thresholds to scores (deterministic — used after LLM or heuristics).
 */
export function applyVisualGates(
  scores: VisualScores,
  thresholds: VisualQaThresholds = DEFAULT_VISUAL_QA_THRESHOLDS,
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (scores.genericness > thresholds.maxGenericness) {
    reasons.push(
      `Genericness ${scores.genericness} > max ${thresholds.maxGenericness}`,
    );
  }
  if (scores.brandDistinctiveness < thresholds.minBrandDistinctiveness) {
    reasons.push(
      `Brand distinctiveness ${scores.brandDistinctiveness} < min ${thresholds.minBrandDistinctiveness}`,
    );
  }
  if (scores.productCommunication < thresholds.minProductCommunication) {
    reasons.push(
      `Product communication ${scores.productCommunication} < min ${thresholds.minProductCommunication}`,
    );
  }
  return { pass: reasons.length === 0, reasons };
}

export function parseVisualCriticJson(text: string): VisualCriticVerdict {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1]!.trim() : trimmed;
  const raw = JSON.parse(jsonText) as Partial<VisualCriticVerdict>;
  if (!raw.scores) {
    throw new Error('Visual critic response missing scores');
  }
  const scores = normalizeScores(raw.scores);
  const findings = Array.isArray(raw.findings)
    ? raw.findings.map(normalizeFinding).filter(Boolean) as CriticFinding[]
    : [];
  return {
    version: 1,
    pass: Boolean(raw.pass),
    scores,
    findings,
    summary: String(raw.summary ?? ''),
    viewport: raw.viewport,
    iteration: raw.iteration,
  };
}

function normalizeScores(s: Partial<VisualScores>): VisualScores {
  const clamp = (n: unknown, fallback: number) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(100, Math.round(v)));
  };
  return {
    genericness: clamp(s.genericness, 50),
    brandDistinctiveness: clamp(s.brandDistinctiveness, 50),
    productCommunication: clamp(s.productCommunication, 50),
    visualHierarchy: clamp(s.visualHierarchy, 50),
    typography: clamp(s.typography, 50),
    responsiveQuality: clamp(s.responsiveQuality, 50),
    overallDesignQuality: clamp(s.overallDesignQuality, 50),
  };
}

function normalizeFinding(f: Partial<CriticFinding>): CriticFinding | null {
  if (!f?.issue || !f.recommendation) return null;
  const severity = (['critical', 'high', 'medium', 'low'] as const).includes(
    f.severity as CriticSeverity,
  )
    ? (f.severity as CriticSeverity)
    : 'medium';
  return {
    severity,
    issue: String(f.issue),
    evidence: String(f.evidence ?? ''),
    recommendation: String(f.recommendation),
    target: f.target ? String(f.target) : undefined,
  };
}

/**
 * Merge LLM pass flag with hard gates — gates always win.
 */
export function finalizeCriticVerdict(
  verdict: VisualCriticVerdict,
  thresholds?: Partial<VisualQaThresholds>,
): VisualCriticVerdict {
  const t = resolveThresholds(thresholds);
  const gate = applyVisualGates(verdict.scores, t);
  const pass = verdict.pass && gate.pass;
  const findings = [...verdict.findings];
  if (!gate.pass) {
    for (const reason of gate.reasons) {
      findings.push({
        severity: 'critical',
        issue: 'Failed visual QA gate',
        evidence: reason,
        recommendation:
          'Address the Design Specification and anti-generic rules before shipping',
      });
    }
  }
  return {
    ...verdict,
    pass,
    findings,
    summary: pass
      ? verdict.summary || 'Passed visual QA'
      : [verdict.summary, ...gate.reasons].filter(Boolean).join(' · '),
  };
}

export async function runVisualCritic(
  input: VisualCriticInput,
  llm: VisualCriticLlm,
): Promise<{ verdict: VisualCriticVerdict; modelId: string; tokensUsed: number }> {
  const thresholds = resolveThresholds(input.thresholds);
  const captureBlock = input.captures
    .map(
      (c, i) =>
        `Capture ${i + 1}: ${c.viewport.width}×${c.viewport.height} @ ${c.url}\n` +
        `Title: ${c.title ?? '(none)'}\n` +
        `Console errors: ${c.consoleErrors.join(' | ') || '(none)'}\n` +
        `Runtime errors: ${c.runtimeErrors.join(' | ') || '(none)'}\n` +
        (c.domSummary ? `DOM: ${c.domSummary.slice(0, 1500)}\n` : ''),
    )
    .join('\n');

  const prompt = [
    `Original task:\n${input.goal}`,
    formatDesignSpecForPrompt(input.spec),
    `Iteration: ${input.iteration ?? 1}`,
    `Gates: genericness≤${thresholds.maxGenericness}, brand≥${thresholds.minBrandDistinctiveness}, product≥${thresholds.minProductCommunication}`,
    captureBlock || '(no captures — score conservatively as fail)',
    'Evaluate Design, Product communication, Originality, UX, Technical. Return JSON only.',
  ].join('\n\n');

  const images = input.captures
    .filter((c) => c.screenshotBase64 || c.screenshotPath)
    .map((c) => ({
      mimeType: 'image/png',
      dataBase64: c.screenshotBase64,
      path: c.screenshotPath,
    }));

  const completion = await llm.complete({
    systemPrompt: VISUAL_CRITIC_SYSTEM,
    prompt,
    modelId: VISUAL_CRITIC_MODEL_ID,
    temperature: 0.2,
    images: images.length ? images : undefined,
  });

  let verdict: VisualCriticVerdict;
  try {
    verdict = parseVisualCriticJson(completion.text);
  } catch {
    // Heuristic fail if critic output unusable and we have console errors
    const hasErrors = input.captures.some(
      (c) => c.consoleErrors.length || c.runtimeErrors.length,
    );
    verdict = {
      version: 1,
      pass: false,
      scores: {
        genericness: 70,
        brandDistinctiveness: 40,
        productCommunication: 40,
        visualHierarchy: 40,
        typography: 40,
        responsiveQuality: 40,
        overallDesignQuality: 35,
      },
      findings: [
        {
          severity: 'critical',
          issue: 'Visual critic returned unparseable output',
          evidence: completion.text.slice(0, 400),
          recommendation: 'Re-run critic; treat as fail until scores are available',
        },
        ...(hasErrors
          ? [
              {
                severity: 'high' as const,
                issue: 'Browser reported errors',
                evidence: input.captures
                  .flatMap((c) => [...c.consoleErrors, ...c.runtimeErrors])
                  .join('; '),
                recommendation: 'Fix runtime/console errors before visual polish',
              },
            ]
          : []),
      ],
      summary: 'Critic parse failure',
      iteration: input.iteration,
    };
  }

  verdict.iteration = input.iteration;
  return {
    verdict: finalizeCriticVerdict(verdict, thresholds),
    modelId: completion.modelId,
    tokensUsed: completion.tokensUsed,
  };
}

/** Format critic feedback for the Flash refine pass. */
export function formatCriticFeedbackForPrompt(verdict: VisualCriticVerdict): string {
  return [
    'VISUAL CRITIC FEEDBACK (implement these fixes; do not change art direction unless required)',
    `Pass: ${verdict.pass}`,
    `Scores: genericness=${verdict.scores.genericness}, brand=${verdict.scores.brandDistinctiveness}, product=${verdict.scores.productCommunication}, overall=${verdict.scores.overallDesignQuality}`,
    verdict.summary,
    '',
    'Findings (actionable):',
    ...verdict.findings.map(
      (f) =>
        `- [${f.severity}] ${f.issue}\n  Evidence: ${f.evidence}\n  Fix: ${f.recommendation}${f.target ? `\n  Target: ${f.target}` : ''}`,
    ),
  ].join('\n');
}

export function visualCriticMayEditFiles(): boolean {
  return false;
}
