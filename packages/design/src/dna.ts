import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_DESIGN_DNA,
  type DesignDna,
  type DesignDnaColors,
  type DesignDnaTypography,
} from './types.js';

const DNA_FILENAME = 'design-dna.json';

export function dnaPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.singularity', DNA_FILENAME);
}

export function loadDesignDna(workspaceRoot: string, workspaceId = 'default'): DesignDna {
  const path = dnaPath(workspaceRoot);
  if (!existsSync(path)) {
    return createDefaultDna(workspaceId);
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as DesignDna;
    return {
      ...createDefaultDna(workspaceId),
      ...raw,
      typography: { ...DEFAULT_DESIGN_DNA.typography, ...raw.typography },
      spacing: { ...DEFAULT_DESIGN_DNA.spacing, ...raw.spacing },
      colors: { ...DEFAULT_DESIGN_DNA.colors, ...raw.colors },
      motion: { ...DEFAULT_DESIGN_DNA.motion, ...raw.motion },
      layout: { ...DEFAULT_DESIGN_DNA.layout, ...raw.layout },
      components: raw.components?.length ? raw.components : [...DEFAULT_DESIGN_DNA.components!],
      notes: raw.notes ?? [],
      sourcesUsed: raw.sourcesUsed ?? [],
      version: 1,
      workspaceId: raw.workspaceId || workspaceId,
    };
  } catch {
    return createDefaultDna(workspaceId);
  }
}

