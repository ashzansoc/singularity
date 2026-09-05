#!/usr/bin/env node
/**
 * End-to-end Context Engine test against a brand-new project folder.
 * Uses the same Singularity path as the IDE (LangExtract sidecar + .singularity/project-context).
 */
import { createContextEngine } from '@singularity/context';
import { createExecutionPlan } from '@singularity/runtime';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const workspaceRoot = join(homedir(), 'Desktop', 'langextract-test-singularity');
rmSync(workspaceRoot, { recursive: true, force: true });
mkdirSync(workspaceRoot, { recursive: true });
writeFileSync(join(workspaceRoot, 'README.md'), '# LangExtract smoke test for Singularity IDE\n');

const engine = createContextEngine({
  workspaceRoot,
  projectId: 'langextract-test',
  flags: {
    context_engine_enabled: true,
    langextract_enabled: true,
    context_retrieval_enabled: true,
    context_agent_integration_enabled: true,
  },
  heuristicOnly: false,
});

console.log('workspaceRoot:', workspaceRoot);
console.log('=== STEP 1: initial requirement message ===');
const msg1 =
  'Build a SaaS app with Google login and Stripe billing. Use PostgreSQL and TypeScript. Do not use Firebase.';
const r1 = await engine.ingestMessage(msg1, { type: 'conversation', message_id: 'm1' }, { force: true });
console.log(
  JSON.stringify(
    {
      skipped: r1.skipped,
      used_fallback: r1.extraction?.used_fallback,
      provider: r1.extraction?.provider,
      model: r1.extraction?.model,
      error: r1.extraction?.error?.slice?.(0, 400) ?? r1.extraction?.error,
      raw_item_count: r1.extraction?.raw_item_count,
      counts: engine.counts(),
    },
    null,
    2,
  ),
);

console.log('=== STEP 2: supersession message ===');
const msg2 = "Actually, let's use MongoDB instead of PostgreSQL.";
const r2 = await engine.ingestMessage(msg2, { type: 'conversation', message_id: 'm2' }, { force: true });
console.log(
  JSON.stringify(
    {
      skipped: r2.skipped,
      used_fallback: r2.extraction?.used_fallback,
      provider: r2.extraction?.provider,
      model: r2.extraction?.model,
      error: r2.extraction?.error?.slice?.(0, 400) ?? r2.extraction?.error,
      counts: engine.counts(),
    },
    null,
    2,
  ),
);

console.log('=== STEP 3: trivial skip ===');
const r3 = await engine.ingestMessage('Thanks');
console.log({ skipped: r3.skipped, reason: r3.reason });

console.log('=== STEP 4: relevant context for planner ===');
const relevant = engine.getRelevant('Implement Stripe subscription cancellation');
console.log({
  estimated_tokens: relevant.estimated_tokens,
  requirements: relevant.requirements.map((r) => r.description),
  technologies: relevant.technologies.map((t) => `${t.name}:${t.status}`),
  prohibitions: relevant.prohibitions.map((p) => p.prohibition),
  prompt_preview: relevant.prompt_block.slice(0, 600),
});

console.log('=== STEP 5: planner receives structuredContext ===');
let plannerSaw = false;
const plan = await createExecutionPlan(
  {
    goal: 'Implement Stripe subscription cancellation',
    structuredContext: relevant.prompt_block,
    projectSummary: 'SaaS billing',
  },
  {
    llm: {
      async complete(req) {
        plannerSaw = req.prompt.includes('PROJECT CONTEXT');
        return {
          text: JSON.stringify({
            projectSummary: 'billing',
            nodes: [
              {
                id: 'cancel',
                title: 'Cancel subscriptions',
                deps: [],
                ownedPaths: ['src/billing/stripe.ts'],
                expectedOutput: 'API',
                estimatedTokens: 500,
                recommendedTier: 'T2',
                specialty: 'backend',
                priority: 1,
                retryLimit: 1,
              },
            ],
          }),
          tokensUsed: 1,
          modelId: 'mock-planner',
        };
      },
    },
  },
);
console.log({ plannerSaw, planTask: plan.nodes[0]?.id, hasStructured: Boolean(plan.structuredContext) });

const ctxDir = join(workspaceRoot, '.singularity', 'project-context');
console.log('=== STEP 6: on-disk Singularity project state ===');
console.log({
  contextDirExists: existsSync(ctxDir),
  files: existsSync(ctxDir) ? readdirSync(ctxDir) : [],
});
if (existsSync(join(ctxDir, 'technologies.json'))) {
  const techs = JSON.parse(readFileSync(join(ctxDir, 'technologies.json'), 'utf8'));
  console.log(
    'technologies:',
    techs.map((t) => ({ name: t.name, status: t.status, source_type: t.source_type })),
  );
}
if (existsSync(join(ctxDir, 'prohibitions.json'))) {
  const proh = JSON.parse(readFileSync(join(ctxDir, 'prohibitions.json'), 'utf8'));
  console.log(
    'prohibitions:',
    proh.map((p) => ({ prohibition: p.prohibition, status: p.status })),
  );
}
if (existsSync(join(ctxDir, 'requirements.json'))) {
  const reqs = JSON.parse(readFileSync(join(ctxDir, 'requirements.json'), 'utf8'));
  console.log(
    'requirements:',
    reqs.map((r) => ({ description: r.description, status: r.status })),
  );
}
if (existsSync(join(ctxDir, 'meta.json'))) {
  console.log('meta:', JSON.parse(readFileSync(join(ctxDir, 'meta.json'), 'utf8')));
}

const langextractMsg1 =
  r1.extraction?.used_fallback === false && r1.extraction?.provider && r1.extraction.provider !== 'heuristic';
const langextractMsg2 =
  r2.extraction?.used_fallback === false && r2.extraction?.provider && r2.extraction.provider !== 'heuristic';

console.log('=== VERDICT ===');
console.log({
  langextract_used_on_msg1: Boolean(langextractMsg1),
  langextract_used_on_msg2: Boolean(langextractMsg2),
  persisted_under_new_project: existsSync(ctxDir),
  workspaceRoot,
  open_in_singularity: `File → Open Folder → ${workspaceRoot}`,
});

engine.dispose();
process.exit(langextractMsg1 && existsSync(ctxDir) ? 0 : 1);
