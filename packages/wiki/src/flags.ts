/**
 * Feature flags for the LLM Wiki.
 * When wiki_enabled is false, Singularity behaves as before.
 */

export interface WikiEngineFlags {
  wiki_enabled: boolean;
  wiki_agent_integration_enabled: boolean;
  /** Relative path from workspace root. Default: `.singularity/wiki`. */
  wiki_root: string;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return !/^(0|false|off|no)$/i.test(v.trim());
}

export function readWikiEngineFlags(
  overrides?: Partial<WikiEngineFlags>,
): WikiEngineFlags {
  const root =
    process.env.SINGULARITY_WIKI_ROOT?.trim() || '.singularity/wiki';
  const base: WikiEngineFlags = {
    wiki_enabled: envBool('SINGULARITY_WIKI', true),
    wiki_agent_integration_enabled: envBool(
      'SINGULARITY_WIKI_AGENT_INTEGRATION',
      true,
    ),
    wiki_root: root.replace(/\\/g, '/').replace(/\/+$/, '') || '.singularity/wiki',
  };
  return { ...base, ...overrides };
}

export function isWikiEngineActive(flags?: WikiEngineFlags): boolean {
  const f = flags ?? readWikiEngineFlags();
  return f.wiki_enabled;
}
