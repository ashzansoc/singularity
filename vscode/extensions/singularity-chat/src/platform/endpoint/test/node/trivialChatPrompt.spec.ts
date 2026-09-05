/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { chatRequestNeedsBlockingTools, isTrivialChatPrompt, localTrivialChatReply, neuralRelayContextWaitMs, promptNeedsBlockingToolOrEngine, promptNeedsGlobalMemory, promptPrefersShortContextWait } from '../../node/singularityPromptEngineBridge';

describe('isTrivialChatPrompt', () => {
	it('skips greetings', () => {
		expect(isTrivialChatPrompt('hi')).toBe(true);
		expect(isTrivialChatPrompt('thanks!')).toBe(true);
		expect(isTrivialChatPrompt('what is singularity')).toBe(true);
	});

	it('skips assistant identity / model questions', () => {
		expect(isTrivialChatPrompt('Which model are you ?')).toBe(true);
		expect(isTrivialChatPrompt('Are you powered by Deepseek ?')).toBe(true);
		expect(isTrivialChatPrompt('what LLM do you use')).toBe(true);
		expect(isTrivialChatPrompt('You tell me what you can start with ?')).toBe(true);
		expect(isTrivialChatPrompt('what can you start with')).toBe(true);
	});

	it('does not skip real coding or model-choice tasks', () => {
		expect(isTrivialChatPrompt('which model should I use in this file')).toBe(false);
		expect(isTrivialChatPrompt('fix the bug in auth')).toBe(false);
		expect(isTrivialChatPrompt('what model does this codebase use')).toBe(false);
	});

	it('enables file tools for greenfield UI/game builds', () => {
		expect(chatRequestNeedsBlockingTools({ prompt: 'Create a snake game in HTML' })).toBe(true);
		expect(chatRequestNeedsBlockingTools({ prompt: 'make a tetris game with canvas' })).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('build a landing page')).toBe(true);
	});

	it('replies locally without needing a model', () => {
		expect(localTrivialChatReply('hello')).toMatch(/Singularity/);
		expect(localTrivialChatReply('thanks')).toMatch(/welcome/i);
	});

	it('only blocks the user when the answer needs workspace tools', () => {
		expect(promptNeedsBlockingToolOrEngine('what is a closure in javascript')).toBe(false);
		expect(promptNeedsBlockingToolOrEngine('how does TCP handshake work')).toBe(false);
		expect(promptNeedsBlockingToolOrEngine('fix the bug in auth.ts')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('where is UserService in this repo')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('What is the demo id and password')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('where are the test credentials')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('hello', { hasAttachments: true })).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('Check can you access notion?')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('notion there?')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('Can you move this entire PPT To canva and make it editable there and give me the link to it')).toBe(true);
		expect(promptNeedsBlockingToolOrEngine('import this file into canva')).toBe(true);
		expect(chatRequestNeedsBlockingTools({
			prompt: 'You tell me what you can start with ?',
			references: [{ id: 'vscode.implicit.file', kind: 'implicit' }],
		})).toBe(false);
	});

	it('loads global memory for user identity questions', () => {
		expect(promptNeedsGlobalMemory('Do you know who I am?')).toBe(true);
		expect(promptNeedsGlobalMemory('who am i ?')).toBe(true);
		expect(promptNeedsGlobalMemory('tell me about me')).toBe(true);
		expect(promptNeedsGlobalMemory('what is my name')).toBe(true);
		expect(promptNeedsGlobalMemory('check your memory')).toBe(true);
		expect(promptNeedsGlobalMemory('fix the bug in auth.ts')).toBe(false);
	});

	it('waits for Neural Relay unless status explicitly disables it', () => {
		expect(neuralRelayContextWaitMs({ enabled: false })).toBe(400);
		expect(neuralRelayContextWaitMs(undefined)).toBe(30_000);
		expect(neuralRelayContextWaitMs({ enabled: true, timeoutMs: 20_000 })).toBe(21_000);
		expect(neuralRelayContextWaitMs({ timeoutMs: 8_000 })).toBe(9_000);
	});

	it('uses a short context wait for demo / credential lookup prompts', () => {
		expect(promptPrefersShortContextWait('What is the demo id and password')).toBe(true);
		expect(promptPrefersShortContextWait('fix the bug in auth.ts')).toBe(false);
	});
});
