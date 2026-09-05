/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Design Intelligence for Agent / Automode (full pipeline, not prompt-only).
 *
 * Flow:
 *   frontend specialty → Design Director (Flash-0731, Spec v2) → .singularity/design-spec.json
 *   → Flash implements with Spec in context
 *   → Stop hook → Visual Critic → FAIL forces refine (≤ MAX_VISUAL_ITERATIONS)
 */

import * as fs from 'fs';
import * as path from 'path';
import { applySingularityBundledEnv, ensureFreshTokenRouterApiKey, getChatCompletionsAuthHeaders, getDeepSeekDirectConfig, getTokenRouterBaseUrl, isDeepSeekDirectBaseUrl, mapDeepSeekOfficialModelId } from '../../env/node/singularityBundledEnv';
import {
	captureAgentPreview,
	formatCaptureDigest,
} from './agentBrowserCapture';
import {
	DECISION_TIMEOUT_MS,
} from './openRouterLlmDecision';
import {
	agencySkillToArtifact,
	classifyAgencyAgent,
	formatAgencySkillForPrompt,
	formatSkillArtifactForPrompt,
	loadSkillArtifactFile,
	requireAgencySkill,
	writeSkillArtifactFile,
	type AgencySkill,
	type SkillArtifact,
} from './agencySkillAgent';
import {
	buildDirectorUserPrompt,
	DIRECTOR_SYSTEM_V2,
	formatSpecPrompt,
	isHeuristicDesignSpec,
	parseDesignSpecLlmJson,
	validateSpec,
	buildStarterDesignSpec,
	type DesignSpecification,
} from './designSpecV2Agent';
import { promptLooksLikeFrontendBuild } from './frontendBuildPrompt';
import { isTrivialChatPrompt } from './singularityPromptEngineBridge';
import { reportChatTurnStatus, startChatTurnStatusHeartbeat } from './chatTurnStatus';

export type { DesignSpecification } from './designSpecV2Agent';
export type { SkillArtifact } from './agencySkillAgent';

/** Primary Design Director — DeepSeek V4 Flash-0731 via TokenRouter (fills Design Spec v2). */
export const DESIGN_DIRECTOR_MODEL = 'deepseek/deepseek-v4-flash-0731';
/** Fallback when Flash-0731 is unavailable (legacy Flash removed). */
export const DESIGN_DIRECTOR_FALLBACK_MODEL = 'stepfun/step-3.5-flash';
export const VISUAL_CRITIC_MODEL = 'google/gemini-2.5-flash';
/** Spec v2 generation budget — Flash often needs >20s for a full sheet. */
export const DESIGN_DIRECTOR_TIMEOUT_MS = 60_000;
export const DESIGN_DIRECTOR_FALLBACK_TIMEOUT_MS = 45_000;
export const MAX_VISUAL_ITERATIONS = 3;
export const MAX_GENERICNESS = 35;
export const MIN_BRAND = 65;
export const MIN_PRODUCT = 65;

/** User-visible Design Intelligence pipeline step. */
export interface DesignIntelligenceProgressUpdate {
	step: number;
	title: string;
	detail: string;
}

export type DesignIntelligenceProgressReporter = (update: DesignIntelligenceProgressUpdate) => void;

function emitDesignProgress(
	onProgress: DesignIntelligenceProgressReporter | undefined,
	step: number,
	title: string,
	detail: string,
): void {
	const update = { step, title, detail };
	reportChatTurnStatus(title, detail);
	onProgress?.(update);
}

export interface VisualScores {
	genericness: number;
	brandDistinctiveness: number;
	productCommunication: number;
	visualHierarchy: number;
	typography: number;
	responsiveQuality: number;
	overallDesignQuality: number;
}

export interface CriticFinding {
	severity: 'critical' | 'high' | 'medium' | 'low';
	issue: string;
	evidence: string;
	recommendation: string;
	target?: string;
}

export interface VisualCriticVerdict {
	version: 1;
	pass: boolean;
	scores: VisualScores;
	findings: CriticFinding[];
	summary: string;
	iteration: number;
}

interface SessionState {
	conversationId: string;
	frontendActive: boolean;
	spec?: DesignSpecification;
	specPrompt?: string;
	/** Selected agency skill for this frontend turn. */
	skill?: AgencySkill;
	skillArtifact?: SkillArtifact;
	skillPrompt?: string;
	/** Original user prompt for this frontend turn — refine must stay scoped to it. */
	userPrompt?: string;
	workspaceRoot?: string;
	visualIteration: number;
	lastVerdict?: VisualCriticVerdict;
	/** In-flight background Spec refresh (dedupe). */
	pendingSpecRefresh?: Promise<void>;
}

const sessions = new Map<string, SessionState>();
let activeConversationId: string | undefined;

/**
 * Whether Agent should run Design Director (skill.json + design-spec.json) before implementing UI.
 */
export function promptNeedsDesignIntelligence(prompt: string): boolean {
	return promptLooksLikeFrontendBuild(prompt);
}

/**
 * True when the prompt asks for a new product / visual direction (full Director).
 * Tweaks and polish keep the existing Spec as source of truth.
 */
export function needsFullSpecRefresh(prompt: string, existing?: DesignSpecification): boolean {
	if (!existing) {
		return true;
	}
	const p = prompt.trim().toLowerCase();
	return /\b(new (product|app|site|brand|landing|page)|from scratch|start over|different (product|brand|metaphor|direction)|rebuild|rebrand|redesign (the )?(whole|entire))\b/.test(p);
}

