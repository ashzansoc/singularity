import type { DesignSource } from './types.js';

/**
 * Frontend Design Knowledge catalog.
 * Qwen should retrieve from these sources — not invent a new design system each time.
 */
export const DESIGN_SOURCES: readonly DesignSource[] = [
  {
    id: 'react-bits',
    name: 'React Bits',
    bestUsedFor: 'Animated text, backgrounds, and interactive UI',
    refDir: 'react-bits',
    repoUrl: 'https://github.com/DavidHDev/react-bits.git',
    knowledgeFile: 'react-bits.md',
    tags: [
      'animation',
      'text',
      'backgrounds',
      'landing',
      'hero',
      'motion',
      'react-bits',
      'reactbits',
    ],
  },
  {
    id: 'godui',
    name: 'GodUI',
    bestUsedFor: 'Motion components, overlays, AI surfaces, animated icons',
    refDir: 'godui',
    repoUrl: 'https://godui.design',
    knowledgeFile: 'godui.md',
    tags: [
      'motion',
      'buttons',
      'overlays',
      'navigation',
      'ai',
      'glass',
      'icons',
      'godui',
      'shadcn',
    ],
  },
  {
    id: 'shadcn',
    name: 'shadcn/ui',
    bestUsedFor: 'Component primitives',
    refDir: 'shadcn-ui',
    repoUrl: 'https://github.com/shadcn-ui/ui.git',
    knowledgeFile: 'shadcn.md',
    tags: ['primitives', 'radix', 'tailwind', 'forms', 'dialogs'],
  },
  {
    id: 'aceternity',
    name: 'Aceternity UI',
    bestUsedFor: 'Premium visual effects',
    refDir: 'spectrum-ui',
    repoUrl: 'https://github.com/arihantcodes/spectrum-ui.git',
    knowledgeFile: 'aceternity.md',
    tags: ['effects', 'framer-motion', 'landing', 'hero', 'spotlight'],
  },
  {
    id: 'magic-ui',
    name: 'Magic UI',
    bestUsedFor: 'Animated UI',
    refDir: 'magicui',
    repoUrl: 'https://github.com/magicuidesign/magicui.git',
    knowledgeFile: 'magic-ui.md',
    tags: ['animation', 'micro-interactions', 'marquee', 'bento'],
  },
  {
    id: 'radix',
    name: 'Radix',
    bestUsedFor: 'Accessible primitives',
    refDir: 'radix-primitives',
    repoUrl: 'https://github.com/radix-ui/primitives.git',
    knowledgeFile: 'radix.md',
    tags: ['a11y', 'primitives', 'focus', 'keyboard'],
  },
  {
    id: 'mantine',
    name: 'Mantine',
    bestUsedFor: 'Application components',
    refDir: 'mantine',
    repoUrl: 'https://github.com/mantinedev/mantine.git',
    knowledgeFile: 'mantine.md',
    tags: ['app-ui', 'hooks', 'forms', 'tables'],
  },
  {
    id: 'tremor',
    name: 'Tremor',
    bestUsedFor: 'Analytics dashboards',
    refDir: 'tremor',
    repoUrl: 'https://github.com/tremorlabs/tremor.git',
    knowledgeFile: 'tremor.md',
    tags: ['charts', 'kpi', 'dashboard', 'analytics'],
  },
  {
    id: 'heroui',
    name: 'HeroUI',
    bestUsedFor: 'Modern application UI',
    refDir: 'heroui',
    repoUrl: 'https://github.com/heroui-inc/heroui.git',
    knowledgeFile: 'heroui.md',
    tags: ['app-ui', 'saas', 'nextui'],
  },
  {
    id: 'nextui',
    name: 'NextUI / HeroUI ecosystem',
    bestUsedFor: 'SaaS interfaces',
    refDir: 'nextui',
    repoUrl: 'https://github.com/nextui-org/nextui.git',
    knowledgeFile: 'heroui.md',
    tags: ['saas', 'app-shell', 'navigation'],
  },
  {
    id: 'tailwind-patterns',
    name: 'Tailwind UI-style references',
    bestUsedFor: 'Layout patterns',
    refDir: 'headlessui',
    repoUrl: 'https://github.com/tailwindlabs/headlessui.git',
    knowledgeFile: 'tailwind-layouts.md',
    tags: ['layout', 'marketing', 'app-shell', 'grid'],
  },
  {
    id: 'shadcn-taxonomy',
    name: 'shadcn Taxonomy (SaaS layouts)',
    bestUsedFor: 'SaaS app shells & marketing layouts',
    refDir: 'shadcn-taxonomy',
    repoUrl: 'https://github.com/shadcn-ui/taxonomy.git',
    knowledgeFile: 'tailwind-layouts.md',
    tags: ['saas', 'dashboard', 'marketing', 'layout'],
  },
  {
    id: 'threejs',
    name: 'Three.js examples',
    bestUsedFor: '3D interactions',
    refDir: 'threejs',
    repoUrl: 'https://github.com/mrdoob/three.js.git',
    knowledgeFile: 'threejs.md',
    tags: ['3d', 'webgl', 'canvas', 'interactive'],
  },
  {
    id: 'website-cloner',
    name: 'Website Cloner',
    bestUsedFor: 'Reverse-engineer a reference URL then build the user product',
    refDir: 'ai-website-cloner-template',
    repoUrl: 'https://github.com/JCodesMore/ai-website-cloner-template.git',
    knowledgeFile: 'website-cloner.md',
    tags: [
      'clone',
      'reference',
      'something-like',
      'inspired-by',
      'reverse-engineer',
      'screenshot',
      'scrape',
    ],
  },
] as const;

