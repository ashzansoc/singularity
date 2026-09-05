import { describe, expect, it } from 'vitest';
import {
  applyRoutingPolicy,
  EMPTY_ROUTING_SIGNALS,
  FLASH_MODEL_ID,
  routeWithSignals,
  type RoutingSignals,
} from '../src/localRoutingClassifier/index.js';
import { parseRoutingSignals } from '../src/localRoutingClassifier/parse.js';

const FLASH = FLASH_MODEL_ID;

function expectModel(prompt: string, model: string, signals?: RoutingSignals) {
  const decision = routeWithSignals(prompt, signals ?? EMPTY_ROUTING_SIGNALS);
  expect(decision.final_model, `${prompt} → ${decision.routing_reason}`).toBe(model);
  return decision;
}

describe('deterministic routing policy', () => {
  it('Flash: rename variable', () => {
    expectModel('Rename the variable userName to username in src/user.ts.', FLASH);
  });

  it('Flash: rename class across repository', () => {
    expectModel('Rename UserService to AccountService throughout the repository.', FLASH);
  });

  it('Flash: replace localhost URL', () => {
    expectModel('Replace http://localhost:3000 with the staging URL in config.', FLASH);
  });

  it('Flash: add simple endpoint following existing pattern', () => {
    expectModel('Add a straightforward GET /health endpoint following the existing API pattern.', FLASH);
  });

  it('Flash: add simple unit test', () => {
    expectModel('Add a straightforward unit test for formatDate.', FLASH);
  });

  it('Flash: change log level', () => {
    expectModel('Change the log level from debug to info in logger.ts.', FLASH);
  });

  it('Flash: add pagination following existing patterns', () => {
    expectModel('Add pagination to the list endpoint following existing API patterns.', FLASH);
  });

  it('Flash: simple code explanation', () => {
    expectModel('Explain what Array.prototype.map does in JavaScript.', FLASH);
  });

  it('Pro: intermittent authentication failure', () => {
    const d = expectModel(
      'Users are intermittently being logged out. Investigate the codebase, identify the root cause, and implement a reliable fix.',
      FLASH,
    );
    expect(d.routing_reason).toMatch(/investigation_required|security_related/);
  });

  it('Pro: production payment failure', () => {
    expectModel('Production payment capture is failing for some Stripe transactions. Diagnose and fix.', FLASH);
  });

  it('Pro: security vulnerability investigation', () => {
    expectModel('Investigate this security vulnerability in token validation.', FLASH);
  });

  it('Pro: CSRF modification', () => {
    expectModel('Update CSRF protection on the login form.', FLASH);
  });

  it('Pro: database migration', () => {
    expectModel('Write a database migration to add a unique constraint on email.', FLASH);
  });

  it('Pro: architecture migration', () => {
    expectModel('Plan an architecture migration from the monolith to services.', FLASH);
  });

  it('Pro: root-cause investigation', () => {
    expectModel('Do a root cause analysis of the flaky checkout errors.', FLASH);
  });

  it('Pro: production performance investigation', () => {
    expectModel('Investigate why production API latency is intermittent and unexplained.', FLASH);
  });

  it('Borderline: change JWT expiration → Pro (safety)', () => {
    expectModel('Change JWT expiration from 15m to 1h.', FLASH);
  });

  it('Borderline: improve caching → Flash', () => {
    expectModel('Improve caching for the user profile endpoint.', FLASH);
  });

  it('Borderline: optimize an endpoint → Flash', () => {
    expectModel('Optimize the /search endpoint query.', FLASH);
  });

  it('Borderline: modify production configuration → Flash unless high complexity', () => {
    expectModel('Modify production configuration to raise the log retention days.', FLASH);
  });

  it('Borderline: refactor authentication code → Pro', () => {
    expectModel('Refactor authentication code in the session helper.', FLASH);
  });

  it('Borderline: modify database indexes → Flash', () => {
    expectModel('Modify database indexes on the orders table for read speed.', FLASH);
  });

  it('Borderline: change API timeout → Flash', () => {
    expectModel('Change the API timeout from 10s to 15s.', FLASH);
  });

  it('Borderline: change retry policy → Flash', () => {
    expectModel('Change the retry policy to 3 attempts with linear backoff.', FLASH);
  });

  it('Qwen high complexity forces Pro even without safety keywords', () => {
    const signals: RoutingSignals = {
      ...EMPTY_ROUTING_SIGNALS,
      intent: 'coding',
      complexity: 'high',
      ambiguity: 'low',
    };
    const d = routeWithSignals('Please update this module.', signals);
    expect(d.final_model).toBe(FLASH);
    expect(d.routing_reason).toBe('flash-only:complexity=high');
  });

  it('production_related alone with low complexity/ambiguity stays Flash', () => {
    const signals: RoutingSignals = {
      ...EMPTY_ROUTING_SIGNALS,
      intent: 'configuration',
      production_related: true,
      complexity: 'low',
      ambiguity: 'low',
    };
    expect(applyRoutingPolicy(signals).modelId).toBe(FLASH);
  });

  it('parses JSON and rejects incomplete classifications', () => {
    const ok = parseRoutingSignals(
      '<think></think>{"intent":"coding","investigation_required":false,"security_related":false,"financial_related":false,"production_related":false,"architecture_related":false,"data_integrity_related":false,"ambiguity":"low","complexity":"low","scope":"single_file","verification_required":false}',
    );
    expect(ok.intent).toBe('coding');
    expect(() => parseRoutingSignals('not json')).toThrow();
    expect(() => parseRoutingSignals('{"intent":"coding"}')).toThrow();
  });
});
