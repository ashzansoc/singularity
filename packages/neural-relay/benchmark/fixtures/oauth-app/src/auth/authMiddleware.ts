import { googleOAuthCallback } from './google.js';

export function authMiddleware(req: { path: string; query: { code?: string } }): { ok: boolean } {
  if (req.path !== '/auth/callback') {
    return { ok: true };
  }
  const code = req.query.code;
  if (!code) {
    throw new Error('OAuth callback missing code');
  }
  return googleOAuthCallback(code);
}
