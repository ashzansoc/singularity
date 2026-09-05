import type { NeuralRelayFlags } from '../flags.js';
import { readNeuralRelayFlags } from '../flags.js';
import {
  buildDeepSeekContext,
  renderDeepSeekPrompt,
} from '../builder/contextBuilder.js';
import { confidenceAction } from '../intelligence/confidence.js';
import type { ContextIntelligenceModel } from '../intelligence/ContextIntelligenceModel.js';
import { OpenRouterNemotronProvider } from '../intelligence/OpenRouterNemotronProvider.js';
import { deterministicResolution } from '../intelligence/schema.js';
import { buildExperimentRecord } from '../metrics/experimentLog.js';
import {
  candidateMetadataTokens,
  deterministicRetrieve,
  rankCandidates,
  semanticRetrieve,
} from '../retrieval/pipeline.js';
import { makeEgress, logEgress } from '../security/egressLog.js';
import { NeuralRelayStore } from '../store.js';
import { estimateTokens } from '../hash.js';
import type {
  AnalyzeContextResult,
  ContextCandidate,
  ContextResolution,
  ExperimentRecord,
  RelayPrepareResult,
  RepoIndexPort,
} from '../types.js';
import { expandBuiltContext } from './expansion.js';
import {
  filterResolutionToIndex,
  tightContextResolution,
} from './fallback.js';

export interface PrepareRelayOptions {
  task: string;
  taskId?: string;
  index: RepoIndexPort;
  flags?: Partial<NeuralRelayFlags>;
  model?: ContextIntelligenceModel;
  store?: NeuralRelayStore;
  projectInstructions?: string;
  architecture?: string;
  toolDefinitions?: string;
  extraFiles?: string[];
  signal?: AbortSignal;
}

