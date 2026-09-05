import { formatCurrency } from '../src/lib/format.js';
import { validateEmail } from '../src/lib/validation.js';
import { billing } from '../src/services/billing.js';
import { ordersSvc } from '../src/services/orders.js';
import { sendWelcomeEmail } from '../src/services/email.js';
import { rateLimit } from '../src/security/rateLimit.js';
import { hashPassword, verifyPassword } from '../src/security/passwords.js';
import { recordGauge } from '../src/telemetry/metrics.js';
import { isEnabled } from '../src/config/featureFlags.js';
import { createPool } from '../src/db/pool.js';

test('format currency', () => {
  expect(formatCurrency(1234)).toBe('$12.34');
});

test('validate email rejects bad input', () => {
  expect(() => validateEmail('nope')).toThrow();
});

test('billing applies promo', () => {
  const inv = billing.createInvoice('u1', 5000);
  expect(billing.applyPromoCode('u1', 'SAVE20')).toBe(10);
  expect(inv.status).toBe('issued');
});

test('orders place and find', () => {
  const o = ordersSvc.place('u1', [{ sku: 'a', qty: 2 }]);
  expect(ordersSvc.findById(o.id)?.totalCents).toBe(998);
});

test('welcome email queued', async () => {
  await sendWelcomeEmail('a@b.com');
});

test('rate limit blocks after max', () => {
  const rule = { windowMs: 1000, maxHits: 2 };
  expect(rateLimit('k', rule)).toBe(true);
  expect(rateLimit('k', rule)).toBe(true);
  expect(rateLimit('k', rule)).toBe(false);
});

test('password hash roundtrip', () => {
  const h = hashPassword('secret');
  expect(verifyPassword('secret', h)).toBe(true);
});

test('metrics gauge', () => {
  recordGauge('cpu', 0.5);
});

test('feature flag default off', () => {
  expect(isEnabled('apple-signin')).toBe(false);
});

test('pool usage', async () => {
  const pool = createPool('postgres://x', 2);
  await pool.acquire();
  expect(pool.usage()).toBe(1);
});