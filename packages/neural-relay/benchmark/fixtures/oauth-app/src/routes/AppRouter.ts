import { AuthProvider } from '../auth/AuthProvider.js';

export function AppRouter() {
  const auth = AuthProvider();
  return {
    routes: ['/', '/login', '/auth/callback', '/api/users'],
    auth,
  };
}
