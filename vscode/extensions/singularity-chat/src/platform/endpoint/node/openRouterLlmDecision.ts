/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Decision LLM for Singularity Auto (catalog picker).
 * Prefers TokenRouter Flash for latency; OpenRouter Nemotron is fallback.
 * Short stay-cache skips redundant LLM calls on tiny follow-up tweaks.
 */

import { applySingularityBundledEnv, ensureFreshTokenRouterApiKey, getDeepSeekDirectConfig, getTokenRouterApiKey, getTokenRouterBaseUrl, getChatCompletionsAuthHeaders, mapDeepSeekOfficialModelId } from '../../env/node/singularityBundledEnv';
import {
	decideFlashOrPro,
	isNemotronRouterEnabled,
} from '../../../../../../../packages/router/src/nemotronFlashPro/index';

export const DECISION_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
/** Prefer a short timeout — fall back to rules rather than stalling Auto for 15s. */
export const DECISION_TIMEOUT_MS = 8_000;
/** Cap the Auto decision LLM so it cannot stall the coding request. */
export const DECISION_HOT_PATH_TIMEOUT_MS = 1_200;
/** Fast decision path via TokenRouter when beta/gateway auth is available. */
export const DECISION_GATEWAY_MODEL = 'deepseek/deepseek-v4-flash-0731';
/** Keep decision completions tiny — only need one JSON object. */
export const DECISION_MAX_TOKENS = 220;
/** Reuse last LLM decision for identical / tweak prompts within this window. */
const DECISION_STAY_CACHE_MS = 90_000;

const FLASH = 'deepseek/deepseek-v4-flash-0731';
/** Pro is disabled — all former Pro slots use Flash-0731. */
const PRO = FLASH;
const VISION = 'google/gemini-2.5-flash';

export interface LlmDecisionInput {
	prompt: string;
	mode?: string;
	openFileCount?: number;
	hasImages?: boolean;
	/** Short gist of prior turns (provider-independent). */
	conversationGist?: string;
	/** Catalog or live model used on the previous turn. */
	previousModelId?: string;
	previousTier?: string;
	previousIntent?: string;
	turnCount?: number;
	/** True when Design Intelligence already marked this conversation as frontend. */
	frontendSessionActive?: boolean;
}

export interface LlmDecisionResult {
	tier: string;
	subTier: string;
	modelId: string;
	intent: string;
	confidence: number;
	reason: string;
	latencyMs: number;
	source: 'llm' | 'rules' | 'timeout' | 'error';
	/** True when Ling recommends staying on previous model. */
	stay?: boolean;
	/**
	 * Specialty lane from Nemotron understanding.
 * frontend → pin DeepSeek Pro 0813 (coding) via TokenRouter
	 */
	specialty?: 'frontend' | 'backend' | 'ai-pipeline' | 'infrastructure' | 'general';
}

/** One card per architecture slot — Singularity defaults to Flash + Pro-0813. */
const MODEL_CARDS = `
T0.1|${FLASH}|cost=very_low|USE: greetings, small talk, normal Q&A, autocomplete, tiny edits. AVOID: multi-file, hard bugs.
T0.2|${FLASH}|cost=very_low|USE: small functions, regex, bash, one-file fixes. AVOID: deep reasoning, large refactors.
T0.3|${FLASH}|cost=very_low|USE: quick explain/summarize of a selection. AVOID: heavy coding.
T0.4|${VISION}|cost=very_low|USE: screenshots / attached images only (DeepSeek has no vision). AVOID: text-only coding.
T0.5|${FLASH}|cost=very_low|USE: config/docs/package.json snippets. AVOID: architecture.
T1.0|${PRO}|cost=medium|USE: BASIC DEVELOPMENT — implement/edit/write functions, components, everyday coding. AVOID: pure chat/Q&A (use T0.1).
T1.1|${PRO}|cost=medium|USE: medium edits, tests, components. AVOID: hello/small talk.
T1.2|${PRO}|cost=medium|USE: multi-file coding, solid bugfixes. AVOID: vision-only tasks.
T1.3|${PRO}|cost=medium|USE: repo navigation + coding. AVOID: heavy generation waste on chat.
T1.4|${PRO}|cost=medium|USE: agent/tool multi-step edits. AVOID: autocomplete-only.
T1.5|${PRO}|cost=medium|USE: new modules, apps, codegen. AVOID: long docs-only chat.
T2.1|${PRO}|cost=medium|USE: FRONTEND / agent coding owner via TokenRouter — React/UI/CSS/dashboards. AVOID: ultra-cheap autocomplete.
T2.2|${PRO}|cost=medium|USE: long docs + coding follow-ups. AVOID: hello/small talk.
T2.3|${FLASH}|cost=very_low|USE: README/markdown/tutorials. AVOID: hard algorithms.
T2.4|${PRO}|cost=medium|USE: concept teaching tied to code. AVOID: mission-critical without tools.
T2.5|${PRO}|cost=medium|USE: specs/RFC when coding follows. AVOID: tiny chat.
T3.1|${PRO}|cost=medium|USE: hard bugs, stack traces, algorithms. AVOID: casual chat.
T3.2|${PRO}|cost=medium|USE: multi-step planning/research then code. AVOID: one-liners.
T3.3|${PRO}|cost=medium|USE: PR review, medium reasoning. AVOID: hello.
T3.4|${PRO}|cost=medium|USE: large-context debug. AVOID: small talk.
T3.5|${PRO}|cost=medium|USE: hard coding, multi-file refactors. AVOID: trivial questions.
T4.1|${PRO}|cost=medium|USE: entire repos / long logs. AVOID: short chat.
T4.2|${PRO}|cost=medium|USE: massive codebases. AVOID: greetings.
T4.3|${PRO}|cost=medium|USE: long-horizon agent work. AVOID: autocomplete.
T4.4|${PRO}|cost=medium|USE: complex multi-file work. AVOID: tiny Q&A.
T4.5|${PRO}|cost=medium|USE: high-stakes coding. AVOID: chat.
T5.1|${PRO}|cost=medium|USE: hard refactors / architecture coding. AVOID: greetings.
T5.2|${PRO}|cost=medium|USE: deepest coding tasks. AVOID: small talk.
T5.3|${PRO}|cost=medium|USE: large synthesis + code. AVOID: hello.
T5.4|${PRO}|cost=medium|USE: critical coding. AVOID: autocomplete.
T5.5|${PRO}|cost=medium|USE: hard agent loops. AVOID: chat.
T6.1|${PRO}|cost=medium|USE: hardest reasoning+code. AVOID: greetings.
T6.2|${PRO}|cost=medium|USE: hardest agent work. AVOID: small talk.
T6.3|${PRO}|cost=medium|USE: deepest debug. AVOID: hello.
T6.4|${PRO}|cost=medium|USE: extreme multi-step. AVOID: autocomplete.
T6.5|${PRO}|cost=medium|USE: last-resort hard coding. AVOID: chat.
`.trim();



