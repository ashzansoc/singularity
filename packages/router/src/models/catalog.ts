/**
 * Singularity default model catalog.
 *
 * Policy: DeepSeek V4 Flash owns T0 (fast lane), DeepSeek V4 Pro-0813 owns
 * T1–T6 primary slots; Gemini 2.5 Flash is the vision slot (DeepSeek has no
 * image modality). Frontier models (Claude/GPT/Gemini Pro) occupy premium
 * tiers as fallbacks. Live Flash/Pro lane decisions remain in
 * ../nemotronFlashPro and packages/runtime/src/llm.ts.
 */
import type { ModelSpec, Tier } from '../types.js';
import { tierIndex } from '../types.js';

export const NEMOTRON_MODEL_ID = 'nvidia/nemotron-3-ultra-550b-a55b:free' as const;

/** USD per 1M tokens by cost class. */
const PRICE = {
  very_low: { in: 0.05, out: 0.2 },
  low: { in: 0.25, out: 1 },
  medium: { in: 1.25, out: 5 },
  high: { in: 8, out: 32 },
} as const;

function capabilities(
  speed: import('../types.js').SpeedClass,
  coding: number,
  reasoning: number,
  longContext: number,
  toolUse: number,
  cost: import('../types.js').CostClass,
  context: import('../types.js').ContextWindowClass,
  vision: boolean,
  vendor: import('../types.js').ModelVendor,
): import('../types.js').ModelCapabilities {
  return { speed, coding, reasoning, longContext, toolUse, cost, context, vision, vendor };
}

interface RawModel {
  id: string;
  displayName: string;
  tier: Tier;
  subTier: string;
  primaryPurpose: string;
  callWhen: string[];
  doNotCall: string[];
  capabilities: ReturnType<typeof capabilities>;
  costPer1MInput?: number;
  costPer1MOutput?: number;
  latencyMsP50: number;
  reliability: number;
  qualityByIntent?: Record<string, number>;
  alsoInTiers?: Tier[];
}

function withDefaults(r: RawModel): ModelSpec {
  return {
    id: r.id,
    displayName: r.displayName,
    provider: r.id.startsWith('local/') ? 'local' : 'openrouter',
    tier: r.tier,
    subTier: r.subTier as ModelSpec['subTier'],
    primaryPurpose: r.primaryPurpose,
    callWhen: r.callWhen,
    doNotCall: r.doNotCall,
    capabilities: r.capabilities,
    maxContext:
      r.capabilities.context === '1m' ? 1_000_000 : r.capabilities.context === '256k' ? 256_000 : 128_000,
    supportsTools: r.capabilities.toolUse >= 5,
    supportsVision: r.capabilities.vision,
    supportsJson: true,
    supportsStreaming: true,
    costPer1MInput: r.costPer1MInput ?? PRICE[r.capabilities.cost].in,
    costPer1MOutput: r.costPer1MOutput ?? PRICE[r.capabilities.cost].out,
    latencyMsP50: r.latencyMsP50,
    reliability: r.reliability,
    qualityByIntent: r.qualityByIntent ?? { UNKNOWN: 0.7 },
  };
}

export const TIER_RECOMMENDED_MODELS: Record<Tier, readonly string[]> = {
  T0: ['deepseek/deepseek-v4-flash-0731','deepseek/deepseek-v4-flash-0731','deepseek/deepseek-v4-flash-0731','google/gemini-2.5-flash','deepseek/deepseek-v4-flash-0731'],
  T1: ['deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813'],
  T2: ['deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-flash-0731','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813'],
  T3: ['deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813'],
  T4: ['deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813'],
  T5: ['deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813'],
  T6: ['deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813','deepseek/deepseek-v4-pro-0813'],
};

