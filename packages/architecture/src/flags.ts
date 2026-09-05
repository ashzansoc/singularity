/**
 * Feature flags for Architecture Intelligence.
 * Coding plane may import this module.
 */

export interface ArchitectureFlags {
  architecture_memory_enabled: boolean;
  adr_extraction_enabled: boolean;
  architecture_graph_enabled: boolean;
  architecture_vector_search_enabled: boolean;
  architecture_drift_detection_enabled: boolean;
  architecture_conflict_detection_enabled: boolean;
  architecture_evolution_enabled: boolean;
  architecture_context_enabled: boolean;
  production_awareness_enabled: boolean;
  mission_risk_scoring_enabled: boolean;
  mission_risk_weights?: Partial<{
    change_blast_radius: number;
    architecture: number;
    production: number;
    historical: number;
    verification: number;
    complexity: number;
    prompt: number;
  }>;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return !/^(0|false|off|no)$/i.test(v.trim());
}

export function readArchitectureFlags(
  overrides?: Partial<ArchitectureFlags>,
): ArchitectureFlags {
  const base: ArchitectureFlags = {
    architecture_memory_enabled: envBool('ARCHITECTURE_MEMORY_ENABLED', true),
    adr_extraction_enabled: envBool('ADR_EXTRACTION_ENABLED', true),
    architecture_graph_enabled: envBool('ARCHITECTURE_GRAPH_ENABLED', true),
    architecture_vector_search_enabled: envBool(
      'ARCHITECTURE_VECTOR_SEARCH_ENABLED',
      true,
    ),
    architecture_drift_detection_enabled: envBool(
      'ARCHITECTURE_DRIFT_DETECTION_ENABLED',
      true,
    ),
    architecture_conflict_detection_enabled: envBool(
      'ARCHITECTURE_CONFLICT_DETECTION_ENABLED',
      true,
    ),
    architecture_evolution_enabled: envBool('ARCHITECTURE_EVOLUTION_ENABLED', true),
    architecture_context_enabled: envBool('ARCHITECTURE_CONTEXT_ENABLED', true),
    production_awareness_enabled: envBool('PRODUCTION_AWARENESS_ENABLED', true),
    mission_risk_scoring_enabled: envBool('ARCHITECTURE_MISSION_RISK_SCORING_ENABLED', true),
  };
  const weightsRaw = process.env.ARCHITECTURE_RISK_WEIGHTS_JSON;
  if (weightsRaw) {
    try {
      base.mission_risk_weights = JSON.parse(weightsRaw) as ArchitectureFlags['mission_risk_weights'];
    } catch {
      /* keep defaults */
    }
  }
  return { ...base, ...overrides };
}

export function isArchitectureMemoryActive(flags?: ArchitectureFlags): boolean {
  const f = flags ?? readArchitectureFlags();
  return f.architecture_memory_enabled;
}