/** Whether session or disk already has a real (non-heuristic) Design Spec. */
export function hasReusableDesignSpec(conversationId: string, workspaceRoot?: string): boolean {
	const session = sessions.get(conversationId);
	if (session?.spec && session.specPrompt && !isHeuristicDesignSpec(session.spec)) {
		return true;
	}
	const root = resolveWorkspaceRoot(workspaceRoot ?? session?.workspaceRoot);
	if (!root) {
		return false;
	}
	const existing = loadDesignSpecFile(root);
	return Boolean(existing && !isHeuristicDesignSpec(existing.spec));
}

/**
 * Kick a non-blocking Spec refresh. Implementer can proceed with the current Spec.
 */
export function scheduleDesignSpecRefresh(options: {
	conversationId: string;
	prompt: string;
	workspaceRoot?: string;
	log?: (msg: string) => void;
}): void {
	const log = options.log ?? (() => { });
	const session = getSession(options.conversationId);
	if (session.pendingSpecRefresh) {
		log('[DesignIntelligence] Spec refresh already in flight — skipping duplicate');
		return;
	}
	session.pendingSpecRefresh = (async () => {
		try {
			log('[DesignIntelligence] background Spec refresh starting');
			await runDesignDirectorForAgent({
				...options,
				forceRefresh: true,
				log,
			});
			log('[DesignIntelligence] background Spec refresh complete');
		} catch (e) {
			log(`[DesignIntelligence] background Spec refresh failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			session.pendingSpecRefresh = undefined;
		}
	})();
}

const CRITIC_SYSTEM = `You are Singularity's Visual Critic.
Evaluate whether the frontend implementation matches the Design Specification and avoids generic AI SaaS templates.
Return ONLY JSON:
{
  "version": 1,
  "pass": boolean,
  "scores": {
    "genericness": 0-100,
    "brandDistinctiveness": 0-100,
    "productCommunication": 0-100,
    "visualHierarchy": 0-100,
    "typography": 0-100,
    "responsiveQuality": 0-100,
    "overallDesignQuality": 0-100
  },
  "findings": [{"severity":"high","issue":"...","evidence":"...","recommendation":"...","target":"..."}],
  "summary": "..."
}
genericness 100 = any AI SaaS; 0 = highly distinctive.
Be harsh on zinc+blue-purple, Lucide icon grids, MeshDistort blobs, lazy Inter/Geist (unless Spec font personality lists them), generic AI copy.`;

function resolveEndpoint(): { base: string; apiKey: string; timeoutMs: number } {
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
	const timeoutMs = Number(process.env.SINGULARITY_DECISION_TIMEOUT_MS || DECISION_TIMEOUT_MS);
	return { base, apiKey, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DECISION_TIMEOUT_MS };
}

async function resolveTokenRouterEndpoint(): Promise<{ base: string; apiKey: string; timeoutMs: number } | undefined> {
	applySingularityBundledEnv();
	const timeoutMs = Number(process.env.SINGULARITY_DECISION_TIMEOUT_MS || DECISION_TIMEOUT_MS);
	const deepseek = getDeepSeekDirectConfig();
	if (deepseek) {
		return {
			base: deepseek.baseUrl,
			apiKey: deepseek.apiKey,
			timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DECISION_TIMEOUT_MS,
		};
	}
	const apiKey = await ensureFreshTokenRouterApiKey();
	if (!apiKey) {
		return undefined;
	}
	const base = getTokenRouterBaseUrl(apiKey);
	return {
		base,
		apiKey,
		timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DECISION_TIMEOUT_MS,
	};
}

function resolveDirectorTimeoutMs(fallback = false): number {
	const envKey = fallback
		? 'SINGULARITY_DESIGN_DIRECTOR_FALLBACK_TIMEOUT_MS'
		: 'SINGULARITY_DESIGN_DIRECTOR_TIMEOUT_MS';
	const fromEnv = Number(process.env[envKey]);
	if (Number.isFinite(fromEnv) && fromEnv >= 8_000) {
		return fromEnv;
	}
	return fallback ? DESIGN_DIRECTOR_FALLBACK_TIMEOUT_MS : DESIGN_DIRECTOR_TIMEOUT_MS;
}

async function chatComplete(
	system: string,
	prompt: string,
	modelId: string,
	temperature: number,
	endpoint?: { base: string; apiKey: string; timeoutMs: number },
	timeoutMsOverride?: number,
): Promise<string> {
	const resolved = endpoint ?? resolveEndpoint();
	if (!resolved.apiKey) {
		throw new Error('no-api-key');
	}
	const timeoutMs = timeoutMsOverride
		?? Math.max(resolved.timeoutMs, 20_000);
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(`${resolved.base}/chat/completions`, {
			method: 'POST',
			headers: {
				...getChatCompletionsAuthHeaders(resolved.apiKey, resolved.base),
				'HTTP-Referer': 'https://singularity.local',
				'X-Title': 'Singularity Design Intelligence',
			},
			body: JSON.stringify({
				model: isDeepSeekDirectBaseUrl(resolved.base) ? mapDeepSeekOfficialModelId(modelId) : modelId,
				temperature,
				max_tokens: 8_000,
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: prompt },
				],
			}),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`http-${res.status}${body ? `:${body.slice(0, 120)}` : ''}`);
		}
		const json = await res.json() as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const text = json.choices?.[0]?.message?.content?.trim();
		if (!text) {
			throw new Error('empty');
		}
		return text;
	} catch (err) {
		const name = err instanceof Error ? err.name : '';
		const msg = err instanceof Error ? err.message : String(err);
		if (name === 'AbortError' || /aborted|AbortError/i.test(msg)) {
			throw new Error(`timeout-${timeoutMs}ms`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * TokenRouter Flash-0731 first, then Flash. Invalid JSON / timeout falls through.
 */
async function completeAndValidateDesignSpec(
	userPrompt: string,
	log: (msg: string) => void,
	agencySkillPrompt?: string,
	onProgress?: DesignIntelligenceProgressReporter,
): Promise<{ spec: DesignSpecification; modelId: string }> {
	const userMsg = buildDirectorUserPrompt(userPrompt, { agencySkillPrompt });
	const primary =
		process.env.SINGULARITY_DESIGN_DIRECTOR_MODEL
		|| DESIGN_DIRECTOR_MODEL;
	const fallback =
		process.env.SINGULARITY_DESIGN_DIRECTOR_FALLBACK_MODEL
		|| DESIGN_DIRECTOR_FALLBACK_MODEL;
	const primaryTimeout = resolveDirectorTimeoutMs(false);
	const fallbackTimeout = resolveDirectorTimeoutMs(true);

	const token = await resolveTokenRouterEndpoint();
	const attempts: Array<{
		label: string;
		modelId: string;
		endpoint?: { base: string; apiKey: string; timeoutMs: number };
		timeoutMs: number;
	}> = [];

	if (token) {
		attempts.push({
			label: 'TokenRouter Flash-0731',
			modelId: primary,
			endpoint: token,
			timeoutMs: primaryTimeout,
		});
		if (fallback !== primary) {
			attempts.push({
				label: 'TokenRouter Flash',
				modelId: fallback,
				endpoint: token,
				timeoutMs: fallbackTimeout,
			});
		}
	} else {
		// Last resort: OpenRouter-compatible endpoint with Flash id
		attempts.push({
			label: 'OpenRouter-compatible Flash-0731',
			modelId: primary,
			timeoutMs: primaryTimeout,
		});
	}

	const errors: string[] = [];
	const stopHeartbeat = startChatTurnStatusHeartbeat(
		'Creating unique design',
		'Design Director composing typography, colors, and layout…',
	);
	try {
	const { CancellationToken } = await import('vscode');
	const { tokenRouterRpmGate } = await import('../../../extension/byok/vscode-node/tokenRouterRpmGate');
	if (tokenRouterRpmGate.shouldDeferAuxiliaryLlm()) {
		emitDesignProgress(onProgress, 4, 'Creating unique design', 'Waiting for a model slot before Design Director runs…');
	}
	await tokenRouterRpmGate.acquire(CancellationToken.None, { warn: (message) => log(message) });
	for (let i = 0; i < attempts.length; i++) {
		const attempt = attempts[i]!;
		try {
			emitDesignProgress(
				onProgress,
				4,
				'Creating unique design',
				i === 0
					? 'Design Director is composing your art direction…'
					: `Retrying with ${attempt.label}…`,
			);
			log(`[DesignIntelligence] Design Director via ${attempt.label} (${attempt.modelId}) @ ${attempt.endpoint?.base ?? 'openrouter'} — Spec v2 timeout=${attempt.timeoutMs}ms`);
			const text = await chatComplete(
				DIRECTOR_SYSTEM_V2,
				userMsg,
				attempt.modelId,
				0.55,
				attempt.endpoint,
				attempt.timeoutMs,
			);
			const raw = parseDesignSpecLlmJson(text);
			const spec = validateSpec(raw);
			log(`[DesignIntelligence] Design Director OK via ${attempt.label} (product=${spec.product.name})`);
			return { spec, modelId: attempt.modelId };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${attempt.label}:${msg}`);
			log(`[DesignIntelligence] Design Director ${attempt.label} failed (${msg})`);
			// Continue to fallback models — Spec is mandatory for frontend quality.
		}
	}
	throw new Error(errors.join(' | ') || 'director-failed');
	} finally {
		stopHeartbeat();
	}
}

