import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAttention } from '../dist/attention.js';
import { DEFAULT_ATTENTION_THRESHOLDS } from '../dist/types.js';

test('attention ignores trivial chat and css', () => {
  const trivial = scoreAttention({ kind: 'chat_trivial', text: 'hi' });
  assert.equal(trivial.decision, 'IGNORE');
  const css = scoreAttention({ kind: 'css_edit', sourceRef: 'app.css' });
  assert.ok(css.score < DEFAULT_ATTENTION_THRESHOLDS.store);
});

test('attention elevates decisions and failures', () => {
  const decision = scoreAttention({ kind: 'chat', text: 'We decided to migrate the auth architecture' });
  assert.ok(['REFLECT', 'ULTRATHINK', 'CONSOLIDATE'].includes(decision.decision));
  const fail = scoreAttention({ kind: 'test_failure', text: 'production failure in payments' });
  assert.ok(fail.score >= DEFAULT_ATTENTION_THRESHOLDS.reflect);
});

test('ultrathink off demotes to reflect', () => {
  const scored = scoreAttention(
    { kind: 'production_failure', text: 'outage' },
    { ultrathink: 'off' },
  );
  assert.notEqual(scored.decision, 'ULTRATHINK');
});
