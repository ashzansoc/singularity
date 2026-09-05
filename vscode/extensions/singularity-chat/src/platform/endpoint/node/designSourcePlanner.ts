/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Nemotron-backed design-source planner for frontend Agent turns.
 * Core planning logic lives in @singularity/design; this module adds the
 * VS Code engine, session state, and filesystem knowledge loading.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
	PLANNER_TOOLS,
	applyUserAnswers,
	detectReferenceSiteIntent,
	extractReferenceSiteUrls,
	mergeDesignSourceVotes,
	planDesignSourcesRules,
	DESIGN_SOURCE_PLANNER_SYSTEM,
	type DesignSourceAction,
	type DesignSourcePlan as PackageDesignSourcePlan,
	type LlmSourceVote,
	type PlannerToolId,
} from '@singularity/design';
import { applySingularityBundledEnv } from '../../env/node/singularityBundledEnv';
import {
	DECISION_MODEL,
	DECISION_TIMEOUT_MS,
} from './openRouterLlmDecision';

export type { DesignSourceAction, PlannerToolId };
export { PLANNER_TOOLS, detectReferenceSiteIntent, extractReferenceSiteUrls };

export interface DesignSourcePlan extends PackageDesignSourcePlan {
	agentBrief: string;
}

function resolveDecisionEndpoint(): { base: string; apiKey: string; model: string; timeoutMs: number } {
	applySingularityBundledEnv();
	const base = (
		process.env.SINGULARITY_DECISION_BASE_URL
		|| process.env.OPENROUTER_BASE_URL
		|| 'https://openrouter.ai/api/v1'
	).replace(/\/$/, '');
	const apiKey =
		process.env.SINGULARITY_DECISION_API_KEY
		|| process.env.OPENROUTER_API_KEY
		|| process.env.SINGULARITY_OPENROUTER_API_KEY
		|| '';
	const model = process.env.SINGULARITY_DECISION_MODEL || DECISION_MODEL;
	const timeoutMs = Number(process.env.SINGULARITY_DECISION_TIMEOUT_MS || DECISION_TIMEOUT_MS);
	return { base, apiKey, model, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DECISION_TIMEOUT_MS };
}

export class DesignSourcePlannerEngine {
	constructor(private readonly log: (msg: string) => void = () => { }) { }

	async plan(prompt: string, conversationId?: string): Promise<DesignSourcePlan> {
		const prior = conversationId ? getStoredDesignPlan(conversationId) : getActiveDesignPlan();
		if (prior?.questions.length) {
			const answers = extractAnswersFromPrompt(prompt, prior.questions);
			if (Object.keys(answers).length > 0) {
				const applied = withBrief(applyUserAnswers(prior, answers));
				this.log(
					`[DesignSourcePlanner] applied user answers use=[${applied.activeIds.join(',')}]`,
				);
				setActiveDesignPlan(applied, conversationId);
				return applied;
			}
		}

		const baseline = planDesignSourcesRules(prompt);
		const { base, apiKey, model, timeoutMs } = resolveDecisionEndpoint();
		if (!apiKey) {
			this.log('[DesignSourcePlanner] no decision key — rules only');
			const out = withBrief(baseline);
			setActiveDesignPlan(out, conversationId);
			return out;
		}
		try {
			const votes = await Promise.race([
				this.callNemotron(base, apiKey, model, prompt, timeoutMs),
				rejectAfter(timeoutMs, 'design-planner-timeout'),
			]);
			const merged = mergeDesignSourceVotes(baseline, votes);
			this.log(
				`[DesignSourcePlanner] llm use=[${merged.activeIds.join(',')}] ask=${merged.questions.length}`,
			);
			const out = withBrief(merged);
			setActiveDesignPlan(out, conversationId);
			return out;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.log(`[DesignSourcePlanner] rules fallback (${msg})`);
			const out = withBrief(baseline);
			setActiveDesignPlan(out, conversationId);
			return out;
		}
	}

