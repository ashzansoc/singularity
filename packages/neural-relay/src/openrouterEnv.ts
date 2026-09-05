/**
 * Direct OpenRouter credentials — same env as the Flash/Pro decision path.
 * Intentionally does not import `@singularity/router` (that barrel loads the
 * model catalog, which Neural Relay must not touch).
 */

export function getDirectOpenRouterApiKey(): string | undefined {
  return (
    process.env.SINGULARITY_DECISION_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim()
  );
}

export function getDirectOpenRouterBaseUrl(): string {
  return (
    process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '') ||
    process.env.SINGULARITY_DECISION_BASE_URL?.replace(/\/$/, '') ||
    'https://openrouter.ai/api/v1'
  );
}
