/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agency skills for Agent / Automode Design Intelligence.
 * Loads vendored design-lane agents from packages/design/agency-skills.
 */

import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_AGENCY_SKILL_ID = 'design-ui-designer';
export const SKILL_ARTIFACT_FILENAME = 'skill.json';

export interface AgencySkillCatalogEntry {
	id: string;
	division: string;
	name: string;
	description: string;
	path: string;
}

export interface AgencySkill {
	id: string;
	division: string;
	name: string;
	description: string;
	repoPath: string;
	content: string;
	body: string;
	meta: Record<string, string>;
}

export interface SkillArtifact {
	version: 1;
	source: 'agency-agents';
	id: string;
	name: string;
	description: string;
	division: string;
	repoPath: string;
	selectedAt: string;
	promptExcerpt: string;
	content: string;
	classification?: {
		confidence: number;
		reason: string;
		source: string;
	};
}

export interface AgencyAgentClassification {
	skillId: string;
	confidence: number;
	reason: string;
	source: 'llm' | 'rules' | 'explicit' | 'timeout' | 'error';
	latencyMs: number;
}

/** Resolve packages/design/agency-skills on disk (dev + packaged layouts). */
export function resolveAgencySkillsDir(): string | undefined {
	const env = process.env.SINGULARITY_AGENCY_SKILLS_DIR;
	if (env && fs.existsSync(env)) {
		return env;
	}
	const candidates: string[] = [];
	let dir = __dirname;
	for (let i = 0; i < 14; i++) {
		candidates.push(path.join(dir, 'packages', 'design', 'agency-skills'));
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	candidates.push(
		path.resolve(__dirname, '../../../../../../packages/design/agency-skills'),
		path.resolve(__dirname, '../../../../../packages/design/agency-skills'),
		path.resolve(__dirname, '../../../../packages/design/agency-skills'),
	);
	for (const candidate of candidates) {
		if (fs.existsSync(path.join(candidate, 'catalog.json'))) {
			return candidate;
		}
	}
	return undefined;
}

export function listAgencySkills(): AgencySkillCatalogEntry[] {
	const root = resolveAgencySkillsDir();
	if (!root) {
		return [];
	}
	try {
		const raw = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8')) as {
			skills?: AgencySkillCatalogEntry[];
		};
		return Array.isArray(raw.skills) ? raw.skills : [];
	} catch {
		return [];
	}
}

export function getAgencySkill(id: string): AgencySkill | undefined {
	const root = resolveAgencySkillsDir();
	const catalog = listAgencySkills();
	const entry = catalog.find((s) => s.id === id);
	if (!root || !entry) {
		return undefined;
	}
	const filePath = path.join(root, entry.path);
	if (!fs.existsSync(filePath)) {
		return undefined;
	}
	const content = fs.readFileSync(filePath, 'utf8');
	return parseAgencySkillMarkdown(content, entry);
}

export function requireAgencySkill(id: string): AgencySkill {
	return getAgencySkill(id) ?? getAgencySkill(DEFAULT_AGENCY_SKILL_ID) ?? {
		id: DEFAULT_AGENCY_SKILL_ID,
		division: 'design',
		name: 'UI Designer',
		description: 'Expert UI designer',
		repoPath: 'design/design-ui-designer.md',
		content: '# UI Designer\nFallback skill — catalog unavailable.',
		body: 'Fallback skill — catalog unavailable.',
		meta: {},
	};
}

export function parseAgencySkillMarkdown(
	content: string,
	entry?: Partial<AgencySkillCatalogEntry>,
): AgencySkill {
	const { meta, body } = splitFrontmatter(content);
	const repoPath = entry?.path ?? '';
	const fileStem =
		entry?.id ??
		(repoPath.split('/').pop() ?? 'unknown').replace(/\.md$/, '');
	const division =
		entry?.division ?? (repoPath.includes('/') ? repoPath.split('/')[0]! : 'design');
	return {
		id: fileStem,
		division,
		name: entry?.name || meta.name || fileStem,
		description: entry?.description || meta.description || '',
		repoPath: repoPath || `${division}/${fileStem}.md`,
		content,
		body,
		meta,
	};
}

function splitFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) {
		return { meta: {}, body: raw };
	}
	const meta: Record<string, string> = {};
	for (const line of m[1]!.split(/\r?\n/)) {
		const idx = line.indexOf(':');
		if (idx <= 0) {
			continue;
		}
		const key = line.slice(0, idx).trim();
		let value = line.slice(idx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		meta[key] = value;
	}
	return { meta, body: m[2]!.trimStart() };
}

export function formatAgencySkillForPrompt(
	skill: AgencySkill,
	options: { maxChars?: number } = {},
): string {
	const maxChars = options.maxChars ?? 6_000;
	const header = [
		`ACTIVE AGENCY SKILL: ${skill.name} (${skill.id})`,
		skill.description ? `Description: ${skill.description}` : '',
		skill.meta.vibe ? `Vibe: ${skill.meta.vibe}` : '',
	]
		.filter(Boolean)
		.join('\n');

	let body = skill.body;
	const preferred = extractPreferredSections(body);
	if (preferred) {
		body = preferred;
	}
	if (body.length > maxChars) {
		body = `${body.slice(0, maxChars)}\n…[truncated]`;
	}

	return [
		header,
		'',
		'Embody this agent\'s expertise and constraints when producing the Design Specification.',
		'Do NOT copy example CSS/code blocks literally — extract principles and apply them to THIS product.',
		'',
		body,
	].join('\n');
}

function extractPreferredSections(body: string): string | undefined {
	const sections: string[] = [];
	const patterns = [
		/##[^\n]*Identity[^\n]*\n[\s\S]*?(?=\n##|$)/i,
		/##[^\n]*Core Mission[^\n]*\n[\s\S]*?(?=\n##|$)/i,
		/##[^\n]*Critical Rules[^\n]*\n[\s\S]*?(?=\n##|$)/i,
		/##[^\n]*Deliverables[^\n]*\n[\s\S]*?(?=\n##|$)/i,
	];
	for (const re of patterns) {
		const m = body.match(re);
		if (m) {
			sections.push(m[0]!.trim());
		}
	}
	if (!sections.length) {
		return undefined;
	}
	return sections.join('\n\n');
}

export function rulesFallbackAgencyAgent(
	prompt: string,
	catalog: AgencySkillCatalogEntry[] = listAgencySkills(),
	source: AgencyAgentClassification['source'] = 'rules',
	latencyMs = 0,
): AgencyAgentClassification {
	const valid = new Set(catalog.map((s) => s.id));
	const pick = (id: string, reason: string, confidence: number): AgencyAgentClassification => ({
		skillId: valid.size === 0 || valid.has(id) ? id : DEFAULT_AGENCY_SKILL_ID,
		confidence,
		reason,
		source,
		latencyMs,
	});

	const p = prompt.toLowerCase();
	if (/\b(whimsy|delight|playful|fun micro|easter egg|joy)\b/.test(p)) {
		return pick('design-whimsy-injector', 'keyword:whimsy', 0.75);
	}
	if (/\b(storytell|narrative visual|visual story)\b/.test(p)) {
		return pick('design-visual-storyteller', 'keyword:story', 0.75);
	}
	if (/\b(inclusive|diversity|representation|accessible imag)\b/.test(p)) {
		return pick('design-inclusive-visuals-specialist', 'keyword:inclusive', 0.75);
	}
	if (/\b(image prompt|midjourney|flux|dall-?e|stable diffusion)\b/.test(p)) {
		return pick('design-image-prompt-engineer', 'keyword:image-prompt', 0.8);
	}
	if (/\b(persona|user interview|diary study|usability test)\b/.test(p)) {
		return pick('design-persona-walkthrough', 'keyword:persona', 0.75);
	}
	if (/\b(ux research|user research|research synthes)\b/.test(p)) {
		return pick('design-ux-researcher', 'keyword:ux-research', 0.75);
	}
	if (/\b(finish gate|polish pass|visual qa|pixel perfect review)\b/.test(p)) {
		return pick('design-ui-finish-gate-reviewer', 'keyword:finish-gate', 0.75);
	}
	if (/\b(brand guardian|brand system|brand consistency|brand identity)\b/.test(p)) {
		return pick('design-brand-guardian', 'keyword:brand', 0.75);
	}
	if (/\b(ux architect|information architecture|\bia\b|user flow|wireframe|journey map)\b/.test(p)) {
		return pick('design-ux-architect', 'keyword:ux-architect', 0.75);
	}
	if (
		/\b(implement|react|tsx|css|tailwind|component library|code the ui|build the page)\b/.test(p) &&
		!/\b(design system|art direction|look and feel|visual identity|brand)\b/.test(p)
	) {
		return pick('engineering-frontend-developer', 'keyword:implement', 0.65);
	}
	if (/\b(ui|visual|landing|hero|dashboard|palette|typography|layout|design)\b/.test(p)) {
		return pick('design-ui-designer', 'keyword:ui', 0.7);
	}
	return pick(DEFAULT_AGENCY_SKILL_ID, `keyword-fallback:${source}`, source === 'rules' ? 0.6 : 0.5);
}

