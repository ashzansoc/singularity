import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContextEngine } from '@singularity/context';
import { createExecutionPlan, createFallbackPlan } from '../src/planner/planner.js';
import type { LlmPort } from '../src/ports.js';

describe('conversation → context → planner integration', () => {
  it('planner prompt includes structured context from engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sing-ctx-int-'));
    const engine = createContextEngine({
      workspaceRoot: root,
      heuristicOnly: true,
      flags: { context_engine_enabled: true, langextract_enabled: false },
    });
    await engine.ingestMessage(
      'Build SaaS with Stripe. Users must cancel subscriptions. Use PostgreSQL. Do not use Firebase.',
      { type: 'conversation' },
      { force: true },
    );
    const relevant = engine.getRelevant('Implement Stripe subscription cancellation');
    expect(relevant.prompt_block).toMatch(/PROJECT CONTEXT/);

    let capturedPrompt = '';
    const llm: LlmPort = {
      async complete(req) {
        capturedPrompt = req.prompt;
        return {
          text: JSON.stringify({
            projectSummary: 'test',
            nodes: [
              {
                id: 't1',
                title: 'Cancel flow',
                deps: [],
                ownedPaths: ['src/billing/stripe.ts'],
                expectedOutput: 'diff',
                estimatedTokens: 1000,
                recommendedTier: 'T2',
                specialty: 'backend',
                priority: 1,
                retryLimit: 1,
              },
            ],
          }),
          tokensUsed: 10,
          modelId: 'test',
        };
      },
    };

    const plan = await createExecutionPlan(
      {
        goal: 'Implement Stripe subscription cancellation',
        projectSummary: 'SaaS billing',
        structuredContext: relevant.prompt_block,
        verificationChecklist: 'check cancel',
      },
      { llm },
    );

    expect(capturedPrompt).toContain('PROJECT CONTEXT');
    expect(plan.structuredContext).toContain('PROJECT CONTEXT');
    expect(plan.nodes.length).toBeGreaterThan(0);
    engine.dispose();
  });

  it('fallback plan preserves structured context fields', () => {
    const plan = createFallbackPlan({
      goal: 'Build app',
      structuredContext: 'PROJECT CONTEXT\nTECHNOLOGIES:\n- PostgreSQL',
      verificationChecklist: 'check',
    });
    // fallback goes through finalizePlan which copies structuredContext
    expect(plan.structuredContext).toContain('PostgreSQL');
  });
});
