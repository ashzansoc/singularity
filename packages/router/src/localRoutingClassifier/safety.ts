import type { RoutingSignals } from './schema.js';
import { EMPTY_ROUTING_SIGNALS } from './schema.js';

export interface SafetyDetection {
  overlay: Partial<RoutingSignals>;
  reasons: string[];
}

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Word/phrase match — avoids obvious substring false positives (author ≠ auth). */
function has(p: string, pattern: RegExp): boolean {
  return pattern.test(p);
}

/**
 * Deterministic high-risk detection independent of Qwen.
 * Advisory overlay for the policy engine.
 */
export function detectSafetyOverrides(prompt: string): SafetyDetection {
  const p = normalize(prompt);
  const overlay: Partial<RoutingSignals> = {};
  const reasons: string[] = [];

  if (
    has(p, /\b(authentication|authorization|authenticator)\b/)
    || has(p, /\b(csrf|xss|ssrf|cors policy)\b/)
    || has(p, /\b(encrypt(ion|ed)?|decrypt(ion)?)\b/)
    || has(p, /\b(access control|permissions?|rbac|acl)\b/)
    || has(p, /\b(secrets?|credentials?|api keys?)\b/)
    || has(p, /\b(token validation|jwt|oauth|saml|openid)\b/)
    || has(p, /\b(security vulnerability|cve|exploit)\b/)
  ) {
    overlay.security_related = true;
    reasons.push('security_related');
  }

  if (
    has(p, /\b(payment|billing|invoice|refund|wallet)\b/)
    || has(p, /\b(financial|transaction|money|stripe|paypal)\b/)
  ) {
    overlay.financial_related = true;
    reasons.push('financial_related');
  }

  if (
    has(p, /\b(schema change|data corruption|destructive operation)\b/)
    || has(p, /\b(delete production data|drop table|truncate)\b/)
    || has(p, /\b(database migration|db migration|migrat(e|ion)s?)\b/)
    || has(p, /\b(data consistency|database consistency)\b/)
  ) {
    overlay.data_integrity_related = true;
    reasons.push('data_integrity_related');
  }

  if (
    has(p, /\b(investigate|diagnos(e|is)|root cause)\b/)
    || has(p, /\b(intermittent|unexplained)\b/)
    || has(p, /\b(production failure|why is this failing|identify the cause)\b/)
  ) {
    overlay.investigation_required = true;
    reasons.push('investigation_required');
  }

  if (
    has(p, /\b(architect(ure|ural)?|system design|adr|rfc)\b/)
    || has(p, /\b(architecture (decision|migration|redesign))\b/)
  ) {
    overlay.architecture_related = true;
    reasons.push('architecture_related');
  }

  if (has(p, /\bproduction\b/) && has(p, /\b(outage|incident|fail(ing|ure)|down|on[- ]call)\b/)) {
    overlay.production_related = true;
    reasons.push('production_related');
  }

  return { overlay, reasons };
}

export function applySafetyOverlay(
  signals: RoutingSignals,
  safety: SafetyDetection,
): RoutingSignals {
  return {
    ...signals,
    investigation_required: signals.investigation_required || Boolean(safety.overlay.investigation_required),
    security_related: signals.security_related || Boolean(safety.overlay.security_related),
    financial_related: signals.financial_related || Boolean(safety.overlay.financial_related),
    production_related: signals.production_related || Boolean(safety.overlay.production_related),
    architecture_related: signals.architecture_related || Boolean(safety.overlay.architecture_related),
    data_integrity_related: signals.data_integrity_related || Boolean(safety.overlay.data_integrity_related),
    verification_required: signals.verification_required || Boolean(safety.overlay.verification_required),
  };
}

export function safetyOnlySignals(prompt: string): RoutingSignals {
  const safety = detectSafetyOverrides(prompt);
  return applySafetyOverlay(EMPTY_ROUTING_SIGNALS, safety);
}