async function callWithRetry(
  model: ContextIntelligenceModel,
  task: string,
  candidates: ContextCandidate[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AnalyzeContextResult> {
  const first = await model.analyzeContext({
    task,
    candidates,
    timeoutMs,
    signal,
  });
  if (first.source === 'llm') {
    return first;
  }
  if (first.source === 'unavailable') {
    return first;
  }
  const retry = await model.analyzeContext({
    task,
    candidates,
    timeoutMs,
    signal,
  });
  if (retry.source === 'llm') {
    return { ...retry, source: 'retry' };
  }
  return first;
}

function candidatePaths(cands: ContextCandidate[]): string[] {
  return cands.map((c) => c.path);
}

/**
 * Run local retrieval + (optional) Nemotron context intelligence.
 * When flags.enabled is false, returns the existing-path no-op.
 */
export async function prepareNeuralRelayContext(
  options: PrepareRelayOptions,
): Promise<RelayPrepareResult> {
  const started = Date.now();
  const flags = readNeuralRelayFlags(options.flags);
  const taskId =
    options.taskId ??
    `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const store =
    options.store ??
    (options.index.workspaceRoot
      ? new NeuralRelayStore(options.index.workspaceRoot)
      : undefined);

  const original = Math.max(options.index.estimateCorpusTokens(), 1);

  if (!flags.enabled || flags.mode === 'BASELINE') {
    const experiment = buildExperimentRecord({
      taskId,
      mode: flags.enabled ? flags.mode : 'BASELINE',
      contextModel: flags.model,
      codingModel: flags.codingModel,
      originalContextTokens: original,
      relayContextTokens: original,
      nemotronInput: 0,
      nemotronOutput: 0,
      deepseekInput: original,
      deepseekOutput: 0,
      filesConsidered: options.index.listFileMetadata().length,
      filesSelected: options.index.listFileMetadata().length,
      filesUsed: 0,
      expansions: 0,
      retries: 0,
      totalLatencyMs: Date.now() - started,
      fallbackReason: flags.enabled ? undefined : 'disabled',
    });
    store?.writeExperiment(experiment);
    return {
      enabled: flags.enabled,
      mode: flags.mode,
      usedRelay: false,
      fallbackReason: flags.enabled ? undefined : 'disabled',
      experiment,
      promptBlock: '',
    };
  }

  const [det, semantic] = await Promise.all([
    deterministicRetrieve(options.index, options.task),
    Promise.resolve(
      semanticRetrieve(options.index, options.task, flags.candidateLimit),
    ),
  ]);

  let candidates = rankCandidates(options.index, det, semantic, {
    task: options.task,
    limit: flags.candidateLimit,
  });

  const model =
    options.model ??
    new OpenRouterNemotronProvider({
      model: flags.model,
      timeoutMs: flags.timeoutMs,
    });

  const metaText = candidates
    .map((c) => `${c.path}\n${c.summary}\n${c.excerpt}`)
    .join('\n');
  const egressNemo = makeEgress(
    flags.model,
    'CONTEXT_INTELLIGENCE',
    candidatePaths(candidates),
    metaText,
  );
  logEgress(store, egressNemo);

  let analysis = await callWithRetry(
    model,
    options.task,
    candidates,
    flags.timeoutMs,
    options.signal,
  );

  let fallbackReason: string | undefined;
  let resolution: ContextResolution;
  let usedRelay = true;
  const maxRelayFiles = flags.maxRelayFiles;

  if (analysis.source === 'unavailable') {
    fallbackReason = 'nemotron_unavailable';
    resolution = tightContextResolution(
      options.task,
      candidates,
      maxRelayFiles,
    );
  } else if (
    analysis.source === 'error' &&
    !analysis.resolution.relevant_files.length
  ) {
    resolution = deterministicResolution(
      options.task,
      candidatePaths(candidates).slice(0, maxRelayFiles),
    );
    if (resolution.relevant_files.length === 0) {
      fallbackReason = 'invalid_json';
    }
  } else {
    resolution = filterResolutionToIndex(analysis.resolution, options.index);

    // LLM picked files — keep the tight set (best cache reuse).
    if (resolution.relevant_files.length === 0) {
      const action = confidenceAction(resolution.confidence, flags);
      if (action === 'retrieve_more') {
        const extra = rankCandidates(options.index, det, semantic, {
          task: options.task,
          limit: Math.min(flags.candidateLimit * 2, 80),
          excerptChars: 600,
        });
        candidates = extra;
        analysis = await callWithRetry(
          model,
          options.task,
          extra,
          flags.timeoutMs,
          options.signal,
        );
        if (analysis.source === 'llm' || analysis.source === 'retry') {
          resolution = filterResolutionToIndex(
            analysis.resolution,
            options.index,
          );
        }
      }
      if (resolution.relevant_files.length === 0) {
        resolution = tightContextResolution(
          options.task,
          candidates,
          maxRelayFiles,
        );
        if (resolution.relevant_files.length === 0) {
          fallbackReason =
            action === 'fallback_broader' ? 'low_confidence' : 'no_files_selected';
        }
      }
    }
  }

  let built = buildDeepSeekContext({
    task: options.task,
    resolution,
    index: options.index,
    projectInstructions: options.projectInstructions,
    architecture: options.architecture,
    toolDefinitions: options.toolDefinitions,
    extraFiles: options.extraFiles,
    maxFiles: maxRelayFiles,
    maxFileChars: 5_000,
  });

  if (built.estimatedTokens > flags.maxDeepSeekContextTokens) {
    fallbackReason = 'context_too_large';
    resolution = tightContextResolution(
      options.task,
      candidates,
      Math.max(4, Math.floor(maxRelayFiles / 2)),
    );
    built = buildDeepSeekContext({
      task: options.task,
      resolution,
      index: options.index,
      projectInstructions: options.projectInstructions,
      architecture: options.architecture,
      toolDefinitions: options.toolDefinitions,
      extraFiles: options.extraFiles,
      maxFiles: Math.max(4, Math.floor(maxRelayFiles / 2)),
      maxFileChars: 3_500,
    });
  }

  const promptBlock = renderDeepSeekPrompt(built);
  const egressDs = makeEgress(
    flags.codingModel,
    'CODING',
    built.filesUsed,
    promptBlock,
  );
  logEgress(store, egressDs);

  const experiment: ExperimentRecord = buildExperimentRecord({
    taskId,
    mode: flags.mode,
    contextModel: flags.model,
    codingModel: flags.codingModel,
    originalContextTokens: built.originalContextTokens,
    relayContextTokens: built.estimatedTokens,
    nemotronInput: analysis.inputTokens || candidateMetadataTokens(candidates),
    nemotronOutput: analysis.outputTokens,
    deepseekInput: built.estimatedTokens,
    deepseekOutput: 0,
    // The stable prefix is the cacheable portion — on relay turns it is a
    // DeepSeek cache read (the design's core premise), not fresh input.
    deepseekCacheRead: estimateTokens(built.stablePrefix),
    filesConsidered: candidates.length,
    filesSelected: resolution.relevant_files.length,
    filesUsed: built.filesUsed.length,
    expansions: 0,
    retries: analysis.source === 'retry' ? 1 : 0,
    nemotronTtftMs: analysis.ttftMs,
    nemotronTps: analysis.tokensPerSecond,
    totalLatencyMs: Date.now() - started,
    egress: [egressNemo, egressDs],
    fallbackReason,
  });
  store?.writeExperiment(experiment);

  return {
    enabled: true,
    mode: flags.mode,
    usedRelay,
    fallbackReason,
    built,
    resolution,
    experiment,
    promptBlock,
  };
}

export function applyContextExpansion(
  prepared: RelayPrepareResult,
  index: RepoIndexPort,
  requestedFiles: string[],
  reason: string,
  store?: NeuralRelayStore,
): RelayPrepareResult {
  if (!prepared.built) {
    return prepared;
  }
  const next = expandBuiltContext({
    built: prepared.built,
    index,
    requestedFiles,
    reason,
  });
  const promptBlock = renderDeepSeekPrompt(next);
  const experiment = buildExperimentRecord({
    taskId: prepared.experiment.task_id,
    mode: prepared.mode,
    contextModel: prepared.experiment.context_model,
    codingModel: prepared.experiment.coding_model,
    originalContextTokens: prepared.experiment.original_context_tokens,
    relayContextTokens: next.estimatedTokens,
    nemotronInput: prepared.experiment.tokens.nemotron_input_tokens,
    nemotronOutput: prepared.experiment.tokens.nemotron_output_tokens,
    deepseekInput: next.estimatedTokens,
    deepseekOutput: prepared.experiment.tokens.deepseek_output_tokens,
    deepseekCacheRead: estimateTokens(next.stablePrefix),
    filesConsidered: prepared.experiment.tokens.files_considered,
    filesSelected: prepared.experiment.tokens.files_selected,
    filesUsed: next.filesUsed.length,
    expansions: prepared.experiment.context_expansions + 1,
    retries: prepared.experiment.retry_count,
    nemotronTtftMs: prepared.experiment.performance.nemotron_ttft_ms,
    nemotronTps: prepared.experiment.performance.nemotron_tokens_per_second,
    totalLatencyMs: prepared.experiment.performance.total_latency_ms,
    egress: [
      ...prepared.experiment.egress,
      makeEgress(
        prepared.experiment.coding_model,
        'CODING',
        next.filesUsed,
        promptBlock,
      ),
    ],
    fallbackReason: prepared.fallbackReason,
  });
  store?.writeExperiment(experiment);
  return {
    ...prepared,
    built: next,
    experiment,
    promptBlock,
  };
}