function parseJsonObject<T>(text: string): T {
	const fence = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = fence ? fence[1]!.trim() : text.trim();
	const match = raw.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error('no-json');
	}
	return JSON.parse(match[0]) as T;
}

function getSession(conversationId: string): SessionState {
	let s = sessions.get(conversationId);
	if (!s) {
		s = {
			conversationId,
			frontendActive: false,
			visualIteration: 0,
		};
		sessions.set(conversationId, s);
	}
	return s;
}

export function setFrontendSessionActive(
	conversationId: string,
	active: boolean,
	workspaceRoot?: string,
	userPrompt?: string,
): void {
	activeConversationId = conversationId;
	const s = getSession(conversationId);
	s.frontendActive = active;
	if (workspaceRoot) {
		s.workspaceRoot = workspaceRoot;
	}
	if (userPrompt?.trim()) {
		s.userPrompt = userPrompt.trim();
	}
	if (!active) {
		s.visualIteration = 0;
	}
}

export function isFrontendSessionActive(conversationId?: string): boolean {
	const id = conversationId ?? activeConversationId;
	if (!id) {
		return false;
	}
	return Boolean(sessions.get(id)?.frontendActive);
}

export function getActiveDesignSpecPrompt(conversationId?: string): string {
	const id = conversationId ?? activeConversationId;
	if (!id) {
		return '';
	}
	return sessions.get(id)?.specPrompt ?? '';
}

export function getActiveSkillPrompt(conversationId?: string): string {
	const id = conversationId ?? activeConversationId;
	if (!id) {
		return '';
	}
	return sessions.get(id)?.skillPrompt ?? '';
}

export function getActiveDesignSpec(conversationId?: string): DesignSpecification | undefined {
	const id = conversationId ?? activeConversationId;
	if (!id) {
		return undefined;
	}
	return sessions.get(id)?.spec;
}

