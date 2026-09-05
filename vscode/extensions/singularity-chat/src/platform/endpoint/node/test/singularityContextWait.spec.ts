import { describe, expect, it, afterEach } from 'vitest';
import {
	neuralRelayContextWaitMs,
	promptNeedsBlockingToolOrEngine,
	isTrivialChatPrompt,
} from '../singularityPromptEngineBridge';

describe('neuralRelayContextWaitMs (context wait reduction)', () => {
	afterEach(() => {
		delete process.env.SINGULARITY_CONTEXT_WAIT_MS;
		delete process.env.NEURAL_RELAY_SHORT_WAIT;
	});

	it('waits for the full relay budget when relay is enabled (cache-first)', () => {
		expect(neuralRelayContextWaitMs({ enabled: true, timeoutMs: 20_000 })).toBe(21_000);
	});

	it('keeps the 400ms cached peek when relay is disabled', () => {
		expect(neuralRelayContextWaitMs({ enabled: false })).toBe(400);
		expect(neuralRelayContextWaitMs(undefined)).toBe(30_000);
	});

	it('caps under the relay timeout so the relay never sees an abort', () => {
		expect(
			neuralRelayContextWaitMs({ enabled: true, timeoutMs: 1_000 }),
		).toBeLessThanOrEqual(2_000);
	});

	it('honors SINGULARITY_CONTEXT_WAIT_MS override within cap', () => {
		process.env.SINGULARITY_CONTEXT_WAIT_MS = '3000';
		expect(neuralRelayContextWaitMs({ enabled: true, timeoutMs: 20_000 })).toBe(3_000);
		process.env.SINGULARITY_CONTEXT_WAIT_MS = '999999';
		expect(neuralRelayContextWaitMs({ enabled: true, timeoutMs: 20_000 })).toBe(21_000);
		process.env.SINGULARITY_CONTEXT_WAIT_MS = '-5';
		expect(neuralRelayContextWaitMs({ enabled: true, timeoutMs: 20_000 })).toBe(21_000);
	});

	it('uses the legacy 1.5s short wait with NEURAL_RELAY_SHORT_WAIT=1', () => {
		process.env.NEURAL_RELAY_SHORT_WAIT = '1';
		expect(neuralRelayContextWaitMs({ enabled: true, timeoutMs: 20_000 })).toBe(1_500);
	});
});

describe('fast-path gating regexes stay intact', () => {
	it('trivial prompts skip context', () => {
		expect(isTrivialChatPrompt('hello')).toBe(true);
		expect(isTrivialChatPrompt('fix the login bug')).toBe(false);
	});

	it('blocking prompts still require tools/engine', () => {
		expect(promptNeedsBlockingToolOrEngine('fix the bug in auth.ts')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('what is a closure?')).toBe(false);
	});
});
