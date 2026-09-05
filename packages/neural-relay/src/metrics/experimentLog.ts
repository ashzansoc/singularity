import type { NeuralRelayFlags, NeuralRelayMode } from '../flags.js';
import { DEFAULT_CODING_MODEL, DEFAULT_NEURAL_RELAY_MODEL } from '../flags.js';
import type {
  EgressEntry,
  ExperimentRecord,
  NeuralRelayCostMetrics,
  NeuralRelayPerfMetrics,
  NeuralRelayQualityMetrics,
  NeuralRelayTokenMetrics,
} from '../types.js';
import { contextReduction, costUsd } from './pricing.js';

export interface ExperimentDraft {
  taskId: string;
  mode: NeuralRelayMode;
  contextModel?: string;
  codingModel?: string;
  originalContextTokens: number;
  relayContextTokens: number;
  nemotronInput: number;
  nemotronOutput: number;
  deepseekInput: number;
  deepseekOutput: number;
  deepseekCacheRead?: number;
  filesConsidered: number;
  filesSelected: number;
  filesUsed: number;
  expansions: number;
  retries: number;
  testsPassed?: boolean;
  testsFailed?: boolean;
  typecheckPassed?: boolean;
  buildPassed?: boolean;
  taskSuccess?: boolean;
  nemotronTtftMs?: number;
  nemotronTps?: number;
  deepseekTtftMs?: number;
  totalLatencyMs?: number;
  egress?: EgressEntry[];
  fallbackReason?: string;
}

export function buildExperimentRecord(d: ExperimentDraft): ExperimentRecord {
  const contextModel = d.contextModel ?? DEFAULT_NEURAL_RELAY_MODEL;
  const codingModel = d.codingModel ?? DEFAULT_CODING_MODEL;
  const reduction = contextReduction(d.originalContextTokens, d.relayContextTokens);
  const nemotronTokens = d.nemotronInput + d.nemotronOutput;
  const deepseekTokens = d.deepseekInput + d.deepseekOutput;
  const cacheRead = d.deepseekCacheRead ?? 0;
  const cacheMiss = Math.max(0, d.deepseekInput - cacheRead);

  const baselineInput = d.originalContextTokens;
  const baselineCost = costUsd(codingModel, baselineInput, d.deepseekOutput, 0);
  const relayCost =
    costUsd(contextModel, d.nemotronInput, d.nemotronOutput, 0) +
    costUsd(codingModel, cacheMiss, d.deepseekOutput, cacheRead);
  const saved = baselineCost - relayCost;
  const costPct = baselineCost > 0 ? saved / baselineCost : 0;

  const tokens: NeuralRelayTokenMetrics = {
    baseline_total_tokens: baselineInput + d.deepseekOutput,
    relay_total_tokens: nemotronTokens + deepseekTokens,
    baseline_input_tokens: baselineInput,
    relay_input_tokens: d.nemotronInput + d.deepseekInput,
    baseline_cache_read_tokens: 0,
    relay_cache_read_tokens: cacheRead,
    baseline_cache_miss_tokens: baselineInput,
    relay_cache_miss_tokens: cacheMiss,
    nemotron_input_tokens: d.nemotronInput,
    nemotron_output_tokens: d.nemotronOutput,
    deepseek_input_tokens: d.deepseekInput,
    deepseek_output_tokens: d.deepseekOutput,
    original_context_tokens: d.originalContextTokens,
    retrieved_context_tokens: d.relayContextTokens,
    context_reduction_percentage: Math.round(reduction * 1000) / 10,
    files_considered: d.filesConsidered,
    files_selected: d.filesSelected,
    files_used_by_deepseek: d.filesUsed,
    context_expansion_count: d.expansions,
  };

  const quality: NeuralRelayQualityMetrics = {
    task_success: d.taskSuccess ?? false,
    tests_passed: d.testsPassed ?? false,
    tests_failed: d.testsFailed ?? false,
    build_passed: d.buildPassed ?? false,
    typecheck_passed: d.typecheckPassed ?? false,
    retry_count: d.retries,
  };

  const performance: NeuralRelayPerfMetrics = {
    nemotron_ttft_ms: d.nemotronTtftMs ?? 0,
    nemotron_tokens_per_second: d.nemotronTps ?? 0,
    deepseek_ttft_ms: d.deepseekTtftMs ?? 0,
    total_latency_ms: d.totalLatencyMs ?? 0,
  };

  const cost: NeuralRelayCostMetrics = {
    baseline_cost: baselineCost,
    relay_cost: relayCost,
    estimated_cost_saved: saved,
    cost_reduction_percentage: Math.round(costPct * 1000) / 10,
  };

  return {
    task_id: d.taskId,
    mode: d.mode,
    context_model: contextModel,
    coding_model: codingModel,
    original_context_tokens: d.originalContextTokens,
    context_tokens_sent_to_deepseek: d.relayContextTokens,
    context_reduction: Math.round(reduction * 1000) / 10,
    nemotron_tokens: nemotronTokens,
    deepseek_tokens: deepseekTokens,
    baseline_cost: baselineCost,
    relay_cost: relayCost,
    tests_passed: d.testsPassed ?? false,
    retry_count: d.retries,
    context_expansions: d.expansions,
    tokens,
    quality,
    performance,
    cost,
    egress: d.egress ?? [],
    fallback_reason: d.fallbackReason,
    created_at: new Date().toISOString(),
  };
}

export function successCriteria(opts: {
  flags?: NeuralRelayFlags;
  baselineSuccessRate: number;
  relaySuccessRate: number;
  baselineTestPassRate: number;
  relayTestPassRate: number;
  contextReduction: number;
  costReduction: number;
}): {
  success: boolean;
  excellent: boolean;
  notes: string[];
} {
  const notes: string[] = [];
  const taskOk = opts.relaySuccessRate >= opts.baselineSuccessRate - 0.02;
  const testOk = opts.relayTestPassRate >= opts.baselineTestPassRate;
  const ctxOk = opts.contextReduction >= 0.5;
  const costOk = opts.costReduction >= 0.3;
  if (!taskOk) {
    notes.push('task success below baseline-2%');
  }
  if (!testOk) {
    notes.push('test pass rate below baseline');
  }
  if (!ctxOk) {
    notes.push('context reduction below 50%');
  }
  if (!costOk) {
    notes.push('cost reduction below 30%');
  }
  const excellent =
    taskOk &&
    testOk &&
    opts.contextReduction >= 0.75 &&
    opts.costReduction >= 0.5;
  return { success: taskOk && testOk && ctxOk && costOk, excellent, notes };
}
