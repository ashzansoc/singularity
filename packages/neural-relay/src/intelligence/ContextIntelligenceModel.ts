import type {
  AnalyzeContextOptions,
  AnalyzeContextResult,
  ContextCandidate,
  ContextResolution,
} from '../types.js';

/**
 * Backend-replaceable context intelligence model.
 * The Context Engine must not care which provider implements this.
 */
export interface ContextIntelligenceModel {
  readonly id: string;
  analyzeContext(options: AnalyzeContextOptions): Promise<AnalyzeContextResult>;
}

/** Future local backends — interface only for this POC. */
export class MLXProvider implements ContextIntelligenceModel {
  readonly id = 'mlx';
  async analyzeContext(): Promise<AnalyzeContextResult> {
    throw new Error('MLXProvider is not implemented in this POC');
  }
}

export class LlamaCppProvider implements ContextIntelligenceModel {
  readonly id = 'llamacpp';
  async analyzeContext(): Promise<AnalyzeContextResult> {
    throw new Error('LlamaCppProvider is not implemented in this POC');
  }
}

export class OllamaProvider implements ContextIntelligenceModel {
  readonly id = 'ollama';
  async analyzeContext(): Promise<AnalyzeContextResult> {
    throw new Error('OllamaProvider is not implemented in this POC');
  }
}

export class VllmProvider implements ContextIntelligenceModel {
  readonly id = 'vllm';
  async analyzeContext(): Promise<AnalyzeContextResult> {
    throw new Error('VllmProvider is not implemented in this POC');
  }
}

export type { ContextCandidate, ContextResolution };
