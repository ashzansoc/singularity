/**
 * Structured routing signals from the local Qwen classifier.
 * Qwen never picks Flash vs Pro — policy does.
 */

export const FLASH_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';
export const PRO_MODEL_ID = 'deepseek/deepseek-v4-pro-0813';
export const LOCAL_CLASSIFIER_ID = 'qwen3-1.7b-mlx';

export const ROUTING_INTENTS = [
  'coding',
  'debugging',
  'refactoring',
  'architecture',
  'testing',
  'explanation',
  'documentation',
  'configuration',
  'research',
  'unknown',
] as const;

export type RoutingIntent = (typeof ROUTING_INTENTS)[number];

export const AMBIGUITY_LEVELS = ['low', 'medium', 'high'] as const;
export type AmbiguityLevel = (typeof AMBIGUITY_LEVELS)[number];

export const COMPLEXITY_LEVELS = ['low', 'medium', 'high'] as const;
export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number];

export const SCOPE_LEVELS = [
  'single_file',
  'single_component',
  'multi_component',
  'repository',
  'system_wide',
] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export interface RoutingSignals {
  intent: RoutingIntent;
  investigation_required: boolean;
  security_related: boolean;
  financial_related: boolean;
  production_related: boolean;
  architecture_related: boolean;
  data_integrity_related: boolean;
  ambiguity: AmbiguityLevel;
  complexity: ComplexityLevel;
  scope: ScopeLevel;
  verification_required: boolean;
}

export const EMPTY_ROUTING_SIGNALS: RoutingSignals = {
  intent: 'unknown',
  investigation_required: false,
  security_related: false,
  financial_related: false,
  production_related: false,
  architecture_related: false,
  data_integrity_related: false,
  ambiguity: 'low',
  complexity: 'low',
  scope: 'single_file',
  verification_required: false,
};

export const RISK_SIGNAL_KEYS = [
  'investigation_required',
  'security_related',
  'financial_related',
  'production_related',
  'architecture_related',
  'data_integrity_related',
  'verification_required',
] as const;

export type RiskSignalKey = (typeof RISK_SIGNAL_KEYS)[number];

export interface LocalRoutingDecision {
  router: typeof LOCAL_CLASSIFIER_ID;
  intent: RoutingIntent;
  complexity: ComplexityLevel;
  risk_signals: RiskSignalKey[];
  scope: ScopeLevel;
  final_model: typeof FLASH_MODEL_ID | typeof PRO_MODEL_ID;
  routing_reason: string;
  fallback: boolean;
  latency_ms: number;
  signals: RoutingSignals;
  /** How the signals were produced. */
  source: 'qwen' | 'safety' | 'rules' | 'timeout' | 'error';
}

export const QWEN_CLASSIFIER_SYSTEM_PROMPT = `You are Singularity's local engineering-task classifier.
Classify the user's engineering request. Do not solve it. Do not recommend a model.
Do not explain. Do not output code, diffs, or file edits.
Be conservative: software development alone is not high-risk.
Return only valid JSON matching the routing-signals schema.`;
