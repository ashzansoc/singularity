import type { Intent, ModelSpec, RouteFeatures, SubTier } from './types.js';
import { subTierIndex } from './types.js';

/**
 * Maps callWhen / doNotCall tags → whether the current request matches.
 */
export function tagMatches(tag: string, features: RouteFeatures, intent: Intent): boolean {
  const k = features.keywords;
  switch (tag) {
    case 'current-line-completion':
    case 'variable-names':
    case 'simple-loops':
    case 'imports':
    case 'syntax-completion':
    case 'sql-completion':
    case 'boilerplate':
    case 'autocomplete':
    case 'ultra-fast-autocomplete':
    case 'autocomplete-only':
      return features.mode === 'autocomplete' || (features.mode === 'inline' && features.promptCharCount < 200);
    case 'small-json-yaml':
      return /\b(json|yaml|yml)\b/i.test(features.language ?? '') || features.promptCharCount < 400;
    case 'small-function':
      return intent === 'INLINE_EDIT' || (features.containsCode && features.promptLength < 120);
    case 'regex':
      return k.regex;
    case 'bash':
    case 'git':
      return k.bash || k.git || features.mode === 'terminal';
    case 'one-file-bugfix':
      return (k.bug || k.fix) && features.openFileCount <= 1;
    case 'small-refactor':
      return k.refactor && features.openFileCount <= 1 && features.promptLength < 300;
    case 'explain-selection':
    case 'summarize-file':
    case 'read-readme':
    case 'explain-error':
    case 'convert-docs':
    case 'explain-concepts':
    case 'learning-mode':
      return intent === 'EXPLAIN' || intent === 'DOCUMENTATION' || k.explain || k.document;
    case 'ui-screenshot':
    case 'docs-with-images':
      return features.hasImages || k.screenshot;
    case 'html-css':
    case 'small-frontend-fix':
    case 'svg-edit':
    case 'frontend-specialty':
    case 'dashboard-ui':
    case 'design-system':
    case 'saas-ui':
      return k.frontend;
    case 'backend-only':
      return k.backend && !k.frontend;
    case 'infra-only':
      return k.docker || k.kubernetes;
    case 'api-examples':
    case 'small-docs':
    case 'config-files':
    case 'package-updates':
    case 'dependency-explain':
      return intent === 'DOCUMENTATION' || k.document || k.commit;
    case 'multiple-functions':
    case 'medium-context':
      return features.contextTokens >= 500 && features.contextTokens <= 1500;
    case 'refactor':
      return k.refactor || intent === 'REFACTOR';
    case 'tests':
    case 'unit-tests':
      return k.test || intent === 'TEST';
    case 'api-integration':
    case 'component-gen':
    case 'new-modules':
    case 'sdk-gen':
      return intent === 'INLINE_EDIT' || intent === 'UNKNOWN' || intent === 'TEST';
    case 'multi-file-edits':
    case 'cross-file':
    case 'multi-file':
    case 'multi-file-refactors':
      return features.openFileCount >= 2 || k.refactor;
    case 'repo-search':
    case 'project-structure':
    case 'find-dependencies':
    case 'code-navigation':
    case 'find-implementation':
      return intent === 'SEARCH' || k.search;
    case 'bug-fix':
    case 'difficult-bugs':
    case 'stack-traces':
    case 'memory-leaks':
    case 'concurrency':
    case 'compiler-issues':
    case 'cot-debugging':
    case 'long-debugging':
      return intent === 'DEBUG' || k.bug || k.fix || features.hasTerminalOutput;
    case 'performance-opt':
      return k.performance;
    case 'algorithm':
    case 'competitive-programming':
      return k.performance || /\balgorithm\b/i.test(String(features.promptLength));
    case 'autonomous-edits':
    case 'tool-use':
    case 'multi-step-impl':
    case 'multi-step-plans':
      return features.mode === 'agent' || features.requiresTools || intent === 'AGENT';
    case 'repo-wide-refactor':
    case 'code-migration':
    case 'large-migrations':
    case 'large-impl':
      return k.migrate || k.refactor || features.openFileCount >= 3;
    case 'language-conversion':
      return k.migrate;
    case 'explain-repo':
    case 'long-docs':
    case 'api-docs':
    case 'architecture-summaries':
    case 'architecture-reasoning':
      return intent === 'ARCHITECTURE' || intent === 'DOCUMENTATION' || k.architecture || k.document;
    case 'markdown-gen':
    case 'readme':
    case 'tutorials':
    case 'doc-updates':
    case 'professional-docs':
    case 'specifications':
    case 'rfc':
    case 'design-docs':
    case 'long-form-writing':
      return intent === 'DOCUMENTATION' || k.document;
    case 'compare-tech':
    case 'generate-examples':
    case 'technical-discussion':
    case 'brainstorm':
    case 'tradeoffs':
    case 'tech-comparison':
    case 'alternative-perspective':
    case 'large-brainstorm':
    case 'novel-solutions':
    case 'product-ideation':
      return k.brainstorm || k.architecture || intent === 'EXPLAIN';
    case 'production-analysis':
    case 'production-fixes':
    case 'pr-review':
      return intent === 'REVIEW' || k.review || k.critical;
    case 'huge-repos':
    case 'long-context-debug':
    case 'large-code-understanding':
    case 'enterprise-repos':
    case 'entire-repositories':
      return features.contextTokens > 64_000 || (features.repoFileCount ?? 0) > 500;
    case 'difficult-coding':
    case 'difficult-architecture':
    case 'mission-critical':
    case 'highest-quality':
    case 'critical-production':
      return k.critical || intent === 'ARCHITECTURE' || intent === 'REFACTOR';
    case 'complex-planning':
    case 'large-design-docs':
    case 'planning':
    case 'research':
    case 'multi-agent':
    case 'research-synthesis':
    case 'cross-model-verification':
      return k.plan || intent === 'AGENT' || intent === 'ARCHITECTURE';
    case 'creative-design':
    case 'novel-architecture':
      return intent === 'ARCHITECTURE' || k.brainstorm;
    case 'cross-language':
      return k.migrate;
    case 'why-question':
      return k.why;
    case 'architecture':
    case 'design-decisions':
    case 'needs-reasoning':
    case 'long-reasoning':
    case 'deep-reasoning':
    case 'medium-reasoning':
      return intent === 'ARCHITECTURE' || intent === 'DEBUG' || k.why || k.architecture;
    case 'heavy-coding':
    case 'heavy-generation':
    case 'large-refactors':
      return intent === 'REFACTOR' || features.openFileCount >= 3;
    case 'vision-only':
      return features.hasImages && !features.containsCode;
    case 'million-token':
    case 'frontier-only':
      return features.contextTokens > 500_000;
    case 'local-dev':
      return false;
    default:
      return false;
  }
}

