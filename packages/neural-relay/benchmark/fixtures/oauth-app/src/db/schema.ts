export const SCHEMA = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google'
);
`;

export function migrate(): string {
  return SCHEMA;
}