const RAW_CATALOG: RawModel[] = [
  {
    id: "alibaba/qwen3.7-flash",
    displayName: "Qwen 3.7 Flash",
    tier: "T0",
    subTier: "T0.1",
    primaryPurpose: "Local edits & autocomplete",
    callWhen: ["current-line-completion", "variable-names", "simple-loops", "imports", "syntax-completion", "small-json-yaml", "sql-completion", "boilerplate"],
    doNotCall: ["multi-file", "why-question", "architecture", "needs-reasoning"],
    capabilities: capabilities("ultra_fast", 6, 3, 3, 2, "very_low", "128k", false, "alibaba"),
    costPer1MInput: 0.05,
    costPer1MOutput: 0.2,
    latencyMsP50: 120,
    reliability: 0.9,
    qualityByIntent: { AUTOCOMPLETE: 0.92, SEARCH: 0.7, INLINE_EDIT: 0.55, UNKNOWN: 0.7 },
  },
  {
    id: "deepseek/deepseek-v4-flash-0731",
    displayName: "DeepSeek V4 Flash-0731",
    tier: "T0",
    subTier: "T0.2",
    primaryPurpose: "Fast coding intelligence",
    callWhen: ["small-function", "regex", "bash", "git", "one-file-bugfix", "small-refactor", "greetings", "qa", "autocomplete", "cheap-explain"],
    doNotCall: ["cross-file-architecture", "long-reasoning", "hard-agent", "frontend-specialty"],
    capabilities: capabilities("ultra_fast", 7, 4, 3, 3, "very_low", "128k", false, "deepseek"),
    costPer1MInput: 0.05,
    costPer1MOutput: 0.2,
    latencyMsP50: 150,
    reliability: 0.9,
    qualityByIntent: { AUTOCOMPLETE: 0.85, INLINE_EDIT: 0.75, TERMINAL: 0.8, UNKNOWN: 0.7, AGENT: 0.78 },
  },
  {
    id: "google/gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash Lite",
    tier: "T0",
    subTier: "T0.3",
    primaryPurpose: "Reading & understanding",
    callWhen: ["explain-selection", "summarize-file", "read-readme", "explain-error", "convert-docs"],
    doNotCall: ["multi-file-edits", "heavy-coding"],
    capabilities: capabilities("ultra_fast", 5, 5, 4, 2, "very_low", "128k", true, "google"),
    costPer1MInput: 0.04,
    costPer1MOutput: 0.15,
    latencyMsP50: 140,
    reliability: 0.88,
    qualityByIntent: { EXPLAIN: 0.82, DOCUMENTATION: 0.75, SEARCH: 0.7, UNKNOWN: 0.7 },
  },
  {
    id: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    tier: "T0",
    subTier: "T0.4",
    primaryPurpose: "Fast mixed-modal understanding",
    callWhen: ["ui-screenshot", "docs-with-images"],
    doNotCall: ["deep-reasoning", "large-refactors"],
    capabilities: capabilities("ultra_fast", 6, 4, 6, 4, "very_low", "1m", true, "google"),
    costPer1MInput: 0.08,
    costPer1MOutput: 0.3,
    latencyMsP50: 180,
    reliability: 0.9,
    qualityByIntent: { EXPLAIN: 0.8, INLINE_EDIT: 0.7, UNKNOWN: 0.72 },
  },
  {
    id: "zai/glm-5.2-fast",
    displayName: "GLM 5.2 Fast",
    tier: "T0",
    subTier: "T0.5",
    primaryPurpose: "Lightweight reasoning",
    callWhen: ["api-examples", "small-docs", "config-files", "package-updates", "dependency-explain"],
    doNotCall: ["architecture", "multi-file-refactors"],
    capabilities: capabilities("ultra_fast", 5, 5, 3, 3, "very_low", "128k", false, "zai"),
    costPer1MInput: 0.06,
    costPer1MOutput: 0.22,
    latencyMsP50: 160,
    reliability: 0.87,
    qualityByIntent: { DOCUMENTATION: 0.78, EXPLAIN: 0.76, UNKNOWN: 0.7 },
  },
  {
    id: "alibaba/qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    tier: "T1",
    subTier: "T1.1",
    primaryPurpose: "Medium-sized code edits",
    callWhen: ["multiple-functions", "medium-context", "refactor", "tests", "api-integration", "component-gen"],
    doNotCall: ["million-token", "frontier-only"],
    capabilities: capabilities("fast", 8, 6, 5, 7, "low", "256k", false, "alibaba"),
    costPer1MInput: 0.2,
    costPer1MOutput: 0.8,
    latencyMsP50: 400,
    reliability: 0.91,
    qualityByIntent: { INLINE_EDIT: 0.88, TEST: 0.85, REFACTOR: 0.8, UNKNOWN: 0.82 },
  },
  {
    id: "deepseek/deepseek-v4",
    displayName: "DeepSeek V4",
    tier: "T1",
    subTier: "T1.2",
    primaryPurpose: "Strong coding model",
    callWhen: ["multi-file-edits", "repo-search", "bug-fix", "performance-opt", "algorithm"],
    doNotCall: ["vision-only"],
    capabilities: capabilities("fast", 9, 7, 5, 7, "low", "256k", false, "deepseek"),
    costPer1MInput: 0.18,
    costPer1MOutput: 0.72,
    latencyMsP50: 420,
    reliability: 0.92,
    qualityByIntent: { INLINE_EDIT: 0.9, DEBUG: 0.82, TEST: 0.86, SEARCH: 0.8, UNKNOWN: 0.84 },
  },
  {
    id: "moonshotai/kimi-k3-fast",
    displayName: "Kimi K3 Fast",
    tier: "T1",
    subTier: "T1.3",
    primaryPurpose: "Fast repository understanding",
    callWhen: ["project-structure", "find-dependencies", "code-navigation", "find-implementation"],
    doNotCall: ["heavy-generation"],
    capabilities: capabilities("fast", 7, 6, 8, 6, "low", "1m", false, "moonshotai"),
    costPer1MInput: 0.22,
    costPer1MOutput: 0.9,
    latencyMsP50: 380,
    reliability: 0.9,
    qualityByIntent: { SEARCH: 0.9, EXPLAIN: 0.8, UNKNOWN: 0.78 },
  },
  {
    id: "poolside/laguna",
    displayName: "Poolside Laguna",
    tier: "T1",
    subTier: "T1.4",
    primaryPurpose: "Agentic software engineering",
    callWhen: ["autonomous-edits", "repo-wide-refactor", "tool-use", "code-migration", "multi-step-impl"],
    doNotCall: ["autocomplete-only"],
    capabilities: capabilities("balanced", 8, 7, 6, 9, "low", "256k", false, "poolside"),
    costPer1MInput: 0.25,
    costPer1MOutput: 1,
    latencyMsP50: 500,
    reliability: 0.88,
    qualityByIntent: { AGENT: 0.9, REFACTOR: 0.88, UNKNOWN: 0.82 },
  },
  {
    id: "mistral/codestral",
    displayName: "Codestral",
    tier: "T1",
    subTier: "T1.5",
    primaryPurpose: "Code generation",
    callWhen: ["new-modules", "competitive-programming", "language-conversion", "sdk-gen", "unit-tests"],
    doNotCall: ["long-docs-only"],
    capabilities: capabilities("fast", 9, 6, 4, 6, "low", "128k", false, "mistral"),
    costPer1MInput: 0.2,
    costPer1MOutput: 0.6,
    latencyMsP50: 400,
    reliability: 0.9,
    qualityByIntent: { INLINE_EDIT: 0.88, TEST: 0.9, UNKNOWN: 0.84 },
  },
  {
    id: "deepseek/deepseek-v4-pro-0813",
    displayName: "DeepSeek V4 Pro 0813 (TokenRouter)",
    tier: "T2",
    subTier: "T2.1",
    primaryPurpose: "Coding, agent, frontend implementer, visual critic",
    callWhen: ["frontend-specialty", "basic-development", "agent-tools", "visual-critic", "multi-file", "html-css", "saas-ui", "debug", "refactor"],
    doNotCall: ["ultra-fast-autocomplete", "casual-chat"],
    capabilities: capabilities("balanced", 9, 8, 8, 8, "medium", "256k", false, "deepseek"),
    costPer1MInput: 0.55,
    costPer1MOutput: 2.19,
    latencyMsP50: 700,
    reliability: 0.94,
    qualityByIntent: { INLINE_EDIT: 0.92, AGENT: 0.91, UNKNOWN: 0.88, REFACTOR: 0.9, DOCUMENTATION: 0.82, DEBUG: 0.92 },
    alsoInTiers: ["T1", "T3", "T4", "T5", "T6"],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro (alias)",
    tier: "T2",
    subTier: "T2.1",
    primaryPurpose: "Alias for deepseek-v4-pro-0813",
    callWhen: ["fallback-alias"],
    doNotCall: ["prefer-0813"],
    capabilities: capabilities("balanced", 9, 8, 8, 8, "medium", "256k", false, "deepseek"),
    costPer1MInput: 0.55,
    costPer1MOutput: 2.19,
    latencyMsP50: 700,
    reliability: 0.93,
    qualityByIntent: { INLINE_EDIT: 0.9, AGENT: 0.9, UNKNOWN: 0.86, REFACTOR: 0.88 },
    alsoInTiers: ["T1", "T3", "T4", "T5", "T6"],
  },
  {
    id: "moonshotai/kimi-k3",
    displayName: "Kimi K3",
    tier: "T2",
    subTier: "T2.2",
    primaryPurpose: "Long documentation & repo explanation",
    callWhen: ["explain-repo", "long-docs", "api-docs", "architecture-summaries"],
    doNotCall: ["ultra-fast-autocomplete", "frontend-specialty"],
    capabilities: capabilities("balanced", 7, 7, 10, 7, "medium", "1m", true, "moonshotai"),
    costPer1MInput: 0.5,
    costPer1MOutput: 1.8,
    latencyMsP50: 700,
    reliability: 0.9,
    qualityByIntent: { EXPLAIN: 0.9, DOCUMENTATION: 0.92, ARCHITECTURE: 0.85, UNKNOWN: 0.7 },
    alsoInTiers: ["T4"],
  },
  {
    id: "google/gemini-3.1-flash",
    displayName: "Gemini 3.1 Flash",
    tier: "T2",
    subTier: "T2.3",
    primaryPurpose: "Markdown & README generation",
    callWhen: ["markdown-gen", "readme", "tutorials", "doc-updates"],
    doNotCall: ["frontend-specialty"],
    capabilities: capabilities("fast", 6, 6, 8, 6, "low", "1m", true, "google"),
    costPer1MInput: 0.3,
    costPer1MOutput: 1.2,
    latencyMsP50: 550,
    reliability: 0.9,
    qualityByIntent: { DOCUMENTATION: 0.9, EXPLAIN: 0.85, UNKNOWN: 0.7 },
  },
  {
    id: "zai/glm-5.2",
    displayName: "GLM 5.2",
    tier: "T2",
    subTier: "T2.4",
    primaryPurpose: "Concept explanation & learning",
    callWhen: ["explain-concepts", "learning-mode", "compare-tech", "generate-examples"],
    doNotCall: ["frontend-specialty"],
    capabilities: capabilities("balanced", 6, 7, 5, 5, "low", "256k", false, "zai"),
    costPer1MInput: 0.35,
    costPer1MOutput: 1.3,
    latencyMsP50: 650,
    reliability: 0.88,
    qualityByIntent: { EXPLAIN: 0.9, DOCUMENTATION: 0.86, UNKNOWN: 0.7 },
  },
  {
    id: "mistral/mistral-medium-3.2",
    displayName: "Mistral Medium 3.2",
    tier: "T2",
    subTier: "T2.5",
    primaryPurpose: "Professional documentation",
    callWhen: ["professional-docs", "specifications", "rfc", "design-docs"],
    doNotCall: ["frontend-specialty"],
    capabilities: capabilities("balanced", 6, 7, 5, 5, "medium", "128k", false, "mistral"),
    costPer1MInput: 0.4,
    costPer1MOutput: 1.5,
    latencyMsP50: 680,
    reliability: 0.89,
    qualityByIntent: { DOCUMENTATION: 0.92, ARCHITECTURE: 0.8, UNKNOWN: 0.7 },
  },
  {
    id: "deepseek/deepseek-r1",
    displayName: "DeepSeek R1",
    tier: "T3",
    subTier: "T3.1",
    primaryPurpose: "Difficult bugs & algorithms",
    callWhen: ["difficult-bugs", "stack-traces", "memory-leaks", "concurrency", "algorithms", "compiler-issues"],
    doNotCall: ["autocomplete"],
    capabilities: capabilities("premium", 8, 10, 5, 7, "medium", "256k", false, "deepseek"),
    costPer1MInput: 0.55,
    costPer1MOutput: 2.19,
    latencyMsP50: 1200,
    reliability: 0.92,
    qualityByIntent: { DEBUG: 0.95, AGENT: 0.86, UNKNOWN: 0.7 },
  },
  {
    id: "sakana/fugu-ultra",
    displayName: "Sakana Fugu Ultra",
    tier: "T3",
    subTier: "T3.2",
    primaryPurpose: "Multi-agent reasoning & planning",
    callWhen: ["multi-agent", "planning", "research", "long-debugging"],
    doNotCall: [],
    capabilities: capabilities("premium", 7, 9, 7, 8, "medium", "256k", false, "sakana"),
    costPer1MInput: 0.7,
    costPer1MOutput: 2.5,
    latencyMsP50: 1100,
    reliability: 0.9,
    qualityByIntent: { DEBUG: 0.9, AGENT: 0.92, ARCHITECTURE: 0.85, UNKNOWN: 0.7 },
    alsoInTiers: ["T6"],
  },
  {
    id: "openai/gpt-5.5-mini",
    displayName: "GPT-5.5 Mini",
    tier: "T3",
    subTier: "T3.3",
    primaryPurpose: "Medium-complex reasoning & PR review",
    callWhen: ["medium-reasoning", "cot-debugging", "production-analysis", "pr-review"],
    doNotCall: [],
    capabilities: capabilities("balanced", 8, 8, 6, 7, "medium", "256k", true, "openai"),
    costPer1MInput: 0.8,
    costPer1MOutput: 3.2,
    latencyMsP50: 900,
    reliability: 0.93,
    qualityByIntent: { DEBUG: 0.9, REVIEW: 0.9, AGENT: 0.88, UNKNOWN: 0.7 },
  },
  {
    id: "google/gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    tier: "T3",
    subTier: "T3.4",
    primaryPurpose: "Huge-repo / long-context debugging",
    callWhen: ["huge-repos", "long-context-debug", "large-code-understanding"],
    doNotCall: [],
    capabilities: capabilities("balanced", 8, 8, 10, 8, "medium", "1m", true, "google"),
    costPer1MInput: 1.25,
    costPer1MOutput: 10,
    latencyMsP50: 1000,
    reliability: 0.94,
    qualityByIntent: { DEBUG: 0.9, AGENT: 0.9, ARCHITECTURE: 0.92, REFACTOR: 0.9, REVIEW: 0.88, UNKNOWN: 0.7 },
    alsoInTiers: ["T4", "T5", "T6"],
  },
  {
    id: "anthropic/claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    tier: "T3",
    subTier: "T3.5",
    primaryPurpose: "Difficult coding & multi-file refactors",
    callWhen: ["difficult-coding", "multi-file-refactors", "production-fixes", "architecture-reasoning", "large-impl"],
    doNotCall: [],
    capabilities: capabilities("balanced", 9, 9, 7, 9, "high", "256k", true, "anthropic"),
    costPer1MInput: 3,
    costPer1MOutput: 15,
    latencyMsP50: 900,
    reliability: 0.96,
    qualityByIntent: { DEBUG: 0.92, AGENT: 0.94, REFACTOR: 0.95, REVIEW: 0.94, ARCHITECTURE: 0.93, INLINE_EDIT: 0.9, UNKNOWN: 0.7 },
    alsoInTiers: ["T4", "T5"],
  },
  {
    id: "alibaba/qwen3.7-max",
    displayName: "Qwen 3.7 Max",
    tier: "T4",
    subTier: "T4.4",
    primaryPurpose: "Large enterprise repos & migrations",
    callWhen: ["enterprise-repos", "cross-language", "large-migrations"],
    doNotCall: [],
    capabilities: capabilities("balanced", 8, 8, 10, 7, "medium", "1m", true, "alibaba"),
    costPer1MInput: 1,
    costPer1MOutput: 4,
    latencyMsP50: 1100,
    reliability: 0.92,
    qualityByIntent: { ARCHITECTURE: 0.9, REFACTOR: 0.88, AGENT: 0.86, UNKNOWN: 0.7 },
  },
  {
    id: "openai/gpt-5.5",
    displayName: "GPT-5.5",
    tier: "T4",
    subTier: "T4.5",
    primaryPurpose: "Complex planning & large design docs",
    callWhen: ["complex-planning", "large-design-docs", "multi-step-plans"],
    doNotCall: [],
    capabilities: capabilities("premium", 9, 10, 9, 9, "high", "1m", true, "openai"),
    costPer1MInput: 5,
    costPer1MOutput: 20,
    latencyMsP50: 1300,
    reliability: 0.96,
    qualityByIntent: { DEBUG: 0.96, AGENT: 0.95, ARCHITECTURE: 0.95, REVIEW: 0.94, REFACTOR: 0.94, UNKNOWN: 0.7 },
    alsoInTiers: ["T5", "T6"],
  },
  {
    id: "anthropic/claude-opus-5",
    displayName: "Claude Opus 5",
    tier: "T5",
    subTier: "T5.2",
    primaryPurpose: "Mission-critical / highest-quality coding",
    callWhen: ["mission-critical", "difficult-architecture", "large-migrations", "highest-quality"],
    doNotCall: [],
    capabilities: capabilities("premium", 10, 10, 8, 9, "high", "256k", true, "anthropic"),
    costPer1MInput: 15,
    costPer1MOutput: 75,
    latencyMsP50: 1400,
    reliability: 0.97,
    qualityByIntent: { REFACTOR: 0.97, REVIEW: 0.96, AGENT: 0.96, ARCHITECTURE: 0.96, DEBUG: 0.95, UNKNOWN: 0.7 },
    alsoInTiers: ["T6"],
  },
  {
    id: "xai/grok-4.5",
    displayName: "Grok 4.5",
    tier: "T5",
    subTier: "T5.5",
    primaryPurpose: "Alternative perspective & novel solutions",
    callWhen: ["alternative-perspective", "large-brainstorm", "novel-solutions"],
    doNotCall: [],
    capabilities: capabilities("premium", 8, 9, 7, 7, "high", "256k", true, "xai"),
    costPer1MInput: 3.5,
    costPer1MOutput: 14,
    latencyMsP50: 1100,
    reliability: 0.93,
    qualityByIntent: { REFACTOR: 0.9, REVIEW: 0.9, AGENT: 0.9, ARCHITECTURE: 0.88, UNKNOWN: 0.7 },
  },
  {
    id: "anthropic/claude-fable-5",
    displayName: "Claude Fable 5",
    tier: "T6",
    subTier: "T6.3",
    primaryPurpose: "Creative system design & ideation",
    callWhen: ["creative-design", "novel-architecture", "product-ideation", "long-form-writing"],
    doNotCall: [],
    capabilities: capabilities("premium", 8, 10, 8, 8, "high", "256k", true, "anthropic"),
    costPer1MInput: 18,
    costPer1MOutput: 80,
    latencyMsP50: 1600,
    reliability: 0.97,
    qualityByIntent: { ARCHITECTURE: 0.96, DOCUMENTATION: 0.94, AGENT: 0.93, REVIEW: 0.92, UNKNOWN: 0.7 },
  },
  {
    id: "local/qwen-coder-7b",
    displayName: "Local Qwen Coder 7B",
    tier: "T0",
    subTier: "T0.1",
    primaryPurpose: "Offline echo / local stub",
    callWhen: ["local-dev"],
    doNotCall: [],
    capabilities: capabilities("ultra_fast", 5, 3, 2, 1, "very_low", "128k", false, "local"),
    costPer1MInput: 0,
    costPer1MOutput: 0,
    latencyMsP50: 80,
    reliability: 0.75,
    qualityByIntent: { AUTOCOMPLETE: 0.7, SEARCH: 0.55, UNKNOWN: 0.7 },
  },
];