	private async callNemotron(
		base: string,
		apiKey: string,
		model: string,
		prompt: string,
		timeoutMs: number,
	): Promise<LlmSourceVote[]> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(`${base}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://singularity.local',
					'X-Title': 'Singularity Design Source Planner',
				},
				body: JSON.stringify({
					model,
					temperature: 0,
					max_tokens: 900,
					messages: [
						{ role: 'system', content: DESIGN_SOURCE_PLANNER_SYSTEM },
						{
							role: 'user',
							content: JSON.stringify({
								prompt: prompt.slice(0, 2000),
								catalog: PLANNER_TOOLS.map((t) => ({
									id: t.id,
									name: t.name,
									bestUsedFor: t.bestUsedFor,
								})),
								ask: `For each of the ${PLANNER_TOOLS.length} tools: use, ask, or skip.`,
							}),
						},
					],
				}),
				signal: controller.signal,
			});
			const text = await res.text();
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`);
			}
			const json = JSON.parse(text) as {
				choices?: Array<{ message?: { content?: string | null } }>;
			};
			const content = (json.choices?.[0]?.message?.content ?? '').toString();
			const m = content.match(/\{[\s\S]*\}/);
			if (!m) {
				throw new Error('no-json');
			}
			const parsed = JSON.parse(m[0]) as {
				sources?: Array<{ id?: string; action?: string; reason?: string }>;
			};
			return (parsed.sources ?? [])
				.filter((s) => s.id && s.action)
				.map((s) => ({
					id: String(s.id),
					action: normalizeAction(String(s.action)) ?? 'ask',
					reason: s.reason,
				}));
		} finally {
			clearTimeout(timer);
		}
	}
}

let activeDesignBrief = '';
let activeDesignPlan: DesignSourcePlan | undefined;
const plansByConversation = new Map<string, DesignSourcePlan>();

export function setActiveDesignBrief(brief: string): void {
	activeDesignBrief = brief;
}

export function getActiveDesignBrief(): string {
	return activeDesignBrief;
}

export function setActiveDesignPlan(plan: DesignSourcePlan, conversationId?: string): void {
	activeDesignPlan = plan;
	activeDesignBrief = plan.agentBrief;
	if (conversationId) {
		plansByConversation.set(conversationId, plan);
	}
}

export function getActiveDesignPlan(): DesignSourcePlan | undefined {
	return activeDesignPlan;
}

export function getStoredDesignPlan(conversationId: string): DesignSourcePlan | undefined {
	return plansByConversation.get(conversationId) ?? activeDesignPlan;
}

function withBrief(plan: PackageDesignSourcePlan): DesignSourcePlan {
	return { ...plan, agentBrief: formatAgentBrief(plan) };
}

function formatAgentBrief(plan: PackageDesignSourcePlan): string {
	const lines: string[] = [
		'Singularity Design Source Plan (mandatory)',
		'────────────────────────────────────────',
		'You own FRONTEND only. Each Design Knowledge tool is USE, ASK, or SKIP — nothing may be ignored.',
		'',
		'ART DIRECTION AUTHORITY',
		'- Before implementing UI: use existing `.singularity/design-spec.json` if present; only create one when missing.',
		'- If missing, write Design Spec FIRST (structured JSON — no React). Then implement.',
		'- DeepSeek Flash IMPLEMENTS the spec; it must not reinvent palette/type/metaphor.',
		'',
		'HARD EXECUTION RULES (never violate):',
		'- Framework projects (Next/React/Vite): write real files via tools — never dump a static index.html SPA in chat.',
		'- One todo at a time with file writes before marking complete.',
		'- Before any landing/marketing file writes: put Art Direction at the top of todo.md.',
		'',
		'PERSISTENT TODO + STEERING (mandatory for multi-step builds — any specialty):',
		'1. Create workspace-root `todo.md` with goal, Art Direction, stack, and `- [ ]` / `- [x]` tasks.',
		'2. Register steering: `.github/instructions/todo.instructions.md` (`applyTo: "**"`) pointing at `todo.md`.',
		'3. Keep `manage_todo_list` synced; after each finish flip checkbox in `todo.md`.',
		'',
		'Status:',
	];
	for (const d of plan.decisions) {
		lines.push(`- [${d.action.toUpperCase()}] ${d.name} — ${d.bestUsedFor} (${d.reason})`);
	}
	if (plan.questions.length) {
		lines.push(
			'',
			'BEFORE any create_file / package install / code edit: call #tool:vscode_askQuestions ONCE with ALL questions below.',
		);
		for (const q of plan.questions) {
			lines.push(`- ${q.id}: ${q.question}`);
		}
	}
	for (const d of plan.decisions.filter((x) => x.action === 'use')) {
		lines.push(...usageRules(d.id));
	}
	const knowledge = loadKnowledgeBlock(plan.activeIds);
	if (knowledge) {
		lines.push('', 'Retrieved Design Knowledge for active USE sources:', knowledge);
	}
	lines.push(
		'',
		'After the user answers ASK items: treat Yes as USE and No as SKIP.',
		'Reference repos: packages/design/refs — curated guides: packages/design/knowledge.',
	);
	const pendingExecute = plan.questions.map((q) => q.id);
	if (pendingExecute.length) {
		lines.push('', 'If user answers Yes, apply these execute rules for that id:');
		for (const id of pendingExecute) {
			lines.push(...usageRules(id));
		}
	}
	return lines.join('\n');
}

