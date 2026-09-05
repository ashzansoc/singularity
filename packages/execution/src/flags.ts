export interface ExecutionFlags {
  enabled: boolean;
  maxConcurrentAgents: number;
  autoPlanThreshold: 'low' | 'medium' | 'high';
  riskParallelization: 'conservative' | 'balanced' | 'aggressive';
}

export const DEFAULT_EXECUTION_FLAGS: ExecutionFlags = {
  enabled: true,
  maxConcurrentAgents: 8,
  autoPlanThreshold: 'medium',
  riskParallelization: 'balanced',
};

export function parseExecutionFlags(env: Record<string, string | undefined> = process.env): ExecutionFlags {
  return {
    enabled: env.SINGULARITY_EXECUTION_ENABLED === '0' || env.SINGULARITY_EXECUTION_ENABLED === 'false'
      ? false
      : DEFAULT_EXECUTION_FLAGS.enabled,
    maxConcurrentAgents: Number(env.SINGULARITY_EXECUTION_MAX_CONCURRENT ?? 8),
    autoPlanThreshold: (env.SINGULARITY_EXECUTION_AUTO_PLAN_THRESHOLD as ExecutionFlags['autoPlanThreshold']) ?? 'medium',
    riskParallelization: (env.SINGULARITY_EXECUTION_RISK_PARALLELIZATION as ExecutionFlags['riskParallelization']) ?? 'balanced',
  };
}