/** Test helper — clears in-memory Design Intelligence sessions. */
export function resetDesignIntelligenceSessions(): void {
	sessions.clear();
	activeConversationId = undefined;
}

function resolveWorkspaceRoot(explicit?: string): string | undefined {
	if (explicit && fs.existsSync(explicit)) {
		return explicit;
	}
	try {
		// Lazy require to keep this module usable in unit tests without vscode
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const vscode = require('vscode') as typeof import('vscode');
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		return folder;
	} catch {
		return explicit;
	}
}

function writeDesignSpecFile(root: string, spec: DesignSpecification): string {
	const dir = path.join(root, '.singularity');
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'design-spec.json');
	fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
	return file;
}

/** Persist in-memory Spec when session has art direction but disk file is missing. */
function ensureDesignSpecFileOnDisk(
	conversationId: string,
	workspaceRoot: string | undefined,
	log: (msg: string) => void,
): string | undefined {
	if (!workspaceRoot) {
		return undefined;
	}
	if (loadDesignSpecFile(workspaceRoot)) {
		return path.join(workspaceRoot, '.singularity', 'design-spec.json');
	}
	const spec = getActiveDesignSpec(conversationId);
	if (!spec || isHeuristicDesignSpec(spec)) {
		return undefined;
	}
	const specPath = writeDesignSpecFile(workspaceRoot, spec);
	log(`[DesignIntelligence] wrote missing design-spec.json → ${specPath}`);
	return specPath;
}

/**
 * Whether Agent / CLI should block the turn until Design Director finishes
 * (greenfield UI with no reusable Spec yet).
 */
export function shouldAwaitDesignDirector(
	prompt: string,
	conversationId: string,
	workspaceRoot?: string,
): boolean {
	return promptNeedsDesignIntelligence(prompt)
		&& !isTrivialChatPrompt(prompt)
		&& !getActiveDesignSpecPrompt(conversationId)
		&& !hasReusableDesignSpec(conversationId, workspaceRoot);
}

/**
 * Shared entry for Agent + Singularity CLI — classify skill, write skill.json,
 * produce `.singularity/design-spec.json`, and arm the frontend session.
 */
export async function ensureDesignIntelligenceForTurn(options: {
	conversationId: string;
	prompt: string;
	workspaceRoot?: string;
	log?: (msg: string) => void;
	onProgress?: DesignIntelligenceProgressReporter;
	waitPolicy?: 'reuse' | 'blocking';
}): Promise<{
	ok: boolean;
	specPath?: string;
	reused?: boolean;
	skipped?: boolean;
	error?: string;
}> {
	const log = options.log ?? (() => { });
	const prompt = options.prompt;
	if (!promptNeedsDesignIntelligence(prompt)) {
		return { ok: true, skipped: true };
	}
	if (isTrivialChatPrompt(prompt)) {
		return { ok: true, skipped: true };
	}

	const sessionId = options.conversationId;
	const root = options.workspaceRoot;
	const onProgress = options.onProgress;

	emitDesignProgress(onProgress, 1, 'Design Intelligence', 'Analyzing your UI request…');

	if (getActiveDesignSpecPrompt(sessionId)) {
		emitDesignProgress(onProgress, 2, 'Loading design', 'Reusing art direction from this session…');
		setFrontendSessionActive(sessionId, true, root, prompt);
		const specPath = ensureDesignSpecFileOnDisk(sessionId, root, log);
		emitDesignProgress(onProgress, 6, 'Ready', 'Art direction loaded — starting implementation…');
		return { ok: true, reused: true, specPath };
	}

	const result = await runDesignDirectorForAgent({
		conversationId: sessionId,
		prompt,
		workspaceRoot: root,
		waitPolicy: options.waitPolicy ?? 'reuse',
		log,
		onProgress,
	});
	return {
		ok: result.ok,
		specPath: result.specPath,
		reused: result.reused,
		error: result.error,
	};
}

/** Load existing on-disk Design Spec if present and valid. */
function loadDesignSpecFile(root: string): { path: string; spec: DesignSpecification } | undefined {
	const file = path.join(root, '.singularity', 'design-spec.json');
	if (!fs.existsSync(file)) {
		return undefined;
	}
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
		return { path: file, spec: validateSpec(raw) };
	} catch {
		return undefined;
	}
}

function writeVerdictFile(root: string, iteration: number, verdict: VisualCriticVerdict): string {
	const dir = path.join(root, '.singularity', 'visual-qa', `iter-${iteration}`);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'verdict.json');
	fs.writeFileSync(file, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
	return file;
}

/**
 * Heuristic pre-scan of UI sources for generic AI SaaS tells.
 * Used when browser screenshots are unavailable in Agent mode.
 */
