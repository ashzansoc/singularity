import { login } from '../auth/AuthProvider.js';

export function LoginPage() {
  return { title: 'Sign in with Google', onClick: login };
}
