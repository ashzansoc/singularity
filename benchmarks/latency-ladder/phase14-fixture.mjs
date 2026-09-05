/**
 * Phase 14 realistic benchmark fixture.
 *
 * A deterministic, self-contained TypeScript "mini service" written to a temp
 * directory so deep-path workers see REAL files with imports, existing
 * functions and existing tests. No network dependency; node:test based tests
 * run with plain `node --experimental-strip-types --test` semantics via tsc
 * typecheck + node's TS support.
 */
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PARSER_TS = `export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}
/**
 * Parse a raw query-string fragment into key/value pairs.
 * Existing behavior relied on by api.ts.
 */
export function parseQuery(input: string): ParseResult<Record<string, string>> {
  const out: Record<string, string> = {};
  if (typeof input !== 'string') {
    return { ok: false, error: 'input must be a string' };
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: {} };
  }
  for (const pair of trimmed.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) {
      return { ok: false, error: \`malformed pair: \${pair}\` };
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key.length === 0) {
      return { ok: false, error: 'empty key' };
    }
    out[key] = decodeSafe(value);
  }
  return { ok: true, value: out };
}

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Split a comma list, dropping blanks. Used by validator.ts. */
export function parseList(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
`;

// Seeded real bug: max length is never enforced even though the doc comment
// and the existing test require it (3..18). The regex below only enforces
// the minimum via {3,} and silently allows unbounded length.
const VALIDATOR_TS = `import { parseList } from './parser.ts';

export interface ValidationReport {
  valid: boolean;
  errors: string[];
}

const USERNAME_RE = /^[a-z0-9_]{3,}$/i;

/**
 * Validate one username.
 * Rules: 3-18 chars, letters/digits/underscore only.
 */
export function isValidUsername(name: string): boolean {
  return USERNAME_RE.test(name);
}

/**
 * Validate a batch of usernames, returning every rule violation.
 * Empty entries (from parseList) are reported as errors.
 */
export function validateUsernames(raw: string): ValidationReport {
  const names = parseList(raw);
  const errors: string[] = [];
  for (const name of names) {
    if (!isValidUsername(name)) {
      errors.push(\`invalid username: \${name}\`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Validate that an API payload contains all required fields. */
export function validatePayload(
  payload: Record<string, unknown>,
  required: readonly string[],
): ValidationReport {
  const errors: string[] = [];
  for (const field of required) {
    const v = payload[field];
    if (v === undefined || v === null || v === '') {
      errors.push(\`missing field: \${field}\`);
    }
  }
  return { valid: errors.length === 0, errors };
}
`;

const AUTH_TS = `import { createHash, randomBytes } from 'node:crypto';
import { getUser } from './db.ts';

export interface Session {
  tokenHash: string;
  user: string;
  issuedAt: number;
}

const sessions = new Map<string, Session>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Issue a session for an authenticated principal. */
export function issueSession(user: string): Session {
  const token = randomBytes(32).toString('hex');
  const session: Session = { tokenHash: hashToken(token), user, issuedAt: Date.now() };
  sessions.set(session.tokenHash, session);
  return session;
}

/**
 * Resolve a bearer token to its session. Returns undefined when unknown.
 * NOTE (existing behavior): sessions never expire once issued.
 */
export function resolveSession(token: string | undefined | null): Session | undefined {
  if (!token) return undefined;
  return sessions.get(hashToken(token));
}

/** Authenticate a request against the users table. */
export function authenticate(user: string, secret: string): Session | undefined {
  const record = getUser(user);
  if (!record || record.secret !== secret) return undefined;
  return issueSession(user);
}

export function activeSessionCount(): number {
  return sessions.size;
}
`;

const DB_TS = `import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface UserRecord {
  id: number;
  name: string;
  secret: string;
  role: 'admin' | 'user';
}

interface AuditEntry {
  at: number;
  actor: string;
  action: string;
}

let auditLog: AuditEntry[] = [];

/**
 * Load the seed database. Reads db.seed.json next to this file when present,
 * otherwise returns built-in demo rows (deterministic).
 */
export function loadUsers(dataDir?: string): UserRecord[] {
  const seedPath = dataDir ? join(dataDir, 'db.seed.json') : undefined;
  if (seedPath && existsSync(seedPath)) {
    return JSON.parse(readFileSync(seedPath, 'utf8')) as UserRecord[];
  }
  return [
    { id: 1, name: 'alice', secret: 'demo-secret', role: 'admin' },
    { id: 2, name: 'bob', secret: 'demo-secret', role: 'user' },
  ];
}

export function getUser(name: string, dataDir?: string): UserRecord | undefined {
  return loadUsers(dataDir).find((u) => u.name === name);
}

/** Append one audit entry (schema: at, actor, action). */
export function appendAudit(actor: string, action: string): void {
  auditLog.push({ at: Date.now(), actor, action });
}

export function auditEntries(): readonly AuditEntry[] {
  return auditLog;
}
`;

