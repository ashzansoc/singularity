import * as vscode from 'vscode';
import { estimateUsageCostUsd, formatUsd } from './tokenPricing.js';

export interface ProjectTokenUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	/** Accrued USD for this project (TokenRouter-aligned rates). */
	spentUsd: number;
	inputSpentUsd: number;
	outputSpentUsd: number;
	cacheSpentUsd: number;
}

export interface TokenUsageDelta {
	inputTokens?: number;
	outputTokens?: number;
	cachedInputTokens?: number;
	/** Model id used for this turn — drives TokenRouter price lookup. */
	modelId?: string;
	/**
	 * True when the provider explicitly returned cache fields (including 0).
	 * Absent/false means DeepSeek Cache UI must show — not 0%.
	 */
	cacheReported?: boolean;
}

const STORAGE_KEY = 'singularity.ai.projectTokenUsage';

/**
 * OpenAI-style usage: `prompt_tokens` is total prompt input; cached is a subset.
 * Stored/displayed input is cache-miss (fresh) tokens only.
 */
export function normalizePromptUsage(
	promptTokens: number,
	cachedTokens = 0,
): { inputTokens: number; cachedInputTokens: number } {
	const total = Math.max(0, Math.floor(promptTokens));
	const cached = Math.min(Math.max(0, Math.floor(cachedTokens)), total);
	return {
		inputTokens: total - cached,
		cachedInputTokens: cached,
	};
}

const EMPTY: ProjectTokenUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cachedInputTokens: 0,
	spentUsd: 0,
	inputSpentUsd: 0,
	outputSpentUsd: 0,
	cacheSpentUsd: 0,
};

/**
 * Project-scoped (workspace folder) token + spend counters.
 * Same totals regardless of how many chat windows are open.
 */
export class ProjectTokenUsageStore {
	private usage: ProjectTokenUsage;
	private readonly workspaceKey: string;
	private readonly _onDidChange = new vscode.EventEmitter<ProjectTokenUsage>();
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.workspaceKey = workspaceFolderKey();
		this.usage = this.load();
	}

	get snapshot(): ProjectTokenUsage {
		return { ...this.usage };
	}

	get totalTokens(): number {
		return this.usage.inputTokens + this.usage.cachedInputTokens + this.usage.outputTokens;
	}

	record(delta: TokenUsageDelta): ProjectTokenUsage {
		let input = Math.max(0, Math.floor(delta.inputTokens ?? 0));
		const output = Math.max(0, Math.floor(delta.outputTokens ?? 0));
		let cached = Math.max(0, Math.floor(delta.cachedInputTokens ?? 0));
		// Back-compat: some callers still pass total prompt_tokens as inputTokens.
		if (cached > 0 && input >= cached) {
			({ inputTokens: input, cachedInputTokens: cached } = normalizePromptUsage(input, cached));
		}
		if (input === 0 && output === 0 && cached === 0) {
			return this.snapshot;
		}
		const cost = estimateUsageCostUsd(delta.modelId, input, output, cached);
		this.usage = {
			inputTokens: this.usage.inputTokens + input,
			outputTokens: this.usage.outputTokens + output,
			cachedInputTokens: this.usage.cachedInputTokens + cached,
			spentUsd: this.usage.spentUsd + cost.totalUsd,
			inputSpentUsd: this.usage.inputSpentUsd + cost.inputUsd,
			outputSpentUsd: this.usage.outputSpentUsd + cost.outputUsd,
			cacheSpentUsd: this.usage.cacheSpentUsd + cost.cacheUsd,
		};
		this.persist();
		this._onDidChange.fire(this.snapshot);
		return this.snapshot;
	}

	reset(): ProjectTokenUsage {
		this.usage = { ...EMPTY };
		this.persist();
		this._onDidChange.fire(this.snapshot);
		return this.snapshot;
	}

	/** Re-read counters from workspace storage (e.g. after external reset). */
	reloadFromDisk(): ProjectTokenUsage {
		this.usage = this.load();
		this._onDidChange.fire(this.snapshot);
		return this.snapshot;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	private load(): ProjectTokenUsage {
		const all = this.context.workspaceState.get<Record<string, Partial<ProjectTokenUsage>>>(STORAGE_KEY, {});
		const row = all[this.workspaceKey];
		if (!row) {
			return { ...EMPTY };
		}
		return {
			inputTokens: Math.max(0, Number(row.inputTokens) || 0),
			outputTokens: Math.max(0, Number(row.outputTokens) || 0),
			cachedInputTokens: Math.max(0, Number(row.cachedInputTokens) || 0),
			spentUsd: Math.max(0, Number(row.spentUsd) || 0),
			inputSpentUsd: Math.max(0, Number(row.inputSpentUsd) || 0),
			outputSpentUsd: Math.max(0, Number(row.outputSpentUsd) || 0),
			cacheSpentUsd: Math.max(0, Number(row.cacheSpentUsd) || 0),
		};
	}

	private persist(): void {
		const all = this.context.workspaceState.get<Record<string, ProjectTokenUsage>>(STORAGE_KEY, {});
		all[this.workspaceKey] = this.snapshot;
		void this.context.workspaceState.update(STORAGE_KEY, all);
	}
}

