export interface ReviewerIdentity {
  id: string;
  roles: string[];
}

export interface ReviewerPolicyConfig {
  author_cannot_review: boolean;
  production_required_roles: string[];
}

export const DEFAULT_REVIEWER_POLICY: ReviewerPolicyConfig = {
  author_cannot_review: true,
  production_required_roles: ['senior', 'production-reviewer'],
};

export interface ReviewerCheckInput {
  identity?: ReviewerIdentity;
  author_id?: string;
  affects_production?: boolean;
  config?: ReviewerPolicyConfig;
}

export interface ReviewerCheckResult {
  ok: boolean;
  code?: 'missing_identity' | 'author_is_reviewer' | 'role_required';
  message?: string;
}

export function checkReviewerPolicy(input: ReviewerCheckInput): ReviewerCheckResult {
  const cfg = input.config ?? DEFAULT_REVIEWER_POLICY;
  if (!input.identity?.id) {
    return { ok: false, code: 'missing_identity', message: 'Reviewer identity required' };
  }
  if (cfg.author_cannot_review && input.author_id && input.author_id === input.identity.id) {
    return { ok: false, code: 'author_is_reviewer', message: 'Author cannot review their own mission' };
  }
  if (cfg.production_required_roles.length && input.affects_production) {
    const roles = new Set(input.identity.roles.map((r) => r.toLowerCase()));
    const ok = cfg.production_required_roles.some((r) => roles.has(r.toLowerCase()));
    if (!ok) {
      return {
        ok: false,
        code: 'role_required',
        message: `Production changes require one of: ${cfg.production_required_roles.join(', ')}`,
      };
    }
  }
  return { ok: true };
}

export function parseReviewerHeaders(headers: {
  get(name: string): string | undefined;
}): ReviewerIdentity | undefined {
  const id = headers.get('x-reviewer-id')?.trim();
  if (!id) {
    return undefined;
  }
  const roles = (headers.get('x-reviewer-roles') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { id, roles };
}
