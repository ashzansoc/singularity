import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signInWithGoogle, googleOAuthCallback } from '../src/auth/google.ts';
import { AuthProvider } from '../src/auth/AuthProvider.ts';
import { authMiddleware } from '../src/auth/authMiddleware.ts';

describe('auth', () => {
  it('signs in with Google', async () => {
    const r = await signInWithGoogle();
    assert.equal(r.provider, 'google');
  });

  it('exposes login on AuthProvider', () => {
    const p = AuthProvider();
    assert.equal(typeof p.login, 'function');
  });

  it('handles oauth callback', () => {
    const r = authMiddleware({ path: '/auth/callback', query: { code: 'abc' } });
    assert.equal(r.ok, true);
  });

  it('rejects missing code', () => {
    assert.throws(() => googleOAuthCallback(''));
  });
});
