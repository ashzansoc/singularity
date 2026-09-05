import { describe, expect, it } from 'vitest';
import { isDesignIntelligenceFrontendGoal } from '../../../../platform/endpoint/node/frontendBuildPrompt';
import { isSingularityRuntimeMode, shouldUseRuntimeForAgentGoal } from '../singularityRuntimeRunner';

describe('isSingularityRuntimeMode', () => {
	it('is always disabled', () => {
		expect(isSingularityRuntimeMode({ prompt: 'Build auth across the repo' } as never)).toBe(false);
	});
});

describe('isDesignIntelligenceFrontendGoal', () => {
	it('routes simple UI builds to Design Intelligence', () => {
		expect(isDesignIntelligenceFrontendGoal('Build a nice looking Hello world page in HTML')).toBe(true);
		expect(isDesignIntelligenceFrontendGoal('make a snake game in HTML')).toBe(true);
		expect(isDesignIntelligenceFrontendGoal('create a react dashboard')).toBe(true);
		expect(isDesignIntelligenceFrontendGoal('Implement the frontend login page')).toBe(true);
	});

	it('defers cross-cutting engineering to Runtime', () => {
		expect(isDesignIntelligenceFrontendGoal('Build a SaaS dashboard with billing and auth')).toBe(false);
		expect(isDesignIntelligenceFrontendGoal('Implement frontend and backend login flow')).toBe(false);
	});
});

describe('shouldUseRuntimeForAgentGoal', () => {
	it('routes implement/build goals to Runtime', () => {
		expect(
			shouldUseRuntimeForAgentGoal('Add authentication to the application'),
		).toBe(true);
		expect(
			shouldUseRuntimeForAgentGoal('Build a SaaS dashboard with billing'),
		).toBe(true);
	});

	it('keeps simple frontend UI on Design Intelligence (sequential agent)', () => {
		expect(
			shouldUseRuntimeForAgentGoal('Build a nice looking Hello world page in HTML'),
		).toBe(false);
		expect(
			shouldUseRuntimeForAgentGoal('Implement the frontend login page'),
		).toBe(false);
		expect(
			shouldUseRuntimeForAgentGoal('make a snake game in HTML'),
		).toBe(false);
	});

	it('keeps Q&A on sequential agent', () => {
		expect(shouldUseRuntimeForAgentGoal('What is a closure in JS?')).toBe(false);
		expect(shouldUseRuntimeForAgentGoal('Explain how Redis works')).toBe(false);
		expect(shouldUseRuntimeForAgentGoal('hi')).toBe(false);
	});

	it('honors explicit opt-in / opt-out', () => {
		expect(
			shouldUseRuntimeForAgentGoal('use subagents to explore the auth flow'),
		).toBe(true);
		expect(
			shouldUseRuntimeForAgentGoal('implement auth no-runtime please'),
		).toBe(false);
	});
});