export function getDesignSource(id: string): DesignSource | undefined {
  return DESIGN_SOURCES.find((s) => s.id === id);
}

export function sourcesForQuery(query: string, limit = 4): DesignSource[] {
  const lower = query.toLowerCase();
  const scored = DESIGN_SOURCES.map((s) => {
    let score = 0;
    if (lower.includes(s.id) || lower.includes(s.name.toLowerCase())) score += 5;
    if (lower.includes(s.bestUsedFor.toLowerCase())) score += 3;
    for (const tag of s.tags) {
      if (lower.includes(tag)) score += 2;
    }
    // Soft priors by task shape
    if (/dashboard|analytics|chart|kpi|metric/.test(lower) && s.id === 'tremor') score += 4;
    if (/react\s*bits|reactbits|blurtext|aurora|split\s*text/.test(lower) && s.id === 'react-bits')
      score += 6;
    if (/god\s*ui|godui|jelly\s*button|liquid\s*glass|animated\s*icon/.test(lower) && s.id === 'godui')
      score += 6;
    if (/landing|hero|spotlight|particle|glow|effect|animat|background/.test(lower) && s.id === 'react-bits')
      score += 4;
    if (/button|overlay|dialog|dock|motion|ai\s*chat|prompt/.test(lower) && s.id === 'godui')
      score += 4;
    if (/landing|hero|spotlight|particle|glow|effect/.test(lower) && s.id === 'aceternity')
      score += 2;
    if (/animat|marquee|bento|shimmer/.test(lower) && s.id === 'magic-ui') score += 2;
    if (/a11y|accessible|dialog|popover|dropdown/.test(lower) && s.id === 'radix') score += 3;
    if (/3d|three|webgl|canvas/.test(lower) && s.id === 'threejs') score += 5;
    if (/saas|settings|sidebar|shell/.test(lower) && (s.id === 'heroui' || s.id === 'shadcn-taxonomy'))
      score += 3;
    if (/button|form|input|table|card/.test(lower) && s.id === 'shadcn') score += 2;
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((x) => x.score > 0).slice(0, limit).map((x) => x.s);
  if (picked.length >= 2) return picked;
  // Default stack for generic frontend builds — React Bits + GodUI first
  return [
    getDesignSource('react-bits')!,
    getDesignSource('godui')!,
    getDesignSource('shadcn')!,
    getDesignSource('tailwind-patterns')!,
  ].slice(0, limit);
}