export function saveDesignDna(workspaceRoot: string, dna: DesignDna): void {
  const path = dnaPath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  const next: DesignDna = { ...dna, version: 1, updatedAt: Date.now() };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

export function createDefaultDna(workspaceId: string): DesignDna {
  return {
    ...DEFAULT_DESIGN_DNA,
    workspaceId,
    updatedAt: Date.now(),
    components: [...DEFAULT_DESIGN_DNA.components!],
    notes: [...(DEFAULT_DESIGN_DNA.notes ?? [])],
    sourcesUsed: [...(DEFAULT_DESIGN_DNA.sourcesUsed ?? [])],
  };
}

/** Render DNA as a compact prompt block for the frontend agent. */
export function formatDnaForPrompt(dna: DesignDna): string {
  return [
    'Design DNA (project design system — follow unless the user overrides)',
    '──────────────',
    'Typography',
    `  ${dna.typography.sans}`,
    `  ${dna.typography.bodyPx}px body`,
    `  ${dna.typography.headingPx}px headings`,
    dna.typography.mono ? `  mono: ${dna.typography.mono}` : '',
    'Spacing',
    `  ${dna.spacing.baseGridPx}px base grid`,
    dna.spacing.sectionGapPx ? `  section gap ~${dna.spacing.sectionGapPx}px` : '',
    'Radius',
    `  ${dna.radiusPx}px`,
    'Colors',
    `  background: ${dna.colors.background}`,
    `  foreground: ${dna.colors.foreground}`,
    `  accent: ${dna.colors.accent}`,
    dna.colors.notes ? `  note: ${dna.colors.notes}` : '',
    'Components',
    ...dna.components.map((c) => `  ${c}`),
    'Motion',
    `  ${dna.motion.durationMs[0]}–${dna.motion.durationMs[1]}ms`,
    `  ${dna.motion.easing}`,
    'Layout',
    `  max-width ${dna.layout.maxWidthPx}px`,
    dna.layout.responsive ? `  ${dna.layout.responsive}` : '',
    dna.notes?.length ? `Notes:\n${dna.notes.map((n) => `  - ${n}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface DnaMergePatch {
  typography?: Partial<DesignDnaTypography>;
  spacing?: Partial<DesignDna['spacing']>;
  radiusPx?: number;
  colors?: Partial<DesignDnaColors>;
  components?: string[];
  motion?: Partial<DesignDna['motion']>;
  layout?: Partial<DesignDna['layout']>;
  notes?: string[];
  sourcesUsed?: string[];
}

/** Merge observations from a frontend generation into existing DNA. */
export function mergeDesignDna(current: DesignDna, patch: DnaMergePatch): DesignDna {
  const components = unique([
    ...current.components,
    ...(patch.components ?? []),
  ]);
  const notes = unique([...(current.notes ?? []), ...(patch.notes ?? [])]).slice(-24);
  const sourcesUsed = unique([
    ...(current.sourcesUsed ?? []),
    ...(patch.sourcesUsed ?? []),
  ]).slice(-32);

  return {
    ...current,
    updatedAt: Date.now(),
    typography: { ...current.typography, ...patch.typography },
    spacing: { ...current.spacing, ...patch.spacing },
    radiusPx: patch.radiusPx ?? current.radiusPx,
    colors: { ...current.colors, ...patch.colors },
    components,
    motion: {
      ...current.motion,
      ...patch.motion,
      durationMs: patch.motion?.durationMs ?? current.motion.durationMs,
    },
    layout: { ...current.layout, ...patch.layout },
    notes,
    sourcesUsed,
  };
}

/**
 * Heuristic DNA extraction from generated frontend file contents.
 * Lightweight — no LLM required; captures tokens Singularity can reuse next time.
 */
export function extractDnaSignalsFromFiles(
  files: Array<{ path: string; content: string }>,
): DnaMergePatch {
  const joined = files.map((f) => f.content).join('\n');
  const patch: DnaMergePatch = { components: [], notes: [] };

  if (/shadcn|@\/components\/ui\//i.test(joined)) patch.components!.push('shadcn');
  if (/@radix-ui\//i.test(joined)) patch.components!.push('Radix');
  if (/@mantine\//i.test(joined)) patch.components!.push('Mantine');
  if (/@tremor|tremor\/react/i.test(joined)) patch.components!.push('Tremor');
  if (/@heroui\/|@nextui-org\//i.test(joined)) patch.components!.push('HeroUI');
  if (/framer-motion|motion\./i.test(joined)) patch.components!.push('Framer Motion');
  if (/three|@react-three/i.test(joined)) patch.components!.push('Three.js');
  if (/magicui|aceternity/i.test(joined)) {
    patch.components!.push('Magic UI / Aceternity-style effects');
  }

  const radius = joined.match(/rounded-(\[?\d+px\]?|sm|md|lg|xl)/);
  if (radius) {
    const map: Record<string, number> = { sm: 4, md: 6, lg: 8, xl: 12 };
    const token = radius[1]!;
    if (map[token] !== undefined) patch.radiusPx = map[token];
    else {
      const px = token.match(/(\d+)/);
      if (px) patch.radiusPx = Number(px[1]);
    }
  }

  const font = joined.match(/font-(?:sans|family).*?['"]([A-Za-z0-9 ]+)['"]/);
  if (font) {
    patch.typography = { sans: font[1]!.trim(), bodyPx: 14, headingPx: 24 };
  } else if (/Inter/i.test(joined)) {
    patch.typography = { sans: 'Inter', bodyPx: 14, headingPx: 24 };
  }

  const maxW = joined.match(/max-w-\[?(\d{3,4})px\]?|max-w-7xl|max-w-6xl/);
  if (maxW) {
    if (maxW[1]) patch.layout = { maxWidthPx: Number(maxW[1]) };
    else if (maxW[0]?.includes('7xl')) patch.layout = { maxWidthPx: 1280 };
    else if (maxW[0]?.includes('6xl')) patch.layout = { maxWidthPx: 1152 };
  }

  const duration = joined.match(/duration-(\d{2,3})/);
  if (duration) {
    const ms = Number(duration[1]);
    if (ms >= 100 && ms <= 500) {
      patch.motion = { durationMs: [ms, Math.min(ms + 100, 400)], easing: 'ease-out' };
    }
  }

  for (const f of files) {
    if (/\.(tsx|jsx|css)$/.test(f.path)) {
      patch.notes!.push(`Touched ${f.path}`);
    }
  }

  return patch;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
