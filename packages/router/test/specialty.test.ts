import { describe, expect, it } from 'vitest';
import { createRoutingEngine } from '../src/engine.js';
import { detectSpecialty } from '../src/specialty.js';
import { FRONTEND_OWNER_MODEL_ID } from '../src/specialty.js';

describe('frontend specialty routing', () => {
  it('detects frontend build prompts', () => {
    expect(
      detectSpecialty('Build me a React dashboard UI with Tailwind and charts'),
    ).toBe('frontend');
  });

  it('routes frontend specialty to DeepSeek V4 Flash', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({
      prompt: 'Create a React frontend dashboard UI with Tailwind charts and shadcn components',
      mode: 'agent',
      requiresTools: true,
    });
    expect(decision.specialty).toBe('frontend');
    expect(decision.model.id).toBe(FRONTEND_OWNER_MODEL_ID);
    expect(decision.model.id).toBe('deepseek/deepseek-v4-flash-0731');
    expect(decision.systemPromptHint).toContain('IMPLEMENTATION');
  });

  it('does not hard-pin multi-lane SaaS goals (planner splits instead)', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({
      prompt:
        'Build me a SaaS dashboard where users can upload CSVs, process them with an AI model and see analytics — include backend API and AI pipeline',
      mode: 'agent',
      requiresTools: true,
    });
    expect(decision.specialty).toBe('general');
  });

  it('honors explicit specialty override', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({
      prompt: 'implement the owned paths',
      mode: 'agent',
      specialty: 'frontend',
    });
    expect(decision.model.id).toBe(FRONTEND_OWNER_MODEL_ID);
  });

  it('does not pin pure backend prompts to DeepSeek frontend owner', () => {
    const engine = createRoutingEngine();
    const decision = engine.route({
      prompt: 'Design a Postgres schema and REST API endpoints for CSV ingestion',
      mode: 'agent',
    });
    expect(decision.model.id).not.toBe(FRONTEND_OWNER_MODEL_ID);
  });
});
