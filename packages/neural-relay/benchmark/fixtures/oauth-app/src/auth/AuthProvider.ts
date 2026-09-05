import { signInWithGoogle, signOutGoogle } from './google.js';

export function AuthProvider() {
  return {
    login: signInWithGoogle,
    logout: signOutGoogle,
  };
}

export function login() {
  return signInWithGoogle();
}

export function logout() {
  return signOutGoogle();
}