/**
 * Score how well a model's callWhen / doNotCall rules fit this request.
 * Returns roughly [-1, 1].
 */
export function callWhenScore(
  model: ModelSpec,
  features: RouteFeatures,
  intent: Intent,
): number {
  let hits = 0;
  let misses = 0;
  for (const tag of model.callWhen) {
    if (tagMatches(tag, features, intent)) {
      hits += 1;
    }
  }
  for (const tag of model.doNotCall) {
    if (tagMatches(tag, features, intent)) {
      misses += 1;
    }
  }
  const callDenom = Math.max(model.callWhen.length, 1);
  const callRatio = hits / callDenom;
  const penalty = misses > 0 ? Math.min(1, misses * 0.45) : 0;
  return callRatio - penalty;
}

/**
 * Capability fit: prefer models whose coding/reasoning/longContext/toolUse
 * match what the intent needs.
 */
export function capabilityFitScore(
  model: ModelSpec,
  features: RouteFeatures,
  intent: Intent,
): number {
  const c = model.capabilities;
  const needCoding =
    intent === 'INLINE_EDIT' || intent === 'TEST' || intent === 'REFACTOR' || intent === 'AUTOCOMPLETE'
      ? 0.35
      : 0.15;
  const needReasoning =
    intent === 'DEBUG' || intent === 'ARCHITECTURE' || intent === 'AGENT' || intent === 'REVIEW'
      ? 0.35
      : 0.1;
  const needLong =
    features.contextTokens > 64_000 || intent === 'ARCHITECTURE' ? 0.25 : 0.05;
  const needTools = features.requiresTools || features.mode === 'agent' ? 0.25 : 0.05;
  const weightSum = needCoding + needReasoning + needLong + needTools;

  const score =
    (needCoding * (c.coding / 10) +
      needReasoning * (c.reasoning / 10) +
      needLong * (c.longContext / 10) +
      needTools * (c.toolUse / 10)) /
    weightSum;

  // Speed preference for autocomplete / tiny edits
  if (features.mode === 'autocomplete' && c.speed !== 'ultra_fast' && c.speed !== 'fast') {
    return score * 0.7;
  }
  if (features.hasImages && !c.vision) {
    return score * 0.4;
  }
  return score;
}

export function pickBestSubTier(
  scored: Array<{ model: ModelSpec; score: number }>,
): SubTier | undefined {
  if (!scored.length) {
    return undefined;
  }
  return [...scored].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return subTierIndex(a.model.subTier) - subTierIndex(b.model.subTier);
  })[0]?.model.subTier;
}