/**
 * Classify agency skill. Uses rules in tests / when LLM disabled;
 * optional LLM via decision endpoint when configured.
 */
export async function classifyAgencyAgent(
	prompt: string,
	options: { explicit?: string } = {},
): Promise<AgencyAgentClassification> {
	const catalog = listAgencySkills();
	const validIds = new Set(catalog.map((s) => s.id));
	if (options.explicit && (validIds.size === 0 || validIds.has(options.explicit))) {
		return {
			skillId: options.explicit,
			confidence: 1,
			reason: 'explicit-override',
			source: 'explicit',
			latencyMs: 0,
		};
	}

	const underTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
	const llmEnabled =
		!underTest &&
		process.env.SINGULARITY_LLM_ROUTER !== '0' &&
		process.env.SINGULARITY_AGENCY_AGENT_LLM !== '0';

	if (!llmEnabled) {
		return rulesFallbackAgencyAgent(prompt, catalog, 'rules', 0);
	}

	const apiKey =
		process.env.SINGULARITY_DECISION_API_KEY ||
		process.env.OPENROUTER_API_KEY ||
		'';
	if (!apiKey || catalog.length === 0) {
		return rulesFallbackAgencyAgent(prompt, catalog, apiKey ? 'rules' : 'error', 0);
	}

	const baseUrl = (
		process.env.SINGULARITY_DECISION_BASE_URL ||
		process.env.OPENROUTER_BASE_URL ||
		'https://openrouter.ai/api/v1'
	).replace(/\/$/, '');
	const model =
		process.env.SINGULARITY_DECISION_MODEL ||
		process.env.OPENROUTER_DECISION_MODEL ||
		'nvidia/nemotron-3-ultra-550b-a55b:free';
	const timeoutMs = Number(process.env.SINGULARITY_DECISION_TIMEOUT_MS || 2_500) || 2_500;
	const started = Date.now();
	const catalogText = catalog
		.map((s) => `- ${s.id} [${s.division}] ${s.name}: ${s.description.slice(0, 160)}`)
		.join('\n');

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://singularity.local',
					'X-Title': 'Singularity Agency Agent Classifier',
				},
				body: JSON.stringify({
					model,
					temperature: 0,
					max_tokens: 120,
					messages: [
						{
							role: 'system',
							content:
								'Pick ONE agency skillId for this frontend/design request. Reply ONLY JSON: {"skillId":"design-ui-designer","confidence":0.9,"reason":"short"}',
						},
						{
							role: 'user',
							content: JSON.stringify({
								prompt: prompt.slice(0, 2000),
								catalog: catalogText,
							}),
						},
					],
				}),
				signal: controller.signal,
			});
			const text = await res.text();
			if (!res.ok) {
				throw new Error(`agency-llm ${res.status}`);
			}
			const json = JSON.parse(text) as {
				choices?: Array<{ message?: { content?: string | null } }>;
			};
			const content = (json.choices?.[0]?.message?.content ?? '').toString();
			const m = content.match(/\{[\s\S]*\}/);
			if (!m) {
				throw new Error('no-json');
			}
			const raw = JSON.parse(m[0]) as Record<string, unknown>;
			let skillId = String(raw.skillId ?? DEFAULT_AGENCY_SKILL_ID).toLowerCase().trim();
			if (!validIds.has(skillId)) {
				skillId = DEFAULT_AGENCY_SKILL_ID;
			}
			return {
				skillId,
				confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.8))),
				reason: String(raw.reason ?? 'llm'),
				source: 'llm',
				latencyMs: Date.now() - started,
			};
		} finally {
			clearTimeout(timer);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const source: AgencyAgentClassification['source'] = /abort|timeout/i.test(msg)
			? 'timeout'
			: 'error';
		return rulesFallbackAgencyAgent(prompt, catalog, source, Date.now() - started);
	}
}

