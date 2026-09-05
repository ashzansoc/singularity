import {
  AMBIGUITY_LEVELS,
  COMPLEXITY_LEVELS,
  EMPTY_ROUTING_SIGNALS,
  ROUTING_INTENTS,
  SCOPE_LEVELS,
  type RoutingSignals,
} from './schema.js';

function isBool(v: unknown): v is boolean {
  return v === true || v === false;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : undefined;
}

/** Strip optional Qwen think tags and extract the first JSON object. */
export function extractJsonObject(raw: string): string | undefined {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  return stripped.slice(start, end + 1);
}

export function parseRoutingSignals(raw: string): RoutingSignals {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    throw new Error('no-json');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('invalid-json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid-shape');
  }
  const o = parsed as Record<string, unknown>;
  const intent = oneOf(o.intent, ROUTING_INTENTS);
  const ambiguity = oneOf(o.ambiguity, AMBIGUITY_LEVELS);
  const complexity = oneOf(o.complexity, COMPLEXITY_LEVELS);
  const scope = oneOf(o.scope, SCOPE_LEVELS);
  if (
    !intent
    || !ambiguity
    || !complexity
    || !scope
    || !isBool(o.investigation_required)
    || !isBool(o.security_related)
    || !isBool(o.financial_related)
    || !isBool(o.production_related)
    || !isBool(o.architecture_related)
    || !isBool(o.data_integrity_related)
    || !isBool(o.verification_required)
  ) {
    throw new Error('incomplete-classification');
  }
  return {
    intent,
    investigation_required: o.investigation_required,
    security_related: o.security_related,
    financial_related: o.financial_related,
    production_related: o.production_related,
    architecture_related: o.architecture_related,
    data_integrity_related: o.data_integrity_related,
    ambiguity,
    complexity,
    scope,
    verification_required: o.verification_required,
  };
}

export function mergeSignals(
  base: RoutingSignals,
  overlay: Partial<RoutingSignals>,
): RoutingSignals {
  return {
    ...EMPTY_ROUTING_SIGNALS,
    ...base,
    ...overlay,
    investigation_required: Boolean(base.investigation_required || overlay.investigation_required),
    security_related: Boolean(base.security_related || overlay.security_related),
    financial_related: Boolean(base.financial_related || overlay.financial_related),
    production_related: Boolean(base.production_related || overlay.production_related),
    architecture_related: Boolean(base.architecture_related || overlay.architecture_related),
    data_integrity_related: Boolean(base.data_integrity_related || overlay.data_integrity_related),
    verification_required: Boolean(base.verification_required || overlay.verification_required),
  };
}
