export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'demo-google-client';

export async function signInWithGoogle(): Promise<{ provider: 'google'; token: string }> {
  return { provider: 'google', token: `google:${GOOGLE_CLIENT_ID}` };
}

export async function signOutGoogle(): Promise<void> {
  return;
}

export function googleOAuthCallback(code: string): { ok: boolean; code: string } {
  if (!code) {
    throw new Error('missing oauth code');
  }
  return { ok: true, code };
}
