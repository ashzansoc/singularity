/** Corporate email domain required for Singularity access. */
export const SINGULARITY_ALLOWED_EMAIL_DOMAIN = 'zansoc.com';

export function isAllowedSingularityEmail(email: string, domain = SINGULARITY_ALLOWED_EMAIL_DOMAIN): boolean {
	const normalized = email.trim().toLowerCase();
	const suffix = `@${domain.toLowerCase()}`;
	return normalized.endsWith(suffix) && normalized.length > suffix.length;
}
