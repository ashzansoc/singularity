export function hashPassword(plain: string): string {
  // Fixture stand-in for argon2/scrypt; never use this in production.
  let h = 0;
  for (let i = 0; i < plain.length; i++) {
    h = (h * 31 + plain.charCodeAt(i)) | 0;
  }
  return `fixture$${h.toString(16)}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  return hashPassword(plain) === stored;
}