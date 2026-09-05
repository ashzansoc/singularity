/**
 * Feature flags for the Outcome Engine.
 * Coding plane may import this module.
 */

export interface OutcomeFlags {
  outcome_engine_enabled: boolean;
  outcome_extraction_enabled: boolean;
  outcome_verification_enabled: boolean;
  outcome_remediation_enabled: boolean;
  human_review_enabled: boolean;
  verify_concurrency: number;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return !/^(0|false|off|no)$/i.test(v.trim());
}

function envInt(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : defaultValue;
}

export function readOutcomeFlags(overrides?: Partial<OutcomeFlags>): OutcomeFlags {
  const base: OutcomeFlags = {
    outcome_engine_enabled: envBool('OUTCOME_ENGINE_ENABLED', true),
    outcome_extraction_enabled: envBool('OUTCOME_EXTRACTION_ENABLED', true),
    outcome_verification_enabled: envBool('OUTCOME_VERIFICATION_ENABLED', true),
    outcome_remediation_enabled: envBool('OUTCOME_REMEDIATION_ENABLED', true),
    human_review_enabled: envBool('HUMAN_REVIEW_ENABLED', true),
    verify_concurrency: envInt('OUTCOME_VERIFY_CONCURRENCY', 2),
  };
  return { ...base, ...overrides };
}

export function isOutcomeEngineActive(flags?: OutcomeFlags): boolean {
  const f = flags ?? readOutcomeFlags();
  return f.outcome_engine_enabled;
}