export function agencySkillToArtifact(
	skill: AgencySkill,
	options: {
		prompt?: string;
		classification?: SkillArtifact['classification'];
	} = {},
): SkillArtifact {
	return {
		version: 1,
		source: 'agency-agents',
		id: skill.id,
		name: skill.name,
		description: skill.description,
		division: skill.division,
		repoPath: skill.repoPath,
		selectedAt: new Date().toISOString(),
		promptExcerpt: (options.prompt ?? '').slice(0, 500),
		content: skill.content,
		classification: options.classification,
	};
}

export function writeSkillArtifactFile(root: string, artifact: SkillArtifact): string {
	const dir = path.join(root, '.singularity');
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, SKILL_ARTIFACT_FILENAME);
	fs.writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
	return file;
}

export function loadSkillArtifactFile(root: string): SkillArtifact | undefined {
	const file = path.join(root, '.singularity', SKILL_ARTIFACT_FILENAME);
	if (!fs.existsSync(file)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
		const id = String(raw.id ?? '');
		const content = String(raw.content ?? '');
		if (!id || !content) {
			return undefined;
		}
		return {
			version: 1,
			source: 'agency-agents',
			id,
			name: String(raw.name ?? id),
			description: String(raw.description ?? ''),
			division: String(raw.division ?? 'design'),
			repoPath: String(raw.repoPath ?? ''),
			selectedAt: String(raw.selectedAt ?? ''),
			promptExcerpt: String(raw.promptExcerpt ?? ''),
			content,
			classification:
				raw.classification && typeof raw.classification === 'object'
					? {
						confidence: Number((raw.classification as Record<string, unknown>).confidence ?? 0),
						reason: String((raw.classification as Record<string, unknown>).reason ?? ''),
						source: String((raw.classification as Record<string, unknown>).source ?? ''),
					}
					: undefined,
		};
	} catch {
		return undefined;
	}
}

export function formatSkillArtifactForPrompt(
	artifact: SkillArtifact,
	options: { maxChars?: number } = {},
): string {
	const maxChars = options.maxChars ?? 3_000;
	let body = artifact.content;
	const fm = body.match(/^---[\s\S]*?---\r?\n?([\s\S]*)$/);
	if (fm) {
		body = fm[1]!.trimStart();
	}
	if (body.length > maxChars) {
		body = `${body.slice(0, maxChars)}\n…[truncated]`;
	}
	return [
		`AGENCY SKILL (${artifact.id} — ${artifact.name})`,
		'──────────────',
		artifact.description,
		'',
		'Apply this specialist lens while implementing the Design Spec (do not invent a new art direction).',
		'',
		body,
	].join('\n');
}
