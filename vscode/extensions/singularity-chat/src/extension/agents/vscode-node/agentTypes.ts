/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Handoff configuration for agent transitions (e.g., Plan → Agent).
 */
export interface AgentHandoff {
	readonly label: string;
	readonly agent: string;
	readonly prompt: string;
	readonly send?: boolean;
	readonly showContinueOn?: boolean;
	readonly model?: string;
}

/**
 * Agent configuration for building .agent.md content.
 * Shared by PlanAgentProvider, AskAgentProvider, and other custom agents.
 */
export interface AgentConfig {
	readonly name: string;
	readonly description: string;
	readonly argumentHint: string;
	readonly tools: string[];
	readonly model?: string | readonly string[];
	readonly target?: string;
	readonly disableModelInvocation?: boolean;
	readonly userInvocable?: boolean;
	readonly agents?: string[];
	readonly handoffs?: AgentHandoff[];
	readonly body: string;
}

/**
 * Default read-only tools shared by Plan, Ask, and other agents.
 * These tools can only inspect the workspace — they never modify it.
 */
export const DEFAULT_READ_TOOLS: readonly string[] = [
	'search',
	'read',
	'web',
	'vscode/memory',
	'github/issue_read',
	'github.vscode-pull-request-github/issue_fetch',
	'github.vscode-pull-request-github/activePullRequest',
	'execute/getTerminalOutput',
	'execute/testFailure'
];

/** Edit / write tools for Edit, Test, and Agent-adjacent modes. */
export const DEFAULT_EDIT_TOOLS: readonly string[] = [
	...DEFAULT_READ_TOOLS,
	'edit',
	'edit/editFiles',
	'edit/createFile',
	'vscode/askQuestions',
];

/** Terminal-focused tool set. */
export const DEFAULT_TERMINAL_TOOLS: readonly string[] = [
	...DEFAULT_READ_TOOLS,
	'execute',
	'execute/runInTerminal',
	'execute/getTerminalOutput',
	'execute/testFailure',
	'vscode/askQuestions',
];

/** Multitask: read + edit + execute + subagents (orchestration). */
export const DEFAULT_MULTITASK_TOOLS: readonly string[] = [
	...DEFAULT_READ_TOOLS,
	'edit',
	'execute',
	'agent',
	'vscode/askQuestions',
	'manage_todo_list',
	'runSubagent',
];

/** Runtime v4: DAG engine + read tools for status. */
export const DEFAULT_RUNTIME_TOOLS: readonly string[] = [
	...DEFAULT_READ_TOOLS,
	'run_runtime_engine',
	'vscode/askQuestions',
	'manage_todo_list',
];

/** LLM Wiki: persistent compounding knowledge base (Karpathy pattern). */
export const DEFAULT_WIKI_TOOLS: readonly string[] = [
	...DEFAULT_READ_TOOLS,
	'edit',
	'edit/editFiles',
	'edit/createFile',
	'llm_wiki',
	'vscode/askQuestions',
];

/**
 * Singularity-branded mode preamble injected into custom agent system prompts.
 */
export function singularityModePreamble(modeName: string): string {
	return `You are running in **Singularity ${modeName}** mode inside the Singularity IDE (a VS Code OSS fork). Stay in character for this mode's purpose. Prefer concrete references to files and symbols in the workspace.`;
}

/**
 * Builds .agent.md content from a configuration object using string formatting.
 * No YAML library required — generates valid YAML frontmatter via string templates.
 */
export function buildAgentMarkdown(config: AgentConfig): string {
	const lines: string[] = ['---'];

	// Simple scalar fields
	lines.push(`name: ${config.name}`);
	lines.push(`description: ${config.description}`);
	lines.push(`argument-hint: ${config.argumentHint}`);

	// Model (optional) — supports a single string or a priority list of models
	if (config.model) {
		if (Array.isArray(config.model)) {
			const quoted = config.model.map(m => `'${m.replace(/'/g, '\'\'')}'`).join(', ');
			lines.push(`model: [${quoted}]`);
		} else {
			lines.push(`model: ${config.model}`);
		}
	}
	if (config.target) {
		lines.push(`target: ${config.target}`);
	}
	if (config.disableModelInvocation) {
		lines.push(`disable-model-invocation: true`);
	}
	if (config.userInvocable === false) {
		lines.push(`user-invocable: false`);
	}

	// Tools array - flow style for readability
	// Escape single quotes by doubling them (YAML spec)
	if (config.tools.length > 0) {
		const quotedTools = config.tools.map(t => `'${t.replace(/'/g, '\'\'')}'`).join(', ');
		lines.push(`tools: [${quotedTools}]`);
	}

	// Agents array - same format as tools (empty array = no subagents allowed)
	if (config.agents) {
		const quotedAgents = config.agents.map(a => `'${a.replace(/'/g, '\'\'')}'`).join(', ');
		lines.push(`agents: [${quotedAgents}]`);
	}

	// Handoffs - block style for complex nested objects
	// Escape prompts using single quotes (with doubled single quotes for internal quotes)
	if (config.handoffs && config.handoffs.length > 0) {
		lines.push('handoffs:');
		for (const handoff of config.handoffs) {
			lines.push(`  - label: ${handoff.label}`);
			lines.push(`    agent: ${handoff.agent}`);
			lines.push(`    prompt: '${handoff.prompt.replace(/'/g, '\'\'')}'`);
			if (handoff.send !== undefined) {
				lines.push(`    send: ${handoff.send}`);
			}
			if (handoff.showContinueOn !== undefined) {
				lines.push(`    showContinueOn: ${handoff.showContinueOn}`);
			}
			if (handoff.model !== undefined) {
				lines.push(`    model: ${handoff.model}`);
			}
		}
	}

	lines.push('---');
	lines.push(config.body);

	return lines.join('\n');
}
