/** Specialty lanes for multi-model orchestration. */
export type TaskSpecialty =
  | 'frontend'
  | 'frontend-refine'
  | 'design-director'
  | 'visual-capture'
  | 'visual-critic'
  | 'backend'
  | 'ai-pipeline'
  | 'infrastructure'
  | 'general';

/**
 * Canonical frontend *implementation* owner (Design Spec → production UI).
 * Design Director and implementer both use Flash-0731 (Pro is disabled).
 */
export const FRONTEND_OWNER_MODEL_ID = 'deepseek/deepseek-v4-flash-0731' as const;

export const FRONTEND_OWNER_DISPLAY_NAME = 'DeepSeek V4 Flash-0731 (Frontend Implementer)' as const;

/** Catalog of UI reference libraries available to the frontend agent. */
export interface DesignSource {
  id: string;
  name: string;
  bestUsedFor: string;
  /** Relative path under packages/design/refs/ after install. */
  refDir: string;
  /** Git remote used by install-design-refs.sh */
  repoUrl: string;
  /** Optional curated knowledge markdown under packages/design/knowledge/ */
  knowledgeFile?: string;
  tags: string[];
}

export interface DesignDnaTypography {
  sans: string;
  mono?: string;
  bodyPx: number;
  headingPx: number;
  scale?: string;
}

export interface DesignDnaSpacing {
  baseGridPx: number;
  sectionGapPx?: number;
}

export interface DesignDnaColors {
  background: string;
  foreground: string;
  muted?: string;
  accent: string;
  accentForeground?: string;
  border?: string;
  destructive?: string;
  notes?: string;
}

export interface DesignDnaMotion {
  durationMs: [number, number];
  easing: string;
}

export interface DesignDnaLayout {
  maxWidthPx: number;
  columns?: string;
  responsive?: string;
}

/**
 * Persistent design fingerprint for a workspace.
 * Next frontend task loads this so Qwen does not start from zero.
 */
export interface DesignDna {
  version: 1;
  workspaceId: string;
  updatedAt: number;
  typography: DesignDnaTypography;
  spacing: DesignDnaSpacing;
  radiusPx: number;
  colors: DesignDnaColors;
  components: string[];
  motion: DesignDnaMotion;
  layout: DesignDnaLayout;
  /** Free-form notes absorbed from prior UI work. */
  notes?: string[];
  /** Sources consulted in prior generations. */
  sourcesUsed?: string[];
}

export interface DesignContextBundle {
  specialty: TaskSpecialty;
  modelId: typeof FRONTEND_OWNER_MODEL_ID;
  systemPrompt: string;
  /** Compact DNA block for the worker prompt. */
  dnaBlock: string;
  /** Retrieved reference snippets (patterns / components). */
  knowledgeBlock: string;
  sources: DesignSource[];
}

export const DEFAULT_DESIGN_DNA: Omit<DesignDna, 'workspaceId' | 'updatedAt'> = {
  version: 1,
  typography: {
    // Prefer Spec faces from FONT PERSONALITY SYSTEM.
    // Default Singularity identity: Experimental → Syne + Manrope + IBM Plex Mono.
    sans: 'Syne',
    mono: 'IBM Plex Mono',
    bodyPx: 16,
    headingPx: 40,
    scale:
      'Full typography system — faces + weights + tracking + leading + scale + mono usage (default experimental Syne/Manrope/IBM Plex Mono)',
  },
  spacing: {
    baseGridPx: 4,
    sectionGapPx: 80,
  },
  radiusPx: 6,
  colors: {
    background: 'pick from product metaphor — not default zinc-950',
    foreground: 'high-contrast ink for the chosen ground',
    muted: 'muted text token',
    accent: 'one signal accent from the metaphor (not blue→purple / indigo / violet)',
    accentForeground: 'contrasting on accent',
    border: 'hairline / quiet border',
    notes:
      'Ban zinc+blue→purple AI-SaaS defaults. Art-direct palette from product metaphor before coding.',
  },
  components: ['react-bits', 'godui', 'shadcn', 'Radix'],
  motion: {
    durationMs: [180, 320],
    easing: 'ease-out',
  },
  layout: {
    maxWidthPx: 1280,
    columns: 'responsive CSS grid',
    responsive:
      'mobile-first; brand-first hero; one composition above the fold; no Lucide icon-card grids as the page identity',
  },
  notes: [
    'Art-direct before coding: metaphor, palette, type, product-specific hero visual.',
    'Default implementation stack: React Bits + GodUI (install for real) on shadcn/Radix primitives.',
    'Prefer product SVG/diagram over decorative Three.js blobs.',
  ],
  sourcesUsed: [],
};
