/**
 * Deterministic heuristic extractor used as fallback when LangExtract is
 * unavailable, and for unit tests without Python/API keys.
 */

import type { ContextExtractor, ExtractOptions } from './extractor.js';
import { confidenceCategory } from './ids.js';
import type {
  ExtractionDelta,
  ExtractionResult,
  SourceReference,
} from './types.js';

function baseSource(opts: ExtractOptions): SourceReference {
  return {
    type: opts.source_metadata?.type ?? 'conversation',
    message_id: opts.source_metadata?.message_id,
    document_id: opts.source_metadata?.document_id,
    page: opts.source_metadata?.page,
    section: opts.source_metadata?.section,
    file: opts.source_metadata?.file,
    repository: opts.source_metadata?.repository,
  };
}

function findSpan(
  text: string,
  needle: string,
): { start?: number; end?: number } {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) {
    return {};
  }
  return { start: idx, end: idx + needle.length };
}

/**
 * Rule-based extraction covering the plan's core scenarios.
 */
export function heuristicExtract(text: string, opts: ExtractOptions): ExtractionDelta {
  const source = baseSource(opts);
  const delta: ExtractionDelta = {
    requirements: [],
    constraints: [],
    prohibitions: [],
    technologies: [],
    architecture_decisions: [],
    user_preferences: [],
    current_goals: [],
    open_questions: [],
    entities: [],
    supersessions: [],
  };

  const lower = text.toLowerCase();
  const uncertain = /\b(maybe|perhaps|might|could|possibly|consider)\b/i.test(
    text,
  );
  const conf = uncertain ? 0.35 : 0.9;
  const status = uncertain ? ('proposed' as const) : ('active' as const);
  const sourceType = uncertain ? ('inferred' as const) : ('explicit' as const);

  const techPatterns: Array<{ re: RegExp; name: string; category: string }> = [
    { re: /\bpostgresql\b|\bpostgres\b/i, name: 'PostgreSQL', category: 'database' },
    { re: /\bmongodb\b/i, name: 'MongoDB', category: 'database' },
    { re: /\bredis\b/i, name: 'Redis', category: 'cache' },
    { re: /\bfirebase\b/i, name: 'Firebase', category: 'backend' },
    { re: /\bnext\.?js\b/i, name: 'Next.js', category: 'framework' },
    { re: /\btypescript\b/i, name: 'TypeScript', category: 'language' },
    { re: /\bstripe\b/i, name: 'Stripe', category: 'payments' },
    { re: /\brazorpay\b/i, name: 'Razorpay', category: 'payments' },
    { re: /\btailwind\b/i, name: 'Tailwind', category: 'css' },
    { re: /\breact\b/i, name: 'React', category: 'frontend' },
    { re: /\bdocker\b/i, name: 'Docker', category: 'infra' },
    { re: /\baws\b/i, name: 'AWS', category: 'cloud' },
  ];

  // Prohibitions
  const prohibitRes = [
    /(?:don't|do not|dont|never)\s+(?:use|add|touch|modify|change|deploy)\s+([^.;,\n]+)/gi,
    /(?:no|without)\s+(firebase|mongodb|tailwind)[^.;,\n]*/gi,
  ];
  for (const re of prohibitRes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const phrase = (m[1] ?? m[0]).trim();
      const span = findSpan(text, m[0]);
      delta.prohibitions!.push({
        prohibition: phrase.replace(/^use\s+/i, '').trim() || phrase,
        kind: 'technology',
        status: 'active',
        confidence: conf,
        confidence_category: confidenceCategory(conf),
        source_type: 'explicit',
        source: {
          ...source,
          char_start: span.start,
          char_end: span.end,
          excerpt: m[0].slice(0, 200),
        },
      });
    }
  }

  // Preference (Linear-like etc.)
  const pref = text.match(
    /(?:i'?d prefer|prefer|would like)\s+(?:the\s+)?(.+?)(?:\.|$)/i,
  );
  if (pref) {
    delta.user_preferences!.push({
      preference: pref[1]!.trim(),
      category: 'ux',
      status: 'active',
      confidence: 0.75,
      confidence_category: 'medium',
      source_type: 'explicit',
      source,
    });
  }

  // Goals
  if (/\b(build|create|implement|make)\b/i.test(text)) {
    const goalMatch = text.match(
      /(?:build|create|implement|make)\s+(?:a\s+|an\s+)?([^.;\n]+)/i,
    );
    if (goalMatch) {
      delta.current_goals!.push({
        goal: goalMatch[0].trim(),
        priority: 'high',
        status: 'active',
        confidence: conf,
        confidence_category: confidenceCategory(conf),
        source_type: sourceType,
        source,
      });
    }
  }

  // Supersession: "instead" / "actually ... use X"
  const switchMatch = text.match(
    /(?:actually[, ]+)?(?:let'?s\s+)?(?:use|switch to|migrate to)\s+(\w[\w.\s-]*)\s+instead(?:\s+of\s+(\w[\w.\s-]*))?/i,
  );
  if (switchMatch) {
    const neu = switchMatch[1]!.trim();
    const old = switchMatch[2]?.trim();
    delta.supersessions!.push({
      kind: 'technology',
      old_text: old ?? '',
      new_text: neu,
    });
    delta.technologies!.push({
      name: neu,
      category: 'database',
      status: 'active',
      confidence: 0.95,
      confidence_category: 'high',
      source_type: 'explicit',
      source,
    });
    if (old) {
      delta.architecture_decisions!.push({
        decision: `Use ${neu} instead of ${old}`,
        category: 'database',
        alternatives_rejected: [old],
        status: 'active',
        confidence: 0.95,
        confidence_category: 'high',
        source_type: 'explicit',
        source,
      });
    }
  }

  // Technologies + constraints ("Use X")
  const supersededNames = new Set(
    (delta.supersessions ?? [])
      .map((s) => s.old_text.trim().toLowerCase())
      .filter(Boolean),
  );
  for (const tp of techPatterns) {
    if (!tp.re.test(text)) {
      continue;
    }
    if (supersededNames.has(tp.name.toLowerCase())) {
      continue;
    }
    // Skip if prohibited
    const isProhibited = delta.prohibitions!.some((p) =>
      p.prohibition.toLowerCase().includes(tp.name.toLowerCase()),
    );
    if (isProhibited) {
      continue;
    }
    const already = delta.technologies!.some(
      (t) => t.name.toLowerCase() === tp.name.toLowerCase(),
    );
    if (!already) {
      delta.technologies!.push({
        name: tp.name,
        category: tp.category,
        status,
        confidence: conf,
        confidence_category: confidenceCategory(conf),
        source_type: sourceType,
        source,
      });
    }
    if (/\b(use|must use|should use)\b/i.test(lower) && !uncertain) {
      delta.constraints!.push({
        constraint: `Use ${tp.name}`,
        kind: 'technology',
        strength: 'hard',
        status: 'active',
        confidence: conf,
        confidence_category: confidenceCategory(conf),
        source_type: 'explicit',
        source,
      });
    }
  }

  // Functional requirements heuristics
  const reqHints: Array<{ re: RegExp; desc: string; type: string }> = [
    {
      re: /\bgoogle\s+(login|auth|oauth|sign[- ]?in)\b/i,
      desc: 'Google authentication',
      type: 'security',
    },
    {
      re: /\bstripe\s+(billing|subscription|payment)/i,
      desc: 'Stripe subscriptions / billing',
      type: 'integration',
    },
    {
      re: /\badmin\s+dashboard\b/i,
      desc: 'Admin dashboard',
      type: 'ui',
    },
    {
      re: /\bdark\s+mode\b/i,
      desc: 'Dark mode',
      type: 'ui',
    },
    {
      re: /\bcancel\s+subscription/i,
      desc: 'Users must be able to cancel subscriptions',
      type: 'functional',
    },
    {
      re: /\bmobile[- ]first\b/i,
      desc: 'Mobile-first dashboard',
      type: 'ux',
    },
  ];
  for (const h of reqHints) {
    if (h.re.test(text)) {
      delta.requirements!.push({
        type: h.type as 'functional',
        description: h.desc,
        priority: 'high',
        status: 'active',
        confidence: conf,
        confidence_category: confidenceCategory(conf),
        source_type: sourceType,
        source,
      });
    }
  }

  // Soft preference for Redis when "maybe"
  if (/\bmaybe\b.*\bredis\b|\bredis\b.*\bmaybe\b/i.test(text)) {
    delta.technologies!.push({
      name: 'Redis',
      category: 'cache',
      role: 'proposed caching',
      status: 'proposed',
      confidence: 0.3,
      confidence_category: 'low',
      source_type: 'inferred',
      source,
    });
  }

  // Existing state supersession: new tech conflicts with existing
  if (opts.existing_state) {
    for (const neu of delta.technologies ?? []) {
      if (neu.status !== 'active') {
        continue;
      }
      for (const old of opts.existing_state.technologies) {
        if (
          old.status === 'active' &&
          old.category === neu.category &&
          old.name.toLowerCase() !== neu.name.toLowerCase()
        ) {
          delta.supersessions!.push({
            kind: 'technology',
            old_text: old.name,
            new_text: neu.name,
          });
        }
      }
    }
  }

  return delta;
}

export class HeuristicContextExtractor implements ContextExtractor {
  async extract(options: ExtractOptions): Promise<ExtractionResult> {
    const t0 = Date.now();
    const delta = heuristicExtract(options.text, options);
    const count =
      (delta.requirements?.length ?? 0) +
      (delta.constraints?.length ?? 0) +
      (delta.prohibitions?.length ?? 0) +
      (delta.technologies?.length ?? 0) +
      (delta.architecture_decisions?.length ?? 0) +
      (delta.user_preferences?.length ?? 0) +
      (delta.current_goals?.length ?? 0) +
      (delta.open_questions?.length ?? 0);
    return {
      delta,
      raw_item_count: count,
      provider: 'heuristic',
      model: 'rules',
      latency_ms: Date.now() - t0,
      used_fallback: true,
    };
  }
}