const SYSTEM = `You are Singularity's model router (cost-aware + specialty-aware). Pick ONE model from the catalog for this turn.

OUTPUT: your FINAL line must be ONLY one JSON object (no markdown fences):
{"tier":"T2","subTier":"T2.1","modelId":"deepseek/deepseek-v4-pro-0813","intent":"AGENT","confidence":0.9,"reason":"ui polish","stay":false,"specialty":"frontend"}
Keep any reasoning short. modelId MUST be an exact id from the catalog below.

SPECIALTY LANES (understand intent — do not rely only on keywords):
- frontend → UI/React/CSS/pages/components/layouts/visual polish. MUST use deepseek/deepseek-v4-pro-0813 (T2.1) via TokenRouter. Examples: "polish the landing page", "make the dashboard less cluttered", "build a settings screen".
- backend → APIs, databases, auth servers
- ai-pipeline → LLM/RAG/embeddings/inference jobs
- infrastructure → docker/k8s/CI/deploy
- general → multi-lane product goals (UI + API + AI) OR unclear — pick a planning/coding model, NOT forced to the frontend owner

MONEY RULES (critical):
- Prefer the CHEAPEST / FASTEST model that can do the job. Never pick premium for ego.
- Greetings, thanks, how-are-you, small talk, "what can you do", normal questions / Q&A → ALWAYS T0.1 deepseek/deepseek-v4-flash-0731.
- BASIC DEVELOPMENT (implement/write/fix/add a function, component, small feature, everyday coding) → ALWAYS T1.0 deepseek/deepseek-v4-pro-0813.
- Do NOT use Kimi/Claude/GPT-4o/Opus/Sonnet/o1 for casual or basic questions.
- If previous turn used a premium model but THIS turn is basic/simple Q&A, DOWNSHIFT (stay=false) to T0.1 flash — switching saves money because conversation state lives in Singularity, not the provider.
- Only STAY on the previous model when this turn still needs similar capability OR context is huge and same-provider cache would help AND quality delta is tiny.
- Hard bugs/algorithms → T3.*; big refactors/architecture → T5.*; images → vision model (T0.4).
- When specialty=frontend, modelId MUST be deepseek/deepseek-v4-pro-0813 (TokenRouter). Prefer deepseek/deepseek-v4-flash-0731 only for tiny Q&A.
- modelId MUST be exactly an id from the catalog below.

CATALOG (subTier|id|cost|bio):
${MODEL_CARDS}`;

const VALID_IDS = new Set(
	MODEL_CARDS.split('\n').map((l) => l.split('|')[1]!).filter(Boolean),
);

const SUB_TIER_TO_MODEL = Object.fromEntries(
	MODEL_CARDS.split('\n').map((l) => {
		const [sub, id] = l.split('|');
		return [sub!, id!];
	}),
) as Record<string, string>;

interface DecisionStayEntry {
	result: LlmDecisionResult;
	promptNorm: string;
	at: number;
	previousModelId?: string;
}

/** Per-conversation stay cache so tiny follow-ups skip a full decide round-trip. */
const decisionStayCache = new Map<string, DecisionStayEntry>();

/** Coalesce parallel decide() calls for the same conversation + prompt. */
const decisionInflight = new Map<string, Promise<LlmDecisionResult>>();

