/**
 * Feature flags for the Context Engine.
 * When context_engine_enabled is false, Singularity behaves as before.
 */

export interface ContextEngineFlags {
  context_engine_enabled: boolean;
  langextract_enabled: boolean;
  context_retrieval_enabled: boolean;
  context_agent_integration_enabled: boolean;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return !/^(0|false|off|no)$/i.test(v.trim());
}

/**
 * Read flags from environment.
 * Default: engine ON so Agent / Ask / Edit / DAG all receive structured project context.
 * Set SINGULARITY_CONTEXT_ENGINE=false to disable.
 */
export function readContextEngineFlags(
  overrides?: Partial<ContextEngineFlags>,
): ContextEngineFlags {
  const base: ContextEngineFlags = {
    context_engine_enabled: envBool('SINGULARITY_CONTEXT_ENGINE', true),
    langextract_enabled: envBool('SINGULARITY_LANGEXTRACT_ENABLED', true),
    context_retrieval_enabled: envBool(
      'SINGULARITY_CONTEXT_RETRIEVAL_ENABLED',
      true,
    ),
    context_agent_integration_enabled: envBool(
      'SINGULARITY_CONTEXT_AGENT_INTEGRATION_ENABLED',
      true,
    ),
  };
  return { ...base, ...overrides };
}

export function isContextEngineActive(flags?: ContextEngineFlags): boolean {
  const f = flags ?? readContextEngineFlags();
  return f.context_engine_enabled;
}
