/**
 * Offline benchmark for Context Engine token economics.
 * Writes measured metrics to benchmarks/context-engine/METRICS.json
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createContextEngine,
  estimateFullStateTokens,
  estimateTokens,
} from '../src/index.js';

const SCENARIOS: Array<{ name: string; messages: string[]; task: string }> = [
  {
    name: 'short_project',
    messages: [
      'Build a SaaS dashboard with Google login and Stripe billing. Use PostgreSQL. Do not use Firebase.',
    ],
    task: 'Implement Stripe subscription cancellation',
  },
  {
    name: 'requirement_change',
    messages: [
      'Use MongoDB for the database.',
      "Actually, let's use PostgreSQL instead of MongoDB.",
      'Add an admin dashboard with dark mode.',
    ],
    task: 'Set up the database schema',
  },
  {
    name: 'conflicting_instructions',
    messages: [
      'Use Tailwind for styling.',
      "Don't add Tailwind.",
      'Prefer a Linear-like UI.',
    ],
    task: 'Style the settings page',
  },
];

describe('context-engine token benchmark', () => {
  it('measures raw vs retrieved tokens on representative tasks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sing-ctx-bench-'));
    const report: Array<Record<string, unknown>> = [];

    for (const scenario of SCENARIOS) {
      const engine = createContextEngine({
        workspaceRoot: join(root, scenario.name),
        heuristicOnly: true,
        flags: { context_engine_enabled: true, langextract_enabled: false },
      });

      let extractionTokens = 0;
      for (const msg of scenario.messages) {
        const res = await engine.ingestMessage(msg, { type: 'conversation' });
        if (!res.skipped) {
          extractionTokens += estimateTokens(msg);
        }
      }

      const state = engine.getState();
      const raw = estimateFullStateTokens(state);
      const relevant = engine.getRelevant(scenario.task);
      const retrieved = relevant.estimated_tokens;
      const reductionPct =
        raw > 0 ? Math.round(((raw - retrieved) / raw) * 1000) / 10 : 0;

      report.push({
        scenario: scenario.name,
        messages: scenario.messages.length,
        state_version: state.meta.version,
        raw_context_tokens: raw,
        retrieved_context_tokens: retrieved,
        extraction_input_tokens_est: extractionTokens,
        estimated_reduction_pct: reductionPct,
        superseded: state.technologies.filter((t) => t.status === 'superseded')
          .length,
      });
      engine.dispose();
    }

    const outDir = join(
      // packages/context -> repo root
      process.cwd().includes('packages/context')
        ? join(process.cwd(), '../..')
        : process.cwd(),
      'benchmarks/context-engine',
    );
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'METRICS.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2)}\n`,
    );

    const change = report.find((r) => r.scenario === 'requirement_change');
    expect(change?.superseded).toBeGreaterThan(0);
    for (const r of report) {
      expect(r.retrieved_context_tokens as number).toBeGreaterThan(0);
      expect(r.retrieved_context_tokens as number).toBeLessThanOrEqual(
        r.raw_context_tokens as number,
      );
    }
  });
});