/* Decision-LLM helpers — unused while keyword routing is on.
function isProModelId(modelId: string | undefined): boolean {
	if (!modelId) {
		return false;
	}
	return /deepseek\/deepseek-v4-pro/i.test(modelId);
}

function isCodingIntent(intent: string | undefined): boolean {
	if (!intent) {
		return false;
	}
	return /^(AGENT|CODE|DEBUG|REFACTOR|TEST)$/i.test(intent);
}
*/

export class OpenRouterLlmDecisionEngine {
	constructor(
		private readonly log: (msg: string) => void = () => { },
	) { }

	/** Instant path: autocomplete + greetings/small-talk (no decision LLM round-trip). */
	tryInstant(input: LlmDecisionInput): LlmDecisionResult | undefined {
		if (input.mode === 'autocomplete') {
			return result('T0', 'T0.1', 'deepseek/deepseek-v4-flash-0731', 'AUTOCOMPLETE', 1, 'autocomplete', 0, 'rules', false);
		}
		const raw = input.prompt.trim();
		const p = raw.toLowerCase();
		if (isCasualChat(p, raw) || /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great)[\s!.?]*$/i.test(raw)) {
			return result('T0', 'T0.1', 'deepseek/deepseek-v4-flash-0731', 'UNKNOWN', 1, 'greeting-instant', 0, 'rules', false);
		}
		return undefined;
	}

	async decide(input: LlmDecisionInput, conversationKey?: string): Promise<LlmDecisionResult> {
		const instant = this.tryInstant(input);
		if (instant) {
			return instant;
		}

		const cacheKey = conversationKey ?? 'default';
		const inflightKey = `${cacheKey}::${normalizeDecisionPrompt(input.prompt)}`;
		const existing = decisionInflight.get(inflightKey);
		if (existing) {
			this.log(`[LlmDecision] coalesce → awaiting in-flight decide (${inflightKey.slice(0, 80)})`);
			return existing;
		}

		const run = this._decideUncached(input, cacheKey).finally(() => {
			decisionInflight.delete(inflightKey);
		});
		decisionInflight.set(inflightKey, run);
		return run;
	}

	private async _decideUncached(input: LlmDecisionInput, cacheKey: string): Promise<LlmDecisionResult> {
		void cacheKey;
		if (input.hasImages) {
			return result('T0', 'T0.4', VISION, 'EXPLAIN', 0.9, 'images', 0, 'rules', false);
		}
		if (isNemotronRouterEnabled()) {
			try {
				const nemo = await decideFlashOrPro(input.prompt);
				this.log(
					`[LlmDecision] nemotron → ${nemo.choice} (${nemo.modelId}) src=${nemo.source} ${nemo.latencyMs}ms`,
				);
				if (nemo.source === 'llm') {
					const isPro = nemo.choice === 'pro';
					return result(
						isPro ? 'T2' : 'T0',
						isPro ? 'T2.1' : 'T0.1',
						nemo.modelId,
						isPro ? 'AGENT' : 'CODE',
						0.9,
						`nemotron:${nemo.choice}`,
						nemo.latencyMs,
						'llm',
						false,
					);
				}
			} catch (e) {
				this.log(`[LlmDecision] nemotron error (${e instanceof Error ? e.message : String(e)}); keyword fallback`);
			}
		}
		const out = this.rules(input, 'rules', 0);
		this.log(`[LlmDecision] keywords → ${out.modelId} (${out.reason})`);
		return out;

		/*
		 * Decision LLM fetch (Nemotron / Flash classifier) — keep for later.
		 *
		const cached = tryStayCacheHit(cacheKey, input);
		if (cached) {
			this.log(`[LlmDecision] stay-cache → ${cached.modelId} (${cached.reason})`);
			return cached;
		}

		const llmDisabled = process.env.SINGULARITY_LLM_ROUTER === '0';
		const endpoint = await resolveDecisionEndpoint();
		if (llmDisabled || !endpoint.apiKey) {
			this.log(`[LlmDecision] rules-only (llmDisabled=${llmDisabled}, hasKey=${Boolean(endpoint.apiKey)})`);
			return this.rules(input, endpoint.apiKey ? 'rules' : 'error', 0);
		}

		const { base, apiKey, model, timeoutMs, via } = endpoint;
		const started = Date.now();
		this.log(`[LlmDecision] calling ${model} @ ${base} via=${via} (timeout ${timeoutMs}ms, max_tokens=${DECISION_MAX_TOKENS})`);
		try {
			const picked = await Promise.race([
				this.call(base, apiKey, model, input, timeoutMs),
				rejectAfter(timeoutMs, 'decision-timeout'),
			]);
			const latencyMs = Date.now() - started;
			this.log(`[LlmDecision] llm → ${picked.modelId} (${picked.reason}) in ${latencyMs}ms`);
			const out: LlmDecisionResult = { ...picked, latencyMs, source: 'llm' };
			rememberStayCache(cacheKey, input, out);
			return out;
		} catch (e) {
			const latencyMs = Date.now() - started;
			const msg = e instanceof Error ? e.message : String(e);
			this.log(`[LlmDecision] RULES FALLBACK after ${latencyMs}ms (${msg}) — not using decision LLM`);
			const out = this.rules(input, msg.includes('timeout') ? 'timeout' : 'error', latencyMs);
			rememberStayCache(cacheKey, input, out);
			return out;
		}
		*/
	}

	private async call(
		base: string,
		apiKey: string,
		model: string,
		input: LlmDecisionInput,
		timeoutMs: number,
	): Promise<Omit<LlmDecisionResult, 'latencyMs' | 'source'>> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const userPayload = {
				prompt: input.prompt.slice(0, 1500),
				mode: input.mode ?? 'chat',
				images: Boolean(input.hasImages),
				turn: input.turnCount ?? 1,
				previousModel: input.previousModelId ?? null,
				previousTier: input.previousTier ?? null,
				previousIntent: input.previousIntent ?? null,
				conversationGist: (input.conversationGist ?? '').slice(0, 800),
				ask: input.previousModelId
					? 'Same conversation. Keep previousModel only if this turn still needs it; otherwise DOWNSHIFT to cheaper if this turn is basic.'
					: 'Pick cheapest model that fits.',
			};
			const res = await fetch(`${base}/chat/completions`, {
				method: 'POST',
				headers: {
					...getChatCompletionsAuthHeaders(apiKey, base),
					'HTTP-Referer': 'https://singularity.local',
					'X-Title': 'Singularity Decision Engine',
				},
				body: JSON.stringify({
					model,
					temperature: 0,
					max_tokens: DECISION_MAX_TOKENS,
					messages: [
						{ role: 'system', content: SYSTEM },
						{ role: 'user', content: JSON.stringify(userPayload) },
					],
				}),
				signal: controller.signal,
			});
			const text = await res.text();
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${text.slice(0, 180)}`);
			}
			const json = JSON.parse(text) as {
				choices?: Array<{ message?: { content?: string | null; reasoning?: string | null } }>;
			};
			const msg = json.choices?.[0]?.message;
			const content = (msg?.content ?? msg?.reasoning ?? '').toString();
			if (!content.trim()) {
				throw new Error('empty-decision-content');
			}
			return parseContent(content, input);
		} finally {
			clearTimeout(timer);
		}
	}

	private rules(input: LlmDecisionInput, source: LlmDecisionResult['source'], latencyMs: number): LlmDecisionResult {
		const instant = this.tryInstant(input);
		if (instant) {
			return { ...instant, source, latencyMs, reason: `${instant.reason}:${source}` };
		}

		const raw = input.prompt.trim();
		const p = raw.toLowerCase();
		const isFollowUp = (input.turnCount ?? 1) > 1 || Boolean(input.previousModelId);
		const flashHit = isKeywordFlashTask(p, raw);
		const proHit = isKeywordProTask(p, raw);

		if (proHit && !(flashHit && !isArchitectureOrReasoning(p))) {
			const stay = Boolean(input.previousModelId && input.previousModelId === PRO);
			return result('T2', 'T2.1', PRO, 'AGENT', 0.92, `keywords-pro:${source}`, latencyMs, source, stay);
		}
		if (flashHit) {
			const stay = Boolean(input.previousModelId && input.previousModelId === FLASH);
			const intent = /\b(bug|error|crash|stack|debug|traceback)\b/.test(p) ? 'DEBUG' : 'CODE';
			return result('T0', 'T0.1', FLASH, intent, 0.95, `keywords-flash:${source}`, latencyMs, source, stay);
		}
		if (!isFollowUp && (isCodebaseExplore(p, raw) || isFirstLeadTask(p, raw))) {
			return result('T2', 'T2.1', PRO, 'AGENT', 0.88, `keywords-first-lead:${source}`, latencyMs, source, false);
		}

		const stay = Boolean(input.previousModelId && input.previousModelId === FLASH);
		return result('T0', 'T0.1', FLASH, isFollowUp ? 'CODE' : 'UNKNOWN', 0.9, `keywords-default-flash:${source}`, latencyMs, source, stay);

		/*
		 * Legacy sticky / specialty rules (decision-LLM era) — keep for later.
		 *
		const gist = (input.conversationGist ?? '').toLowerCase();
		const decisionDegraded = source === 'error' || source === 'timeout';
		const prevIsFrontendOwner =
			input.frontendSessionActive === true
			|| isProModelId(input.previousModelId)
			|| /deepseek\/deepseek-v4-pro/.test(gist)
			|| (isCodingIntent(input.previousIntent) && isProModelId(input.previousModelId))
			|| (/\blaunchpad\b/.test(gist) && /\b(frontend|react|hero|waitlist|landing)\b/.test(gist));
		if (prevIsFrontendOwner && !isStrongBackendOrInfra(p) && !isStrongBackendOrInfra(gist)) {
			return {
				...result('T2', 'T2.1', PRO, 'AGENT', 0.95, `frontend-sticky:${source}`, latencyMs, source, true),
				specialty: 'frontend',
			};
		}
		if (
			decisionDegraded
			&& (isCodingIntent(input.previousIntent) || isProModelId(input.previousModelId) || /\b(AGENT|CODE)\b/.test(gist))
			&& !isCasualChat(p, raw)
			&& !isStrongBackendOrInfra(p)
		) {
			return {
				...result('T2', 'T2.1', PRO, input.previousIntent || 'AGENT', 0.9, `sticky-on-${source}`, latencyMs, source, true),
				specialty: input.frontendSessionActive ? 'frontend' : undefined,
			};
		}
		let tier = 'T1';
		let subTier = 'T1.0';
		let modelId = PRO;
		let intent = 'CODE';
		let confidence = 0.75;
		let reason = 'default-basic-dev';
		const isBuild =
			/\b(make|build|create|write|implement|generate|scaffold|code|add|fix|edit)\b/.test(p) &&
			/\b(game|app|html|css|react|component|function|class|script|page|website|api|tetris|invader|feature|module|file|hook|endpoint|test)\b/.test(p);
		const isBasicDev = isBasicDevelopment(p, raw);
		if (isFrontendDominant(p) || isFrontendDominant(`${gist} ${p}`)) {
			tier = 'T2'; subTier = 'T2.1'; modelId = PRO; intent = 'AGENT'; confidence = 0.9; reason = 'frontend-specialty';
			const stay = false;
			return { ...result(tier, subTier, modelId, intent, confidence, `${reason}:${source}`, latencyMs, source, stay), specialty: 'frontend' };
		}
		if (isCodebaseExplore(p, raw)) {
			tier = 'T2'; subTier = 'T2.1'; modelId = PRO; intent = 'AGENT'; confidence = 0.9; reason = 'codebase-explore';
		} else if (
			!decisionDegraded
			&& (isBasicQuestion(p, raw) || (p.length < 100 && !isBasicDev && !isBuild && !isCodebaseExplore(p, raw)))
		) {
			tier = 'T0'; subTier = 'T0.1'; modelId = FLASH; intent = 'UNKNOWN'; confidence = 0.95; reason = 'basic-or-short';
		} else if (isBasicDev || isBuild) {
			tier = 'T1'; subTier = 'T1.0'; modelId = PRO; intent = 'CODE'; confidence = 0.9; reason = isBasicDev ? 'basic-dev' : 'build';
		} else if (/\b(bug|error|stack|crash|fix|debug|traceback)\b/.test(p)) {
			tier = 'T3'; subTier = 'T3.1'; modelId = PRO; intent = 'DEBUG'; confidence = 0.9; reason = 'debug';
		} else if (/\b(explain|summarize|document|readme)\b/.test(p) || (/\b(what|how)\s+(does|do)\b/.test(p) && /\b(code|function|file|class|this)\b/.test(p))) {
			tier = 'T2'; subTier = 'T2.3'; modelId = FLASH; intent = 'EXPLAIN'; confidence = 0.85; reason = 'explain-cheap';
			if (raw.length > 2_000 || /\b(entire\s+repo|codebase|all\s+files|architecture)\b/.test(p)) {
				tier = 'T2'; subTier = 'T2.2'; modelId = PRO; reason = 'explain-long';
			}
		} else if (/\b(refactor|architect|migrate|redesign)\b/.test(p)) {
			tier = 'T5'; subTier = 'T5.1'; modelId = PRO; intent = 'REFACTOR'; confidence = 0.85; reason = 'refactor';
		} else if (/\b(test|spec|jest|vitest)\b/.test(p)) {
			tier = 'T1'; subTier = 'T1.0'; modelId = PRO; intent = 'TEST'; confidence = 0.85; reason = 'test';
		} else if (input.hasImages) {
			tier = 'T0'; subTier = 'T0.4'; modelId = VISION; intent = 'EXPLAIN'; confidence = 0.9; reason = 'images';
		} else if (decisionDegraded) {
			tier = 'T1'; subTier = 'T1.0'; modelId = PRO; intent = 'CODE'; confidence = 0.8; reason = `degraded-${source}-pro`;
		}
		if (
			!decisionDegraded
			&& input.previousTier
			&& /^T[2-6]/.test(input.previousTier)
			&& (intent === 'UNKNOWN' || reason.startsWith('basic') || isCasualChat(p, raw) || isBasicQuestion(p, raw))
			&& !isBasicDev
		) {
			tier = 'T0'; subTier = 'T0.1'; modelId = FLASH; intent = 'UNKNOWN'; confidence = 0.95; reason = 'downshift-basic';
		}
		const stay = Boolean(input.previousModelId && input.previousModelId === modelId);
		return result(tier, subTier, modelId, intent, confidence, `${reason}:${source}`, latencyMs, source, stay);
		*/
	}
}
/** Append a turn line into a bounded conversation gist. */
export function appendConversationGist(
	prev: string | undefined,
	userPrompt: string,
	modelId: string,
	intent: string,
	maxChars = 700,
): string {
	const line = `U:${userPrompt.replace(/\s+/g, ' ').slice(0, 100)}→${modelId}(${intent})`;
	const next = prev ? `${prev} | ${line}` : line;
	return next.length <= maxChars ? next : next.slice(next.length - maxChars);
}

function result(
	tier: string,
	subTier: string,
	modelId: string,
	intent: string,
	confidence: number,
	reason: string,
	latencyMs = 0,
	source: LlmDecisionResult['source'] = 'rules',
	stay = false,
): LlmDecisionResult {
	return { tier, subTier, modelId, intent, confidence, reason, latencyMs, source, stay };
}

function isCasualChat(p: string, raw: string): boolean {
	if (raw.length > 160) {
		return false;
	}
	if (/\b(code|function|file|bug|error|refactor|html|css|react|typescript|python|stack|commit|pr\b)\b/.test(p)) {
		return false;
	}
	return (
		/\b(how (are|have|is) (you|things)|how('s|s) it going|what'?s up|who are you|how do you (feel|work)|tell (me )?about (yourself|you)|what can you (do|tell|start)|about me\b|nice to meet|good (morning|afternoon|evening)|you tell me|what should (we|i) (start|do|work)|where (do|should) (we|i) start)\b/.test(p)
		|| /^(how have you been|how are you|what can you tell about me|who are you|what'?s up)[\s?.!]*$/i.test(raw)
	);
}

/** Short / simple Q&A that must never burn a medium/premium model (esp. Kimi). */
function isBasicQuestion(p: string, raw: string): boolean {
	if (raw.length > 160) {
		return false;
	}
	if (isCodebaseExplore(p, raw)) {
		return false;
	}
	if (/\b(refactor|architect|migrate|multi-?file|codebase|implement|scaffold|stack\s*trace|race\s*condition|write (a |an )?(full |complete )?(game|app|website))\b/.test(p)) {
		return false;
	}
	if (isBasicDevelopment(p, raw)) {
		return false;
	}
	if (isCasualChat(p, raw)) {
		return true;
	}
	if (raw.length <= 100) {
		return true;
	}
	return /^(what|why|how|who|when|where|can you|could you|please|tell me|is |are |do |does )\b/.test(p)
		&& !/\b(entire|whole\s+repo|all\s+files|production\s+outage)\b/.test(p);
}

/** Follow-ups, bugs, small UI/copy tweaks → Flash. */
function isKeywordFlashTask(p: string, raw: string): boolean {
	if (isArchitectureOrReasoning(p)) {
		return false;
	}
	if (/^(also|again|same|ok|okay|continue|next|now)\b/.test(p) && raw.length <= 80) {
		return true;
	}
	return (
		/\b(follow[- ]?up|tweak|tiny|small|quick|simple|nit|typo|rename|wording|copy)\b/.test(p)
		|| /\b(color|colour|padding|margin|font|spacing|opacity|hover|align|icon)\b/.test(p)
		|| (/\b(button|css)\b/.test(p) && /\b(change|update|make|set|tweak|adjust)\b/.test(p))
		|| /\b(bug|bugs|error|crash|stack\s*trace|traceback|lint|debug)\b/.test(p)
		|| /\bfind(ing)?\s+(the\s+)?bug/.test(p)
	);
}

/** Tough reasoning, first-lead context, major architecture → Pro. */
function isKeywordProTask(p: string, _raw: string): boolean {
	return isArchitectureOrReasoning(p)
		|| /\b(take the lead|first lead|first pass|make context|build context)\b/.test(p)
		|| /\b(from scratch|greenfield|bootstrap|overhaul|rewrite|major (change|refactor))\b/.test(p)
		|| /\b(understand|walk me through|explore|analyze)\b/.test(p)
			&& /\b(codebase|code base|repo|project|system|architecture)\b/.test(p);
}

function isArchitectureOrReasoning(p: string): boolean {
	return (
		/\b(architect|architecture|redesign|migrate|system design|adr|rfc)\b/.test(p)
		|| /\b(reason(ing)?|think (hard|deep|carefully|through)|multi-?file refactor)\b/.test(p)
	);
}

/** First user turn that is a real task — Pro takes the lead. */
function isFirstLeadTask(p: string, raw: string): boolean {
	if (raw.length > 280) {
		return true;
	}
	return (
		/\b(implement|build|create|scaffold|design|plan|generate)\b/.test(p)
		&& !isKeywordFlashTask(p, raw)
	);
}

/** Repo / project walkthroughs need agent coding capacity (Pro), not Flash Q&A. */
function isCodebaseExplore(p: string, raw: string): boolean {
	return /\b(code\s*base|codebase|entire\s+(repo|project|app)|this\s+(repo|project|codebase|code\s*base)|walk\s*me\s*through|explore\s+(the\s+)?(repo|project|code)|analyze\s+(the\s+)?(repo|project|code)|tell\s+me\s+(everything|all)\s+about|everything\s+about\s+(this|the)\s+(code|project|repo|app))\b/.test(p)
		|| /\bthink\s+and\s+tell\b/.test(p)
		|| (/\btell\s+me\s+about\b/.test(p) && /\b(code|project|repo|app|codebase)\b/.test(p));
}

/** Everyday coding / basic development → GPT 5.6 Luna. */
function isBasicDevelopment(p: string, raw: string): boolean {
	if (/\b(refactor|architect|migrate|redesign|production\s+outage|race\s*condition|distributed|million.?token)\b/.test(p)) {
		return false;
	}
	const codingVerb = /\b(implement|write|add|fix|edit|create|build|code|generate|scaffold|update|change)\b/.test(p);
	const codingNoun = /\b(function|method|class|component|hook|endpoint|api|file|module|feature|button|form|page|test|spec|bugfix|typo|snippet|util|helper)\b/.test(p);
	if (codingVerb && codingNoun) {
		return true;
	}
	// Agent / coding mode short asks like "add a logout button"
	if (codingVerb && raw.length <= 280) {
		return true;
	}
	return false;
}

/**
 * Frontend-dominant for Agent/Auto → pin DeepSeek V4 Pro via TokenRouter.
 * Allows light API/waitlist mentions; only strong backend/infra keeps it off.
 */
function isStrongBackendOrInfra(p: string): boolean {
	return /\b(postgres|postgresql|docker|kubernetes|k8s|microservice|prisma|drizzle|auth\s*server|terraform|helm|aws\s*cdk|ci\/cd)\b/.test(p);
}

function isFrontendDominant(p: string): boolean {
	const frontendPatterns = [
		/\bfrontend\b/,
		/\bui\b/,
		/\bux\b/,
		/\breact\b/,
		/\bnext\.?js\b/,
		/\bdashboard\b/,
		/\blanding\b/,
		/\btailwind\b/,
		/\bcomponent\b/,
		/\bcss\b/,
		/\bhtml\b/,
		/\bhero\b/,
		/\bnav(igation)?\b/,
		/\bshadcn\b/,
		/\bmarketing\b/,
		/\bpage\b/,
		/\bscreen\b/,
		/\blayout\b/,
		/\bwaitlist\b/,
		/\bwebsite\b/,
		/\bdesign\s*system\b/,
		/\blaunchpad\b/,
		/\bhello\s*world\b/,
	];
	const frontendHits = frontendPatterns.reduce((n, re) => n + (re.test(p) ? 1 : 0), 0);
	const frontendAction =
		/\b(make|build|create|write|implement|design|polish|style|redesign|scaffold|compose|continue|retry|try again)\b/.test(p);
	if (isStrongBackendOrInfra(p)) {
		return false;
	}
	if (frontendHits >= 2 && frontendAction) {
		return true;
	}
	// Short UI asks: "make a hello world page and design it…" (page + design/make)
	if (frontendHits >= 1 && frontendAction && /\b(page|screen|website|html|hello\s*world|landing|hero)\b/.test(p)) {
		return true;
	}
	if (frontendHits >= 1 && frontendAction && /\b(frontend|ui|ux|react|landing|dashboard|tailwind|css|launchpad)\b/.test(p)) {
		return true;
	}
	return false;
}

function parseContent(content: string, input: LlmDecisionInput): Omit<LlmDecisionResult, 'latencyMs' | 'source'> {
	const m = content.match(/\{[\s\S]*\}/);
	if (!m) {
		// Allow bare model id line
		const bare = content.trim().split(/\s+/)[0]?.replace(/['"`]/g, '');
		if (bare && VALID_IDS.has(bare)) {
			const sub = Object.entries(SUB_TIER_TO_MODEL).find(([, id]) => id === bare)?.[0] ?? 'T0.1';
			return {
				tier: sub.slice(0, 2),
				subTier: sub,
				modelId: bare,
				intent: 'UNKNOWN',
				confidence: 0.8,
				reason: 'bare-id',
				stay: input.previousModelId === bare,
			};
		}
		throw new Error('no-json');
	}
	const raw = JSON.parse(m[0]) as Record<string, unknown>;
	let modelId = String(raw.modelId ?? '');
	if (!VALID_IDS.has(modelId)) {
		const sub = String(raw.subTier ?? '');
		modelId = SUB_TIER_TO_MODEL[sub] ?? 'deepseek/deepseek-v4-flash-0731';
	}
	const stay = Boolean(input.previousModelId) && modelId === input.previousModelId;
	const specialty = normalizeSpecialty(raw.specialty);
	if (specialty === 'frontend') {
		modelId = PRO;
	}
	return {
		tier: specialty === 'frontend' ? 'T2' : String(raw.tier ?? 'T0'),
		subTier: specialty === 'frontend' ? 'T2.1' : String(raw.subTier ?? 'T0.1'),
		modelId,
		intent: String(raw.intent ?? 'UNKNOWN'),
		confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.8))),
		reason: String(raw.reason ?? 'llm'),
		stay: specialty === 'frontend' ? false : stay,
		specialty,
	};
}

