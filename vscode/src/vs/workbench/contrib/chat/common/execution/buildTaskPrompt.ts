/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ExecutionTaskPromptContext {
	executionId: string;
	task: {
		id: string;
		title: string;
		description?: string;
		deliverable?: string;
		expectedOutput?: string;
		ownedPaths?: string[];
		acceptanceCriteria?: string[];
	};
	dependencySummaries?: string[];
	phase?: 'worker' | 'integration' | 'verification';
}

export function buildTaskPrompt(ctx: ExecutionTaskPromptContext): string {
	const { task, executionId, dependencySummaries, phase = 'worker' } = ctx;
	const lines = [
		`# Task: ${task.title}`,
		`Execution ID: ${executionId}`,
		`Task ID: ${task.id}`,
		'',
		'You are responsible ONLY for this task. Do not take over other tasks or the full user request.',
		task.description ? `\n${task.description}` : '',
		task.deliverable ? `\nDeliverable: ${task.deliverable}` : '',
		task.expectedOutput ? `\nExpected output: ${task.expectedOutput}` : '',
		task.ownedPaths?.length ? `\nOwned paths (only modify within these):\n${task.ownedPaths.map(p => `- ${p}`).join('\n')}` : '',
		task.acceptanceCriteria?.length ? `\nAcceptance criteria:\n${task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}` : '',
	];

	if (dependencySummaries?.length) {
		lines.push('', '## Dependency results', ...dependencySummaries.map(s => `- ${s}`));
	}

	if (phase === 'integration') {
		lines.push('', '## Integration role', 'Reconcile parallel worker outputs. Do not re-implement worker tasks. Resolve conflicts and produce a coherent integrated result.');
	} else if (phase === 'verification') {
		lines.push('', '## Verification role', 'Independently verify acceptance criteria, run tests/build, and report pass/fail with evidence.');
	}

	return lines.filter(Boolean).join('\n');
}
