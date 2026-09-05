import type { RouteContext, RouteFeatures } from './types.js';

const CODE_FENCE = /```[\s\S]*?```/;
const CODE_INLINE = /`[^`\n]+`/;

function hasKeyword(prompt: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(prompt));
}

/**
 * Estimate output tokens from mode and prompt size (heuristic for MVP).
 */
export function estimateOutputTokens(ctx: RouteContext, promptLength: number): number {
  switch (ctx.mode) {
    case 'autocomplete':
      return 64;
    case 'inline':
      return Math.min(2048, Math.max(256, Math.floor(promptLength * 0.5)));
    case 'agent':
      return 4096;
    case 'terminal':
      return 512;
    default:
      return Math.min(4096, Math.max(512, Math.floor(promptLength * 0.35)));
  }
}

export function extractFeatures(ctx: RouteContext): RouteFeatures {
  const prompt = ctx.prompt ?? '';
  const lower = prompt.toLowerCase();
  const promptLength = prompt.split(/\s+/).filter(Boolean).length;
  const promptCharCount = prompt.length;

  return {
    promptLength,
    promptCharCount,
    containsCode: CODE_FENCE.test(prompt) || CODE_INLINE.test(prompt) || /[{};]\s*$/m.test(prompt),
    estimatedOutputTokens: estimateOutputTokens(ctx, promptLength),
    contextTokens: ctx.contextTokens ?? Math.ceil(promptCharCount / 4) + (ctx.selectionLength ?? 0),
    mode: ctx.mode,
    hasImages: Boolean(ctx.hasImages),
    hasTerminalOutput: Boolean(ctx.hasTerminalOutput),
    requiresTools: Boolean(ctx.requiresTools),
    requiresJson: Boolean(ctx.requiresJson),
    requiresStreaming: ctx.requiresStreaming !== false,
    openFileCount: ctx.openFileCount ?? 0,
    repoFileCount: ctx.repoFileCount ?? 0,
    selectionLength: ctx.selectionLength ?? 0,
    language: ctx.language,
    keywords: {
      bug: hasKeyword(lower, [/\bbug\b/, /\bcrash\b/, /\berror\b/, /\bstack\s*trace\b/]),
      refactor: hasKeyword(lower, [/\brefactor\b/, /\bclean\s*up\b/, /\brestructure\b/]),
      explain: hasKeyword(lower, [/\bexplain\b/, /\bwhat\s+does\b/, /\bhow\s+does\b/]),
      test: hasKeyword(lower, [/\btests?\b/, /\bunit\s*tests?\b/, /\bjest\b/, /\bvitest\b/, /\bpytest\b/]),
      review: hasKeyword(lower, [/\breview\b/, /\bcode\s*review\b/, /\bpr\s*review\b/]),
      security: hasKeyword(lower, [/\bsecurity\b/, /\bvulnerabilit/, /\bcve\b/, /\bxss\b/, /\bsqli\b/]),
      docker: hasKeyword(lower, [/\bdocker\b/, /\bdockerfile\b/, /\bcompose\b/]),
      kubernetes: hasKeyword(lower, [/\bkubernetes\b/, /\bk8s\b/, /\bhelm\b/, /\bkubectl\b/]),
      git: hasKeyword(lower, [/\bgit\b/, /\bpull\s*request\b/, /\bmerge\b/]),
      commit: hasKeyword(lower, [/\bcommit\s*message\b/, /\bchangelog\b/, /\brelease\s*notes\b/]),
      search: hasKeyword(lower, [/\bfind\b/, /\bsearch\b/, /\bwhere\s+is\b/, /\blocate\b/, /\bsymbol\b/]),
      architecture: hasKeyword(lower, [/\barchitect/, /\bhigh[\s-]?level\b/, /\bsystem\s+design\b/]),
      document: hasKeyword(lower, [/\bdocument/, /\breadme\b/, /\bdocstring\b/, /\bjsdoc\b/]),
      performance: hasKeyword(lower, [/\bperformance\b/, /\boptimiz/, /\bslow\b/, /\blatency\b/]),
      fix: hasKeyword(lower, [/\bfix\b/, /\brepair\b/, /\bbroken\b/]),
      why: hasKeyword(lower, [/\bwhy\b/, /\broot\s*cause\b/, /\bcause\b/]),
      plan: hasKeyword(lower, [/\bplan\b/, /\bmilestone\b/, /\broadmap\b/, /\bdesign\s+doc\b/]),
      migrate: hasKeyword(lower, [/\bmigrat/, /\bupgrade\b/, /\bport\s+to\b/]),
      screenshot: hasKeyword(lower, [/\bscreenshot\b/, /\bimage\b/, /\bui\s*mock\b/, /\bfigma\b/]),
      frontend: hasKeyword(lower, [
        /\bfrontend\b/,
        /\breact\b/,
        /\bnext\.?js\b/,
        /\bcss\b/,
        /\btailwind\b/,
        /\bui\b/,
        /\bux\b/,
        /\btsx\b/,
        /\bjsx\b/,
        /\bdashboard\b/,
        /\blanding\s*page\b/,
        /\bshadcn\b/,
        /\bcomponent(s)?\b/,
        /\bdesign\s*system\b/,
      ]),
      backend: hasKeyword(lower, [
        /\bbackend\b/,
        /\bapi\b/,
        /\bgraphql\b/,
        /\bdatabase\b/,
        /\bprisma\b/,
        /\bdrizzle\b/,
        /\bpostgres\b/,
        /\bendpoint\b/,
      ]),
      regex: hasKeyword(lower, [/\bregex\b/, /\bregexp\b/, /\bregular\s+expression\b/]),
      bash: hasKeyword(lower, [/\bbash\b/, /\bshell\b/, /\bcli\b/, /\bterminal\b/, /\bzsh\b/]),
      brainstorm: hasKeyword(lower, [/\bbrainstorm\b/, /\bideas?\b/, /\boptions?\b/, /\btrade[\s-]?offs?\b/]),
      critical: hasKeyword(lower, [/\bcritical\b/, /\bproduction\b/, /\bp0\b/, /\bsev[e]?r?e?\b/, /\burgent\b/]),
    },
  };
}