function normalizeSpecialty(
	value: unknown,
): LlmDecisionResult['specialty'] {
	const v = String(value ?? 'general').toLowerCase().trim().replace(/_/g, '-');
	if (v === 'frontend') return 'frontend';
	if (v === 'backend') return 'backend';
	if (v === 'ai' || v === 'ai-pipeline') return 'ai-pipeline';
	if (v === 'infra' || v === 'infrastructure') return 'infrastructure';
	return 'general';
}

/** Prefer TokenRouter Flash for latency; OpenRouter Nemotron remains explicit fallback. */
async function resolveDecisionEndpoint(): Promise<{
	base: string;
	apiKey: string;
	model: string;
	timeoutMs: number;
	via: 'tokenrouter' | 'openrouter' | 'env' | 'deepseek';
}> {
	applySingularityBundledEnv();
	const timeoutMs = Number(
		process.env.SINGULARITY_DECISION_TIMEOUT_MS
		|| process.env.OPENROUTER_DECISION_TIMEOUT_MS,
	) || DECISION_HOT_PATH_TIMEOUT_MS;

	const forcedModel = (
		process.env.SINGULARITY_DECISION_MODEL
		|| process.env.OPENROUTER_DECISION_MODEL
		|| ''
	).trim();
	const forcedBase = (
		process.env.SINGULARITY_DECISION_BASE_URL
		|| ''
	).replace(/\/$/, '');
	const forcedKey = (
		process.env.SINGULARITY_DECISION_API_KEY
		|| process.env.OPENROUTER_API_KEY
		|| ''
	).trim();

	const preferTokenRouter = process.env.SINGULARITY_DECISION_VIA_TOKENROUTER !== '0'
		&& process.env.SINGULARITY_DECISION_FORCE_OPENROUTER !== '1';
	if (preferTokenRouter) {
		const deepseek = getDeepSeekDirectConfig();
		if (deepseek) {
			const model = isSlowOrFreeDecisionModel(forcedModel)
				? DECISION_GATEWAY_MODEL
				: (forcedModel || DECISION_GATEWAY_MODEL);
			return {
				base: deepseek.baseUrl,
				apiKey: deepseek.apiKey,
				model: mapDeepSeekOfficialModelId(model),
				timeoutMs: Math.min(timeoutMs, DECISION_HOT_PATH_TIMEOUT_MS),
				via: 'deepseek',
			};
		}
		const apiKey = (await ensureFreshTokenRouterApiKey()) || getTokenRouterApiKey();
		if (apiKey) {
			// Never send OpenRouter `:free` / Nemotron through the beta proxy — it stalls then aborts.
			const model = isSlowOrFreeDecisionModel(forcedModel)
				? DECISION_GATEWAY_MODEL
				: (forcedModel || DECISION_GATEWAY_MODEL);
			return {
				base: getTokenRouterBaseUrl(apiKey),
				apiKey,
				model,
				timeoutMs: Math.min(timeoutMs, DECISION_HOT_PATH_TIMEOUT_MS),
				via: 'tokenrouter',
			};
		}
	}

	const base = (forcedBase || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
	const apiKey = forcedKey;
	const model = forcedModel || DECISION_MODEL;
	return {
		base,
		apiKey,
		model,
		timeoutMs: Math.min(timeoutMs, DECISION_HOT_PATH_TIMEOUT_MS),
		via: forcedBase || forcedKey ? 'env' : 'openrouter',
	};
}

function isSlowOrFreeDecisionModel(model: string): boolean {
	if (!model) {
		return true;
	}
	const m = model.toLowerCase();
	return m.includes(':free') || m.includes('nemotron');
}

function normalizeDecisionPrompt(prompt: string): string {
	return prompt.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
}

/** Tiny follow-ups that should keep the previous specialty/model without a full decide call. */
export function isDecisionTweakPrompt(prompt: string): boolean {
	const raw = prompt.trim();
	const p = raw.toLowerCase();
	if (raw.length === 0 || raw.length > 180) {
		return false;
	}
	if (/\b(new (product|app|site|brand|landing)|from scratch|different (product|brand|metaphor)|rebuild|redesign (the )?(whole|entire)|start over)\b/.test(p)) {
		return false;
	}
	return (
		/\b(tweak|nudge|adjust|polish|tighten|loosen|denser|sparser|bolder|softer|darker|lighter|spacing|padding|margin|cta|font|color|contrast)\b/.test(p)
		|| /^(make (it|the)|change (the|it)|update (the|it)|also |and |fix (the|it)|try |please )\b/.test(p)
	);
}

function tryStayCacheHit(cacheKey: string, input: LlmDecisionInput): LlmDecisionResult | undefined {
	const entry = decisionStayCache.get(cacheKey);
	if (!entry) {
		return undefined;
	}
	if (Date.now() - entry.at > DECISION_STAY_CACHE_MS) {
		decisionStayCache.delete(cacheKey);
		return undefined;
	}
	const norm = normalizeDecisionPrompt(input.prompt);
	const identical = norm === entry.promptNorm;
	const tweak = isDecisionTweakPrompt(input.prompt)
		&& Boolean(entry.result.specialty || entry.result.modelId)
		&& (input.turnCount ?? 1) > 1;
	if (!identical && !tweak) {
		return undefined;
	}
	return {
		...entry.result,
		stay: true,
		latencyMs: 0,
		reason: identical ? `stay-cache-identical:${entry.result.reason}` : `stay-cache-tweak:${entry.result.reason}`,
		source: entry.result.source === 'llm' ? 'llm' : 'rules',
	};
}

function rememberStayCache(cacheKey: string, input: LlmDecisionInput, out: LlmDecisionResult): void {
	decisionStayCache.set(cacheKey, {
		result: out,
		promptNorm: normalizeDecisionPrompt(input.prompt),
		at: Date.now(),
		previousModelId: out.modelId,
	});
}

function rejectAfter(ms: number, message: string): Promise<never> {
	return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}
