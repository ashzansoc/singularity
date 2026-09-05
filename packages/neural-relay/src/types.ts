import type { NeuralRelayMode } from './flags.js';

export type ModelRole =
  | 'CODING'
  | 'REASONING'
  | 'VERIFICATION'
  | 'CONTEXT_INTELLIGENCE';

export interface ModelRoleBinding {
  role: ModelRole;
  provider: 'openrouter' | 'local' | 'mlx' | 'llamacpp' | 'ollama' | 'vllm';
  model: string;
}

export interface IndexedFile {
  path: string;
  language: string;
  size: number;
  summary: string;
  symbols: string[];
  imports: string[];
  importedBy: string[];
  tests: string[];
  excerpt?: string;
}

export interface ContextCandidate {
  path: string;
  language: string;
  size: number;
  summary: string;
  symbols: string[];
  imports: string[];
  importedBy: string[];
  tests: string[];
  excerpt: string;
  score: number;
  reasons: string[];
}

export interface RelevantFile {
  path: string;
  reason: string;
  priority: number;
}

export interface ContextResolution {
  task_understanding: string;
  relevant_files: RelevantFile[];
  relevant_symbols: string[];
  dependencies_to_inspect: string[];
  missing_context: string[];
  confidence: number;
}

export type ConfidenceAction =
  | 'use_selected'
  | 'retrieve_more'
  | 'fallback_broader';

export interface EgressEntry {
  model: string;
  role: ModelRole;
  files: string[];
  estimatedTokens: number;
  ts: number;
}

export interface BuiltContext {
  /** Stable prefix — keep identical across expansion turns for DeepSeek KV cache. */
  stablePrefix: string;
  /** Hash of the stable prefix — pass through as OpenRouter prompt_cache_key. */
  promptCacheKey: string;
  /** Volatile selected files / symbols / tests. */
  relevantBlock: string;
  userTask: string;
  filesUsed: string[];
  estimatedTokens: number;
  originalContextTokens: number;
}

export interface ContextExpansionRequest {
  needs_more_context: boolean;
  requested_files: string[];
  reason: string;
}

export interface NeuralRelayTokenMetrics {
  baseline_total_tokens: number;
  relay_total_tokens: number;
  baseline_input_tokens: number;
  relay_input_tokens: number;
  baseline_cache_read_tokens: number;
  relay_cache_read_tokens: number;
  baseline_cache_miss_tokens: number;
  relay_cache_miss_tokens: number;
  nemotron_input_tokens: number;
  nemotron_output_tokens: number;
  deepseek_input_tokens: number;
  deepseek_output_tokens: number;
  original_context_tokens: number;
  retrieved_context_tokens: number;
  context_reduction_percentage: number;
  files_considered: number;
  files_selected: number;
  files_used_by_deepseek: number;
  context_expansion_count: number;
}

export interface NeuralRelayQualityMetrics {
  task_success: boolean;
  tests_passed: boolean;
  tests_failed: boolean;
  build_passed: boolean;
  typecheck_passed: boolean;
  retry_count: number;
}

export interface NeuralRelayPerfMetrics {
  nemotron_ttft_ms: number;
  nemotron_tokens_per_second: number;
  deepseek_ttft_ms: number;
  total_latency_ms: number;
}

export interface NeuralRelayCostMetrics {
  baseline_cost: number;
  relay_cost: number;
  estimated_cost_saved: number;
  cost_reduction_percentage: number;
}

export interface ExperimentRecord {
  task_id: string;
  mode: NeuralRelayMode;
  context_model: string;
  coding_model: string;
  original_context_tokens: number;
  context_tokens_sent_to_deepseek: number;
  context_reduction: number;
  nemotron_tokens: number;
  deepseek_tokens: number;
  baseline_cost: number;
  relay_cost: number;
  tests_passed: boolean;
  retry_count: number;
  context_expansions: number;
  tokens: NeuralRelayTokenMetrics;
  quality: NeuralRelayQualityMetrics;
  performance: NeuralRelayPerfMetrics;
  cost: NeuralRelayCostMetrics;
  egress: EgressEntry[];
  fallback_reason?: string;
  created_at: string;
}

export interface AnalyzeContextOptions {
  task: string;
  candidates: ContextCandidate[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AnalyzeContextResult {
  resolution: ContextResolution;
  source: 'llm' | 'retry' | 'deterministic' | 'error' | 'unavailable';
  inputTokens: number;
  outputTokens: number;
  ttftMs: number;
  tokensPerSecond: number;
  latencyMs: number;
  raw?: string;
}

export interface RelayPrepareResult {
  enabled: boolean;
  mode: NeuralRelayMode;
  usedRelay: boolean;
  fallbackReason?: string;
  built?: BuiltContext;
  resolution?: ContextResolution;
  experiment: ExperimentRecord;
  promptBlock: string;
}

export interface RepoIndexPort {
  workspaceRoot: string;
  listFileMetadata(): IndexedFile[];
  searchFilename(query: string): IndexedFile[];
  searchSymbol(query: string): IndexedFile[];
  searchKeyword(query: string): IndexedFile[];
  /** Optional IntelligenceEngine / retrieveContext semantic hits. */
  semanticSearch?(query: string, limit?: number): IndexedFile[];
  neighborhood(path: string): {
    imports: string[];
    importedBy: string[];
    tests: string[];
  };
  readFile(path: string): string | undefined;
  estimateCorpusTokens(): number;
}