export function scanWorkspaceForGenericSlop(root: string): CriticFinding[] {
	const findings: CriticFinding[] = [];
	const roots = [
		path.join(root, 'src'),
		path.join(root, 'app'),
		path.join(root, 'components'),
	].filter((p) => fs.existsSync(p));

	const files: string[] = [];
	const walk = (dir: string, depth = 0): void => {
		if (depth > 4 || files.length > 40) {
			return;
		}
		let entries: string[] = [];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return;
		}
		for (const name of entries) {
			if (name === 'node_modules' || name === '.next' || name === 'dist') {
				continue;
			}
			const full = path.join(dir, name);
			let st: fs.Stats;
			try {
				st = fs.statSync(full);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(full, depth + 1);
			} else if (/\.(tsx|jsx|css)$/.test(name)) {
				files.push(full);
			}
		}
	};
	for (const r of roots) {
		walk(r);
	}

	let joined = '';
	for (const f of files.slice(0, 40)) {
		try {
			joined += `\n${fs.readFileSync(f, 'utf8').slice(0, 8000)}`;
		} catch {
			/* skip */
		}
	}
	if (!joined.trim()) {
		findings.push({
			severity: 'high',
			issue: 'No frontend source found to evaluate',
			evidence: 'src/app/components empty or missing',
			recommendation: 'Implement the Design Spec into real .tsx/.css files before finishing',
		});
		return findings;
	}

	const lower = joined.toLowerCase();
	if (/from-blue-\d+.*to-purple|from-indigo|to-violet|purple-6|blue-5.*purple/.test(lower)) {
		findings.push({
			severity: 'critical',
			issue: 'Blue→purple / indigo gradient brand identity detected',
			evidence: 'Tailwind blue/purple/indigo/violet gradient classes in UI sources',
			recommendation: 'Replace with Design Spec accent; ban blue-purple as page identity',
			target: 'globals.css / Hero',
		});
	}
	if (/\bzinc-9|\bzinc-95|\bslate-95/.test(lower) && /purple|indigo|violet|from-blue/.test(lower)) {
		findings.push({
			severity: 'high',
			issue: 'Dark zinc + purple/blue SaaS default combo',
			evidence: 'zinc/slate dark canvas with blue/purple accents',
			recommendation: 'Follow Design Spec background + accent from product metaphor',
		});
	}
	if (/meshdistort|floatingsphere|distortmaterial|bokeh/.test(lower)) {
		findings.push({
			severity: 'critical',
			issue: 'Decorative MeshDistort / blob hero detected',
			evidence: 'Three.js distort/blob primitives in source',
			recommendation: 'Replace with product-specific SVG/diagram from Design Spec signature_element',
			target: 'Hero / canvas',
		});
	}
	if ((joined.match(/from ['"]lucide-react['"]/g) || []).length >= 1
		&& /grid.*gap|grid-cols-[34]/.test(lower)
		&& (joined.match(/lucide-react/g) || []).length >= 1) {
		const lucideImports = (joined.match(/\{[^}]+\} from ['"]lucide-react['"]/g) || []).join(' ');
		if ((lucideImports.match(/,/g) || []).length >= 2) {
			findings.push({
				severity: 'high',
				issue: 'Likely Lucide icon feature-card grid',
				evidence: 'Multiple lucide-react icons + card grid layout',
				recommendation: 'Replace generic icon cards with product-specific sections/copy per Design Spec',
				target: 'Features.tsx',
			});
		}
	}
	if (/\bfont-geist\b|geist_sans|inter['"]|fonts\.google\.com\/.*inter/i.test(joined)
		&& !/syne|manrope|newsreader|fraunces|plex|space.?grotesk|instrument|archivo|jakarta|dm.?sans|jetbrains/i.test(joined)) {
		findings.push({
			severity: 'high',
			issue: 'Lazy Inter/Geist without Spec font personality pairing',
			evidence: 'Geist/Inter referenced without expressive Spec display face',
			recommendation: 'Use Design Spec typography from the chosen font personality (e.g. Syne+Manrope, Space Grotesk+Inter, Instrument Serif+Inter)',
		});
	}
	if (/everything you need to build/i.test(joined)) {
		findings.push({
			severity: 'medium',
			issue: 'Generic AI marketing copy',
			evidence: '"Everything you need to build…" phrasing',
			recommendation: 'Write platform-specific copy from the product metaphor',
		});
	}
	if (!/svg|diagram|architecture|router|inference|pipeline/i.test(joined)
		&& /landing|hero|waitlist/i.test(joined)) {
		findings.push({
			severity: 'high',
			issue: 'No obvious product signature visual / diagram',
			evidence: 'Landing/hero sources lack SVG/diagram/product metaphor markers',
			recommendation: 'Implement Design Spec signature_element as a custom SVG/diagram',
		});
	}

	return findings;
}

function scoresFromFindings(findings: CriticFinding[]): VisualScores {
	const critical = findings.filter((f) => f.severity === 'critical').length;
	const high = findings.filter((f) => f.severity === 'high').length;
	const genericness = Math.min(100, 25 + critical * 25 + high * 15);
	const brand = Math.max(0, 85 - critical * 20 - high * 12);
	const product = Math.max(0, 85 - critical * 18 - high * 12);
	const overall = Math.round((100 - genericness + brand + product) / 3);
	return {
		genericness,
		brandDistinctiveness: brand,
		productCommunication: product,
		visualHierarchy: Math.max(40, overall - 5),
		typography: Math.max(40, brand - 5),
		responsiveQuality: 60,
		overallDesignQuality: overall,
	};
}

function applyGates(scores: VisualScores): { pass: boolean; reasons: string[] } {
	const reasons: string[] = [];
	if (scores.genericness > MAX_GENERICNESS) {
		reasons.push(`Genericness ${scores.genericness} > ${MAX_GENERICNESS}`);
	}
	if (scores.brandDistinctiveness < MIN_BRAND) {
		reasons.push(`Brand distinctiveness ${scores.brandDistinctiveness} < ${MIN_BRAND}`);
	}
	if (scores.productCommunication < MIN_PRODUCT) {
		reasons.push(`Product communication ${scores.productCommunication} < ${MIN_PRODUCT}`);
	}
	return { pass: reasons.length === 0, reasons };
}

function formatRefineFeedback(verdict: VisualCriticVerdict, specPrompt: string, userPrompt?: string): string {
	const scope = userPrompt?.trim()
		? `ORIGINAL USER REQUEST (do only this — do not expand scope):\n${userPrompt.trim()}`
		: 'ORIGINAL USER REQUEST: (unknown) — still do the minimum fix only.';

	return [
		'VISUAL CRITIC FAILED — continue refining (do not stop).',
		`Iteration ${verdict.iteration}/${MAX_VISUAL_ITERATIONS}`,
		`Scores: genericness=${verdict.scores.genericness}, brand=${verdict.scores.brandDistinctiveness}, product=${verdict.scores.productCommunication}, overall=${verdict.scores.overallDesignQuality}`,
		verdict.summary,
		'',
		scope,
		'',
		'SCOPE LOCK (mandatory):',
		'- Do ONLY what the user asked. Do not invent a new product roadmap.',
		'- Do NOT create or expand manage_todo_list / todo.md with multi-step rebuild plans.',
		'- Do NOT scaffold a new project (no `npm create`, Vite/Next re-init, or greenfield rewrite) unless the user explicitly asked to scaffold.',
		'- Prefer small edits to existing files already in the workspace.',
		'- Fix the findings below; then stop. No extra polish beyond those findings + the user request.',
		'',
		'Actionable findings:',
		...verdict.findings.map(
			(f) =>
				`- [${f.severity}] ${f.issue}\n  Evidence: ${f.evidence}\n  Fix: ${f.recommendation}${f.target ? `\n  Target: ${f.target}` : ''}`,
		),
		'',
		'Preserve Design Spec art direction while fixing:',
		specPrompt,
	].join('\n');
}

/**
 * Run Design Director for an Agent frontend turn:
 * classify agency skill → write skill.json → LLM Spec (skill + template) → design-spec.json.
 * Reuses Spec for follow-up tweaks; optional forceRefresh regenerates; when Spec exists and
 * refresh is needed without force, returns reuse immediately and refreshes in background.
 */
export async function runDesignDirectorForAgent(options: {
	conversationId: string;
	prompt: string;
	workspaceRoot?: string;
	log?: (msg: string) => void;
	onProgress?: DesignIntelligenceProgressReporter;
	/** Bypass reuse and regenerate Spec. */
	forceRefresh?: boolean;
	/**
	 * When a Spec already exists:
	 * - 'reuse' (default): return immediately; schedule background refresh if needed
	 * - 'blocking': await full Director when refresh is needed
	 */
	waitPolicy?: 'reuse' | 'blocking';
}): Promise<{
	ok: boolean;
	specPath?: string;
	skillPath?: string;
	skillId?: string;
	error?: string;
	reused?: boolean;
	refreshScheduled?: boolean;
}> {
	const log = options.log ?? (() => { });
	const onProgress = options.onProgress;
	const root = resolveWorkspaceRoot(options.workspaceRoot);
	setFrontendSessionActive(options.conversationId, true, root, options.prompt);
	const session = getSession(options.conversationId);
	const waitPolicy = options.waitPolicy ?? 'reuse';

	const adoptExisting = (spec: DesignSpecification, specPath?: string, skillPath?: string, skillId?: string) => {
		session.spec = spec;
		session.specPrompt = formatSpecPrompt(spec);
		session.visualIteration = 0;
		return {
			ok: true as const,
			reused: true as const,
			specPath,
			skillPath,
			skillId,
		};
	};

	if (!options.forceRefresh) {
		// Reuse existing Spec for follow-up turns in the same conversation
		if (session.spec && session.specPrompt && !isHeuristicDesignSpec(session.spec)) {
			const refresh = needsFullSpecRefresh(options.prompt, session.spec);
			if (!refresh) {
				log('[DesignIntelligence] reusing Design Spec for conversation (tweak / same direction)');
				emitDesignProgress(onProgress, 2, 'Loading design', 'Reusing art direction from this conversation…');
				emitDesignProgress(onProgress, 6, 'Ready', 'Art direction ready — starting implementation…');
				return {
					...adoptExisting(
						session.spec,
						root ? path.join(root, '.singularity', 'design-spec.json') : undefined,
						root ? path.join(root, '.singularity', 'skill.json') : undefined,
						session.skill?.id ?? session.skillArtifact?.id,
					),
				};
			}
			if (waitPolicy === 'reuse') {
				log('[DesignIntelligence] reusing Design Spec and scheduling background refresh');
				emitDesignProgress(onProgress, 2, 'Loading design', 'Reusing current art direction (refresh in background)…');
				emitDesignProgress(onProgress, 6, 'Ready', 'Art direction ready — starting implementation…');
				scheduleDesignSpecRefresh({
					conversationId: options.conversationId,
					prompt: options.prompt,
					workspaceRoot: root,
					log,
				});
				return {
					...adoptExisting(
						session.spec,
						root ? path.join(root, '.singularity', 'design-spec.json') : undefined,
						root ? path.join(root, '.singularity', 'skill.json') : undefined,
						session.skill?.id ?? session.skillArtifact?.id,
					),
					refreshScheduled: true,
				};
			}
			// blocking: fall through to regenerate
		}

		// Prefer on-disk Spec — never overwrite a real Design Spec on tweak turns.
		// Heuristic leftovers from failed LLM runs are NOT reused — regenerate.
		if (root) {
			const existing = loadDesignSpecFile(root);
			if (existing && !isHeuristicDesignSpec(existing.spec)) {
				session.spec = existing.spec;
				session.specPrompt = formatSpecPrompt(existing.spec);
				session.visualIteration = 0;
				const existingSkill = loadSkillArtifactFile(root);
				if (existingSkill) {
					session.skillArtifact = existingSkill;
					session.skillPrompt = formatSkillArtifactForPrompt(existingSkill);
				}
				const refresh = needsFullSpecRefresh(options.prompt, existing.spec);
				if (!refresh || waitPolicy === 'reuse') {
					log(`[DesignIntelligence] reusing existing Design Spec → ${existing.path}${refresh ? ' (+ background refresh)' : ''}`);
					emitDesignProgress(
						onProgress,
						2,
						'Loading design',
						`Reusing ${existing.spec.product.name} from design-spec.json…`,
					);
					emitDesignProgress(onProgress, 6, 'Ready', 'Art direction ready — starting implementation…');
					if (refresh) {
						scheduleDesignSpecRefresh({
							conversationId: options.conversationId,
							prompt: options.prompt,
							workspaceRoot: root,
							log,
						});
					}
					return {
						ok: true,
						reused: true,
						refreshScheduled: refresh,
						specPath: existing.path,
						skillPath: existingSkill
							? path.join(root, '.singularity', 'skill.json')
							: undefined,
						skillId: existingSkill?.id,
					};
				}
			}
			if (existing && isHeuristicDesignSpec(existing.spec)) {
				log(`[DesignIntelligence] ignoring heuristic Design Spec on disk — regenerating via LLM`);
				emitDesignProgress(onProgress, 3, 'Refreshing design', 'Replacing placeholder spec with a full design…');
			}
		}
	}

	try {
		emitDesignProgress(onProgress, 2, 'Fetching skills', 'Scanning agency skill library…');
		const classification = await classifyAgencyAgent(options.prompt);
		const skill = requireAgencySkill(classification.skillId);
		const skillPrompt = formatAgencySkillForPrompt(skill);
		emitDesignProgress(
			onProgress,
			3,
			'Skill selected',
			`Matched ${skill.id} (${classification.source}, ${Math.round(classification.confidence * 100)}% confidence)`,
		);
		const artifact = agencySkillToArtifact(skill, {
			prompt: options.prompt,
			classification: {
				confidence: classification.confidence,
				reason: classification.reason,
				source: classification.source,
			},
		});
		session.skill = skill;
		session.skillArtifact = artifact;
		session.skillPrompt = skillPrompt;
		log(
			`[DesignIntelligence] agency skill → ${skill.id} (${classification.source}, conf=${classification.confidence.toFixed(2)})`,
		);

		let skillPath: string | undefined;
		if (root) {
			emitDesignProgress(onProgress, 3, 'Saving skill', 'Writing .singularity/skill.json…');
			skillPath = writeSkillArtifactFile(root, artifact);
			log(`[DesignIntelligence] skill.json written → ${skillPath}`);
		}

		let spec: DesignSpecification;
		let modelId: string;
		({ spec, modelId } = await completeAndValidateDesignSpec(
			options.prompt,
			log,
			skillPrompt,
			onProgress,
		));
		session.spec = spec;
		session.specPrompt = formatSpecPrompt(spec);
		session.visualIteration = 0;

		let specPath: string | undefined;
		if (root) {
			emitDesignProgress(onProgress, 5, 'Saving design spec', 'Writing .singularity/design-spec.json…');
			specPath = writeDesignSpecFile(root, spec);
			log(`[DesignIntelligence] Design Spec written → ${specPath} (product=${spec.product.name}, model=${modelId})`);
		} else {
			log('[DesignIntelligence] Design Spec ready (no workspace root to write)');
		}
		emitDesignProgress(onProgress, 6, 'Ready', `Art direction ready for ${spec.product.name} — implementing…`);
		return { ok: true, specPath, skillPath, skillId: skill.id };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		log(`[DesignIntelligence] Design Director failed (${message}) — writing starter Spec so frontend can proceed`);
		emitDesignProgress(onProgress, 4, 'Creating unique design', 'Using starter art direction (Director unavailable)…');
		// Always persist a starter Spec (React Bits + GodUI locked) so Agent has art direction.
		const starter = buildStarterDesignSpec(options.prompt);
		session.spec = starter;
		session.specPrompt = formatSpecPrompt(starter);
		session.visualIteration = 0;
		let specPath: string | undefined;
		if (root) {
			emitDesignProgress(onProgress, 5, 'Saving design spec', 'Writing .singularity/design-spec.json…');
			specPath = writeDesignSpecFile(root, starter);
			log(`[DesignIntelligence] starter Design Spec written → ${specPath}`);
		}
		emitDesignProgress(onProgress, 6, 'Ready', `Art direction ready for ${starter.product.name} — implementing…`);
		return {
			ok: true,
			specPath,
			skillPath: root ? path.join(root, '.singularity', 'skill.json') : undefined,
			skillId: session.skill?.id,
			error: message,
		};
	}
}

/**
 * Visual Critic for Agent Stop hook.
 * Returns shouldContinue + refine feedback when FAIL and iterations remain.
 */
export async function runVisualCriticForAgentStop(options: {
	conversationId?: string;
	log?: (msg: string) => void;
}): Promise<{ shouldContinue: boolean; reasons: string[] }> {
	const log = options.log ?? (() => { });
	const id = options.conversationId ?? activeConversationId;
	if (!id) {
		return { shouldContinue: false, reasons: [] };
	}
	const session = sessions.get(id);
	if (!session?.frontendActive || !session.spec || !session.specPrompt) {
		return { shouldContinue: false, reasons: [] };
	}

	if (session.visualIteration >= MAX_VISUAL_ITERATIONS) {
		log('[DesignIntelligence] Visual Critic max iterations reached — allowing stop');
		return { shouldContinue: false, reasons: [] };
	}

	session.visualIteration += 1;
	const iteration = session.visualIteration;
	const root = session.workspaceRoot ?? resolveWorkspaceRoot();

	const heuristicFindings = root ? scanWorkspaceForGenericSlop(root) : [];
	let scores = scoresFromFindings(heuristicFindings);
	let findings = [...heuristicFindings];
	let summary = 'Heuristic visual scan';

	// Browser capture at 3 viewports when a local preview is up
	let captureDigest = 'No live browser captures.';
	if (root) {
		try {
			const capture = await captureAgentPreview({
				workspaceRoot: root,
				iteration,
				log,
			});
			captureDigest = formatCaptureDigest(capture);
			if (!capture.previewAvailable && capture.note) {
				findings.push({
					severity: 'medium',
					issue: 'Live preview unavailable for screenshot QA',
					evidence: capture.note,
					recommendation:
						'Keep the Next/Vite preview running (`npm run dev`) so Visual Critic can capture desktop/laptop/mobile screenshots',
				});
			}
			for (const c of capture.captures) {
				if (c.consoleErrors.length || c.runtimeErrors.length) {
					findings.push({
						severity: 'high',
						issue: `Runtime/console errors on ${c.viewport.name}`,
						evidence: [...c.consoleErrors, ...c.runtimeErrors].slice(0, 3).join('; '),
						recommendation: 'Fix console/runtime errors before shipping UI',
						target: c.screenshotPath,
					});
				}
				const dom = (c.domSummary || '').toLowerCase();
				if (/from-blue|to-purple|to-violet|indigo/.test(dom)) {
					findings.push({
						severity: 'critical',
						issue: 'Blue→purple SaaS gradient visible in live DOM',
						evidence: `${c.viewport.name} DOM mentions blue/purple/indigo classes`,
						recommendation: 'Replace with Design Spec accent colors',
						target: c.screenshotPath,
					});
				}
			}
			scores = scoresFromFindings(findings);
			summary = capture.previewAvailable
				? `Browser capture @ ${capture.url} + source scan`
				: 'Source scan (no live preview)';
		} catch (e) {
			log(`[DesignIntelligence] capture step skipped: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// Optional LLM critic when we have API access
	try {
		const fileDigest = root
			? heuristicFindings.map((f) => f.issue).join('; ') || 'sources present'
			: 'no workspace';
		const text = await chatComplete(
			CRITIC_SYSTEM,
			[
				session.specPrompt,
				`Heuristic findings: ${fileDigest}`,
				`Browser captures:\n${captureDigest}`,
				`Iteration: ${iteration}`,
				'Score the implementation. If sources or live DOM show banned patterns, FAIL.',
			].join('\n\n'),
			process.env.SINGULARITY_VISUAL_CRITIC_MODEL || VISUAL_CRITIC_MODEL,
			0.2,
		);
		const parsed = parseJsonObject<{
			pass?: boolean;
			scores?: Partial<VisualScores>;
			findings?: CriticFinding[];
			summary?: string;
		}>(text);
		if (parsed.scores) {
			scores = {
				genericness: Number(parsed.scores.genericness ?? scores.genericness),
				brandDistinctiveness: Number(parsed.scores.brandDistinctiveness ?? scores.brandDistinctiveness),
				productCommunication: Number(parsed.scores.productCommunication ?? scores.productCommunication),
				visualHierarchy: Number(parsed.scores.visualHierarchy ?? 60),
				typography: Number(parsed.scores.typography ?? 60),
				responsiveQuality: Number(parsed.scores.responsiveQuality ?? 60),
				overallDesignQuality: Number(parsed.scores.overallDesignQuality ?? 60),
			};
		}
		if (Array.isArray(parsed.findings) && parsed.findings.length) {
			findings = [...findings, ...parsed.findings.filter((f) => f?.issue && f?.recommendation)];
		}
		summary = parsed.summary || summary;
	} catch (e) {
		log(`[DesignIntelligence] LLM critic skipped (${e instanceof Error ? e.message : String(e)})`);
	}

	const gate = applyGates(scores);
	const pass = gate.pass && findings.filter((f) => f.severity === 'critical').length === 0;
	const verdict: VisualCriticVerdict = {
		version: 1,
		pass,
		scores,
		findings,
		summary: pass ? summary : [summary, ...gate.reasons].join(' · '),
		iteration,
	};
	session.lastVerdict = verdict;

	if (root) {
		try {
			writeVerdictFile(root, iteration, verdict);
		} catch {
			/* ignore */
		}
	}

	log(
		`[DesignIntelligence] Visual Critic iter=${iteration} pass=${pass} ` +
		`genericness=${scores.genericness} brand=${scores.brandDistinctiveness}`,
	);

	if (pass) {
		return { shouldContinue: false, reasons: [] };
	}

	const feedback = formatRefineFeedback(verdict, session.specPrompt, session.userPrompt);
	return { shouldContinue: true, reasons: [feedback] };
}

/** Append Design Spec (+ agency skill) onto an existing design-source agent brief. */
export function mergeBriefWithDesignSpec(agentBrief: string, conversationId?: string): string {
	const specPrompt = getActiveDesignSpecPrompt(conversationId);
	const skillPrompt = getActiveSkillPrompt(conversationId);
	if (!specPrompt && !skillPrompt) {
		return agentBrief;
	}
	return [
		skillPrompt,
		skillPrompt && specPrompt ? '' : '',
		specPrompt,
		'',
		'IMPLEMENTATION RULE: Follow the Design Specification above. Component libraries are tools — not art direction.',
		skillPrompt
			? 'Also apply the AGENCY SKILL specialist lens without inventing a new art direction.'
			: '',
		'',
		agentBrief,
	]
		.filter((line) => line !== undefined)
		.join('\n');
}