export function workspaceFolderKey(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	return folder?.uri.toString() ?? 'no-workspace';
}

/** Compact status-bar number: 999 | 1.2k | 3.4M */
export function formatTokenCount(n: number): string {
	if (!Number.isFinite(n) || n < 0) {
		return '0';
	}
	if (n < 1000) {
		return String(Math.floor(n));
	}
	if (n < 1_000_000) {
		const v = n / 1000;
		return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}k`;
	}
	const v = n / 1_000_000;
	return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}M`;
}

export function formatUsageStatusText(
	usage: ProjectTokenUsage,
	beta?: { emailRemaining: number; deviceRemaining: number },
): string {
	const total = usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
	const local =
		`$(credit-card) ${formatUsd(usage.spentUsd)}` +
		`  ·  in ${formatTokenCount(usage.inputTokens)}` +
		`  ·  out ${formatTokenCount(usage.outputTokens)}` +
		`  ·  cache ${formatTokenCount(usage.cachedInputTokens)}` +
		`  ·  total ${formatTokenCount(total)}`;
	if (!beta) {
		return local;
	}
	const remaining = Math.min(beta.emailRemaining, beta.deviceRemaining);
	return `${local}  ·  beta ${formatTokenCount(remaining)} left`;
}

export function formatUsageTooltip(
	usage: ProjectTokenUsage,
	workspaceLabel: string,
	beta?: { emailRemaining: number; deviceRemaining: number; emailLimit: number; deviceLimit: number },
): string {
	const total = usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
	const lines = [
		`Singularity AI · ${workspaceLabel}`,
		`Spent (TokenRouter rates): ${formatUsd(usage.spentUsd)}`,
		`  Input cost (cache miss): ${formatUsd(usage.inputSpentUsd)}`,
		`  Output cost: ${formatUsd(usage.outputSpentUsd)}`,
		`  Cache read cost: ${formatUsd(usage.cacheSpentUsd)}`,
		'',
		`Tokens — input (cache miss): ${usage.inputTokens.toLocaleString()}`,
		`Tokens — output: ${usage.outputTokens.toLocaleString()}`,
		`Tokens — cache read: ${usage.cachedInputTokens.toLocaleString()}`,
		`Tokens — total: ${total.toLocaleString()}`,
	];
	if (beta) {
		lines.push(
			'',
			`Beta email remaining: ${beta.emailRemaining.toLocaleString()} / ${beta.emailLimit.toLocaleString()}`,
			`Beta device remaining: ${beta.deviceRemaining.toLocaleString()} / ${beta.deviceLimit.toLocaleString()}`,
		);
	}
	lines.push('', 'Click for details · Reset via “Singularity: Reset Token Usage”');
	return lines.join('\n');
}

export { formatUsd };
