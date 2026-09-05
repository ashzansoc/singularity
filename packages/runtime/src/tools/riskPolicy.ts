/**
 * Risk-based verification policy (Step 9).
 *
 * Scores risk from signals already available post-run — no extra LLM call:
 * files modified, lines changed (approximated by diff size), path patterns
 * (auth / db / config / public API / deps), and destructive ops. Uncertain or
 * high scores ⇒ full verification (current behavior); low scores skip the LLM
 * checklist verifier; medium runs it.
 *
 * Thresholds configurable via env:
 * - SINGULARITY_RISK_MEDIUM_MS n/a — see below
 * - SINGULARITY_RISK_MEDIUM=<score>  (default 4)
 * - SINGULARITY_RISK_HIGH=<score>    (default 8)
 */
import { normalizePath } from '../ports.js';
import type { DiffHunk } from '../types.js';

export type RiskTier = 'low' | 'medium' | 'high';

export interface RiskScore {
  tier: RiskTier;
  score: number;
  signals: string[];
}

/** Path patterns that raise risk. */
const RISKY_PATTERNS: Array<{ re: RegExp; weight: number; label: string }> = [
  { re: /(^|\/)(auth|login|session|jwt|oauth)/i, weight: 4, label: 'auth' },
  { re: /(^|\/)(db|database|migration|migrations|schema)/i, weight: 4, label: 'database' },
  { re: /(^|\/)(config|settings|env)\./i, weight: 2, label: 'config' },
  { re: /\.env/i, weight: 8, label: 'env-file' },
  { re: /(^|\/)(public|index|exports?|mod)\.(ts|js|tsx)$/i, weight: 2, label: 'public-api' },
  { re: /(^|\/)(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml)$/i, weight: 8, label: 'dependencies' },
  { re: /(^|\/)(ci|\.github\/workflows)\//i, weight: 3, label: 'ci' },
  { re: /(^|\/)(Dockerfile|docker-compose)/i, weight: 3, label: 'container' },
];

/** Diff content that suggests destructive behavior. */
const DESTRUCTIVE_DIFF = /(DROP\s+TABLE|DELETE\s+FROM|rm\s+-rf\b|git\s+push\s+--force|\bforce-push\b|truncate\s+table)/i;

function threshold(envVar: string, fallback: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * Score the risk of applying these diffs. Higher score ⇒ more rigorous
 * verification. Pure function over already-collected data.
 *
 * Phase 13 P1 floors (never lowered by tests/softeners):
 * - public-API / export-barrel changes        ⇒ at least MEDIUM
 * - public-API surface + multi-file change    ⇒ HIGH
 * - 3 or more modified files                  ⇒ at least MEDIUM
 * - destructive diff content (SQL/rm/etc.)    ⇒ HIGH regardless of path
 */
export function scoreRisk(
  diffs: DiffHunk[],
  opts?: {
    /** Test files present among changed paths lowers residual risk. */
    testsAvailable?: boolean;
  },
): RiskScore {
  const signals: string[] = [];
  let score = 0;

  const fileCount = new Set(diffs.map((d) => normalizePath(d.path))).size;
  if (fileCount > 5) {
    score += 3;
    signals.push(`many-files:${fileCount}`);
  } else if (fileCount >= 3) {
    // ≥3 files is a multi-file change by contract: never LOW.
    score += 4;
    signals.push(`multi-file:${fileCount}`);
  } else if (fileCount === 2) {
    score += 1;
    signals.push(`multi-file:${fileCount}`);
  }

  let totalLines = 0;
  let hitPublicApi = false;
  let hitSecuritySensitive = false;
  let destructive = false;
  for (const d of diffs) {
    const p = normalizePath(d.path);
    for (const pat of RISKY_PATTERNS) {
      if (pat.re.test(p)) {
        score += pat.weight;
        signals.push(`${pat.label}:${p}`);
        if (pat.label === 'public-api') {
          hitPublicApi = true;
        }
        if (pat.label === 'auth' || pat.label === 'database' || pat.label === 'dependencies' || pat.label === 'env-file') {
          hitSecuritySensitive = true;
        }
      }
    }
    const body =
      d.newContent ??
        d.unifiedDiff
          .split('\n')
          .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
          .join('\n');
    totalLines += body.split('\n').length;
    if (DESTRUCTIVE_DIFF.test(body)) {
      score += 5;
      signals.push(`destructive:${p}`);
      destructive = true;
    }
    // Export-surface edits inside any file (export statements added/removed).
    if (/^\+.*\bexport\b/m.test(d.unifiedDiff ?? '') && !d.isNew) {
      score += 2;
      signals.push(`export-edit:${p}`);
      hitPublicApi = true;
    }
  }

  if (totalLines > 400) {
    score += 3;
    signals.push(`large-diff:${totalLines}`);
  } else if (totalLines > 120) {
    score += 1;
    signals.push(`medium-diff:${totalLines}`);
  }

  if (opts?.testsAvailable) {
    score = Math.max(0, score - 1);
    signals.push('tests-present:-1');
  }

  const mediumAt = threshold('SINGULARITY_RISK_MEDIUM', 4);
  const highAt = threshold('SINGULARITY_RISK_HIGH', 8);

  // Unknown/empty input is "uncertain" ⇒ treated as high risk (fail safe).
  if (!diffs.length) {
    return { tier: 'high', score: highAt, signals: ['no-signal-uncertain'] };
  }

  let tier: RiskTier = score >= highAt ? 'high' : score >= mediumAt ? 'medium' : 'low';

  // Policy floors — applied after softening so they cannot be eroded.
  if (destructive) {
    tier = 'high';
    signals.push('floor:destructive-high');
  }
  if (hitSecuritySensitive && tier !== 'high') {
    tier = 'high';
    signals.push('floor:security-sensitive-high');
  }
  if (hitPublicApi && fileCount >= 3) {
    tier = 'high';
    signals.push('floor:public-api+multi-file-high');
  } else if (hitPublicApi && tier === 'low') {
    tier = 'medium';
    signals.push('floor:public-api-medium');
  }
  if (fileCount >= 3 && tier === 'low') {
    tier = 'medium';
    signals.push('floor:multi-file-medium');
  }

  return { tier, score, signals };
}

export interface VerificationPlan {
  /** Deterministic ToolPort checks (typecheck etc.). Always run when available. */
  runDeterministicChecks: boolean;
  /** LLM checklist verifier. */
  runChecklistVerifier: boolean;
  /** Full current path incl. typecheck/tests once ToolPort wiring lands. */
  runFullVerification: boolean;
}

/**
 * Map a risk tier to the verification plan.
 * - Low: deterministic checks only (skip LLM checklist verifier).
 * - Medium: checklist verifier + deterministic checks.
 * - High: full current verification path (behavior-preserving default).
 */
export function verificationPolicyFor(tier: RiskTier): VerificationPlan {
  switch (tier) {
    case 'low':
      return {
        runDeterministicChecks: true,
        runChecklistVerifier: false,
        runFullVerification: false,
      };
    case 'medium':
      return {
        runDeterministicChecks: true,
        runChecklistVerifier: true,
        runFullVerification: false,
      };
    case 'high':
    default:
      // Uncertain ⇒ high risk ⇒ full verification (current behavior).
      return {
        runDeterministicChecks: true,
        runChecklistVerifier: true,
        runFullVerification: true,
      };
  }
}
