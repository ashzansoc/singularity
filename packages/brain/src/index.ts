/**
 * Singularity Brain — persistent user-level cognitive runtime.
 *
 * One Brain. One dedicated reasoning MoE. Four kinds of memory.
 * Continuous cognition without a multi-agent swarm.
 */

export * from './types.js';
export { BrainStore, normLabel, packEmbedding, unpackEmbedding } from './store.js';
export {
  HashBrainEmbedder,
  GatewayBrainEmbedder,
  cosine,
  type BrainEmbeddingProvider,
} from './embeddings.js';
export {
  MemoryExtractor,
  isTrivialForBrain,
  type BrainLlmClient,
  type ExtractionInput,
  type ExtractionResult,
} from './extraction.js';
export { computeImportance } from './importance.js';
export { brainSearch } from './search.js';
export { BrainEngine, type BrainEngineOptions, type BrainLlm } from './engine.js';
export { resolveBrainConfig, brainModelConfigured, type BrainConfigPartial } from './config.js';
export {
  OpenAiCompatibleBrainClient,
  MockBrainModelClient,
  brainLlmFromClient,
  type BrainModelClient,
  type BrainChatMessage,
  type BrainModelResult,
} from './modelClient.js';
export { BRAIN_SYSTEM_PROMPT, ULTRATHINK_ADDENDUM, buildBrainMessages } from './prompt.js';
export { scoreAttention } from './attention.js';
export { BrainBudget } from './budget.js';
export { minimizeForRemote, packSections } from './privacy.js';
export { SemanticMemoryApi, entityToSemantic } from './semantic.js';
export { ImprovementManager } from './improvement.js';
export { BrainRuntime, type BrainRuntimeOptions } from './runtime.js';
export {
  BRAIN_TOOL_DEFS,
  executeBrainTool,
  parseToolCall,
  toolSchemasForPrompt,
} from './tools.js';
