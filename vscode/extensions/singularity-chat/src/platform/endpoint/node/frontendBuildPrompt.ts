/**
 * Shared detection for greenfield UI / game / app build prompts.
 * Used by Design Intelligence, tool gating, and Automode frontend pinning.
 */

const FRONTEND_BUILD =
	/\b(frontend|ui|ux|react|next\.?js|vue|svelte|tailwind|css|html|tsx|jsx|component|dashboard|landing|hero|shadcn|page|screen|website|layout|canvas|svg|game|animation|stylesheet|design|interface|widget|view)\b/i;
const BUILD_ACTION =
	/\b(build|create|implement|redesign|polish|make|scaffold|write|generate|code|style|compose|prototype|design)\b/i;
const BUILD_SURFACE =
	/\b(page|site|screen|app|website|landing|dashboard|portal|inventory|system|saas|product|game|html|canvas|ui|interface|widget|view|component|script)\b/i;

/** Prompt asks for a frontend/UI artifact (Design Director + file tools). */
export function promptLooksLikeFrontendBuild(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) {
		return false;
	}
	return FRONTEND_BUILD.test(p) || (BUILD_ACTION.test(p) && BUILD_SURFACE.test(p));
}

/** Cross-cutting engineering that still warrants multi-agent Runtime. */
const COMPLEX_ENGINEERING_GOAL =
	/\b(auth(?:entication)?|oauth|backend|api|database|postgres|redis|migrate|refactor|full[- ]?stack|multi[- ]?file|across (the )?(repo|codebase|app|modules?)|end[- ]to[- ]end|integrate|wire(?:\s+up)?|billing|payment|stripe|subscription|microservice|service layer|new (feature|service|module))\b/i;

/**
 * Frontend/UI goals that should use Design Spec + agency skill + one implementer —
 * not DAG Runtime with a dozen specialist agents.
 */
export function isDesignIntelligenceFrontendGoal(prompt: string): boolean {
	const p = prompt.trim();
	if (!p || !promptLooksLikeFrontendBuild(p)) {
		return false;
	}
	return !COMPLEX_ENGINEERING_GOAL.test(p);
}
