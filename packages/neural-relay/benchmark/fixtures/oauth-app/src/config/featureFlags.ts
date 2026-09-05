export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPct: number;
}

const flags = new Map<string, FeatureFlag>([
  ['apple-signin', { key: 'apple-signin', enabled: false, rolloutPct: 0 }],
  ['dark-mode', { key: 'dark-mode', enabled: true, rolloutPct: 100 }],
]);

export function isEnabled(key: string): boolean {
  return flags.get(key)?.enabled ?? false;
}

export function setFlag(key: string, enabled: boolean, rolloutPct = 100): void {
  flags.set(key, { key, enabled, rolloutPct });
}

export function listFlags(): FeatureFlag[] {
  return [...flags.values()];
}

export function resetFlags(): void {
  flags.clear();
  flags.set('dark-mode', { key: 'dark-mode', enabled: true, rolloutPct: 100 });
}