const API_TS = `import { parseQuery } from './parser.ts';
import { validateUsernames, validatePayload } from './validator.ts';
import { resolveSession, authenticate, activeSessionCount } from './auth.ts';

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Minimal request handler for POST /users/validate and POST /session.
 * Pure over parsed input — no sockets involved.
 */
export function handleRequest(method: string, path: string, body: string): ApiResponse {
  const parsed = parseQuery(body);
  if (!parsed.ok || !parsed.value) {
    return { status: 400, body: { error: parsed.error ?? 'bad request' } };
  }

  if (method === 'POST' && path === '/session') {
    const fields = validatePayload(parsed.value, ['user', 'secret']);
    if (!fields.valid) {
      return { status: 400, body: { error: fields.errors.join('; ') } };
    }
    const session = authenticate(parsed.value.user, parsed.value.secret);
    if (!session) {
      return { status: 401, body: { error: 'invalid credentials' } };
    }
    return { status: 200, body: { activeSessions: activeSessionCount() } };
  }

  if (method === 'POST' && path === '/users/validate') {
    const report = validateUsernames(parsed.value.names ?? '');
    return {
      status: report.valid ? 200 : 422,
      body: report.valid ? { valid: true } : { valid: false, errors: report.errors },
    };
  }

  const authed = resolveSession(parsed.value.token);
  if (!authed && path !== '/health') {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  return { status: 200, body: { ok: true, path } };
}
`;

const TEST_PARSER = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuery, parseList } from '../src/parser.ts';

test('parseQuery handles simple pairs', () => {
  const r = parseQuery('a=1&b=two');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { a: '1', b: 'two' });
});

test('parseQuery rejects malformed pairs', () => {
  const r = parseQuery('a=1&broken');
  assert.equal(r.ok, false);
});

test('parseList drops blanks', () => {
  assert.deepEqual(parseList('a, , b'), ['a', 'b']);
});
`;

// Existing failing test — pins the intended 18-char cap that validator.ts
// currently does not enforce (the seeded bug).
const TEST_VALIDATOR = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidUsername, validateUsernames, validatePayload } from '../src/validator.ts';

test('accepts well-formed usernames', () => {
  assert.equal(isValidUsername('alice_01'), true);
});

test('rejects usernames shorter than 3', () => {
  assert.equal(isValidUsername('ab'), false);
});

test('rejects usernames longer than 18', () => {
  assert.equal(isValidUsername('a'.repeat(19)), false);
});

test('validateUsernames reports each invalid entry', () => {
  const r = validateUsernames('ok_name, x, bad name!');
  assert.equal(r.valid, false);
  assert.deepEqual(r.errors.sort(), ['invalid username: bad name!', 'invalid username: x'].sort());
});

test('validatePayload flags missing fields', () => {
  const r = validatePayload({ user: 'alice' }, ['user', 'secret']);
  assert.equal(r.valid, false);
  assert.deepEqual(r.errors, ['missing field: secret']);
});
`;

const TEST_API = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest } from '../src/api.ts';

test('validation endpoint accepts good usernames', () => {
  const res = handleRequest('POST', '/users/validate', 'names=alice,bob');
  assert.equal(res.status, 200);
});

test('validation endpoint rejects oversized usernames with 422', () => {
  const res = handleRequest('POST', '/users/validate', \`names=\${'a'.repeat(19)}\`);
  assert.equal(res.status, 422);
});

test('session endpoint authenticates known user', () => {
  const res = handleRequest('POST', '/session', 'user=alice&secret=demo-secret');
  assert.equal(res.status, 200);
});

test('unknown paths require a token', () => {
  const res = handleRequest('GET', '/anything', '');
  assert.equal(res.status, 401);
});
`;

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'phase14-fixture',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      typecheck: 'tsc --noEmit',
      test: 'node --test tests/',
    },
  },
  null,
  2,
) + '\n';

const TSCONFIG_JSON = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      types: ['node'],
    },
    include: ['src/**/*.ts'],
  },
  null,
  2,
) + '\n';

/** Materialize the fixture into a fresh temp dir. Deterministic content. */
export function createPhase14Fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sing-phase14-'));
  const files = {
    'package.json': PACKAGE_JSON,
    'tsconfig.json': TSCONFIG_JSON,
    'src/parser.ts': PARSER_TS,
    'src/validator.ts': VALIDATOR_TS,
    'src/api.ts': API_TS,
    'src/auth.ts': AUTH_TS,
    'src/db.ts': DB_TS,
    'tests/parser.test.ts': TEST_PARSER,
    'tests/validator.test.ts': TEST_VALIDATOR,
    'tests/api.test.ts': TEST_API,
  };
  for (const dir of ['src', 'tests']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(root, rel), content);
  }
  // Expose the monorepo's @types/node to tsc without any network/install.
  const typesDir = join(root, 'node_modules', '@types');
  mkdirSync(typesDir, { recursive: true });
  try {
    symlinkSync(join(ROOT_TYPES_NODE), join(typesDir, 'node'), 'dir');
  } catch {
    /* already present */
  }
  return { root, files };
}

const ROOT_TYPES_NODE = '/Users/ashutosh/Singularity/node_modules/@types/node';