function usageRules(id: PlannerToolId): string[] {
	switch (id) {
		case 'react-bits':
			return ['', '### React Bits (EXECUTE)', '- Install via `npx shadcn@latest add @react-bits/<Component>-TS-TW`'];
		case 'godui':
			return ['', '### GodUI (EXECUTE)', '- Prefer GodUI MCP or `npx shadcn@latest add "https://godui.design/r/<component>.json"`'];
		case 'threejs':
			return ['', '### Three.js (EXECUTE)', '- Product-specific scene only — never MeshDistort/orb wallpaper'];
		case 'website-cloner':
			return ['', '### Website Cloner (EXECUTE)', '- Invoke `clone-website` skill before coding UI'];
		default:
			return [];
	}
}

function resolveDesignKnowledgeDir(): string | undefined {
	const env = process.env.SINGULARITY_DESIGN_KNOWLEDGE_DIR;
	if (env && fs.existsSync(env)) {
		return env;
	}
	const candidates: string[] = [];
	let dir = __dirname;
	for (let i = 0; i < 14; i++) {
		candidates.push(path.join(dir, 'packages', 'design', 'knowledge'));
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	candidates.push(
		path.resolve(__dirname, '../../../../../../packages/design/knowledge'),
		path.resolve(__dirname, '../../../../../packages/design/knowledge'),
	);
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function loadKnowledgeBlock(activeIds: PlannerToolId[]): string {
	const knowledgeDir = resolveDesignKnowledgeDir();
	if (!knowledgeDir || !activeIds.length) {
		return '';
	}
	const knowledgeFiles: Record<PlannerToolId, string> = {
		'react-bits': 'react-bits.md',
		'godui': 'godui.md',
		'shadcn': 'shadcn.md',
		'website-cloner': 'website-cloner.md',
		'aceternity': 'aceternity.md',
		'magic-ui': 'magic-ui.md',
		'radix': 'radix.md',
		'mantine': 'mantine.md',
		'tremor': 'tremor.md',
		'heroui-nextui': 'heroui.md',
		'tailwind-patterns': 'tailwind-layouts.md',
		'threejs': 'threejs.md',
	};
	const chunks: string[] = [];
	let used = 0;
	const maxChars = 10_000;
	for (const id of activeIds) {
		const tool = PLANNER_TOOLS.find((t) => t.id === id);
		const file = knowledgeFiles[id];
		if (!tool || !file) {
			continue;
		}
		const full = path.join(knowledgeDir, file);
		if (!fs.existsSync(full)) {
			continue;
		}
		try {
			let text = fs.readFileSync(full, 'utf8').trim();
			if (text.length > 2_400) {
				text = `${text.slice(0, 2_400)}\n…`;
			}
			if (used + text.length > maxChars) {
				return chunks.join('\n\n');
			}
			chunks.push(`### ${tool.name} (${file})\n${text}`);
			used += text.length;
		} catch {
			/* ignore */
		}
	}
	return chunks.join('\n\n');
}

function extractAnswersFromPrompt(
	prompt: string,
	questions: Array<{ id: PlannerToolId; question: string }>,
): Record<string, { selected: string[]; freeText: string | null; skipped: boolean }> {
	const out: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }> = {};
	const lower = prompt.toLowerCase();
	if (questions.length === 1 && /^(yes|y|no|n)\b/.test(lower.trim())) {
		const yes = /^(yes|y)\b/.test(lower.trim());
		out[questions[0]!.id] = { selected: [yes ? 'Yes' : 'No'], freeText: null, skipped: false };
		return out;
	}
	for (const q of questions) {
		const idPat = new RegExp(`${q.id}[^\\n]{0,40}\\b(yes|no)\\b`, 'i');
		const m = lower.match(idPat);
		if (m) {
			const ans = m[1].toLowerCase().includes('yes') ? 'Yes' : 'No';
			out[q.id] = { selected: [ans], freeText: null, skipped: false };
		}
	}
	return out;
}

function normalizeAction(raw: string): DesignSourceAction | undefined {
	const a = raw.toLowerCase().trim();
	if (['use', 'yes', 'on', 'enable'].includes(a)) {
		return 'use';
	}
	if (['ask', 'confirm', 'question'].includes(a)) {
		return 'ask';
	}
	if (['skip', 'no', 'off', 'disable'].includes(a)) {
		return 'skip';
	}
	return undefined;
}

function rejectAfter(ms: number, label: string): Promise<never> {
	return new Promise((_, reject) => {
		setTimeout(() => reject(new Error(label)), ms);
	});
}