export const DEFAULT_MODEL_CATALOG: readonly ModelSpec[] = RAW_CATALOG.map(withDefaults);

/** Extra tiers a model remains eligible for beyond its home tier. */
const ALSO_IN_TIERS: Record<string, readonly Tier[]> = Object.fromEntries(
  RAW_CATALOG.filter((r) => r.alsoInTiers?.length).map((r) => [r.id, [r.tier, ...(r.alsoInTiers ?? [])]]),
);

export function findModel(
  catalog: readonly ModelSpec[],
  id: string,
): ModelSpec | undefined {
  return catalog.find((m) => m.id === id);
}

export function findBySubTier(
  catalog: readonly ModelSpec[],
  subTier: string,
): ModelSpec | undefined {
  return catalog.find((m) => m.subTier === subTier);
}

export function isModelEligibleForTier(model: ModelSpec, minTier: Tier): boolean {
  if (tierIndex(model.tier) >= tierIndex(minTier)) return true;
  return (ALSO_IN_TIERS[model.id] ?? [model.tier]).some((t) => tierIndex(t) >= tierIndex(minTier));
}

export function recommendedRank(modelId: string, tier: Tier): number {
  const recs = TIER_RECOMMENDED_MODELS[tier] ?? [];
  const idx = recs.indexOf(modelId);
  return idx < 0 ? 99 : idx;
}

export function assertCatalogCoversRecommendations(): void {
  const ids = new Set(DEFAULT_MODEL_CATALOG.map((m) => m.id));
  for (const recs of Object.values(TIER_RECOMMENDED_MODELS)) {
    for (const id of recs) {
      if (!ids.has(id)) {
        throw new Error(`catalog does not cover recommended model: ${id}`);
      }
    }
  }
}
