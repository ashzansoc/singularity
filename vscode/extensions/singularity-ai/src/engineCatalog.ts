/**
 * Canonical engine names shown in chat when a plane is invoked.
 * Keep in sync with the limitation-status canvas grouping.
 */
export const ENGINE = {
  context: 'Context Engine',
  memory: 'Memory Engine',
  architecture: 'Architecture Engine',
  outcome: 'Outcome Engine',
  intelligence: 'Project Intelligence Engine',
  wiki: 'Wiki Engine',
  neuralRelay: 'Neural Relay',
  production: 'Production Awareness Engine',
  impact: 'Impact Analysis Engine',
  risk: 'Risk Engine',
  runtime: 'Runtime Engine',
  router: 'Model Router',
  cache: 'Cache Engine',
  design: 'Design Intelligence',
} as const;

export type EngineDisplayName = (typeof ENGINE)[keyof typeof ENGINE];

export function uniqueEngines(names: Array<EngineDisplayName | undefined | ''>): EngineDisplayName[] {
  const seen = new Set<string>();
  const out: EngineDisplayName[] = [];
  for (const n of names) {
    if (!n || seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
  }
  return out;
}
