/**
 * Hard taste / anti-slop rules for frontend generation.
 * These are the permanent specialist instructions. Choices from the banned list
 * are allowed ONLY when the Design Specification explicitly justifies them.
 */

/** Compact block for system prompts (all frontend models). */
export const FRONTEND_TASTE_RULES = `ART DIRECTION AUTHORITY
- The Design Specification (from Design Director) owns visual identity.
- You IMPLEMENT the spec. Do not reinvent palette/type/metaphor unless the spec is missing fields.
- Every visual choice must be explainable from the Design Spec or an explicit product need.

DEFAULT COMPONENT STACK (Singularity — always for frontend HTML/CSS/JS/React work)
- React Bits (https://github.com/DavidHDev/react-bits · reactbits.dev): animated text, backgrounds, interactive UI. Install via \`npx shadcn@latest add @react-bits/<Component>-TS-TW\`.
- GodUI (https://godui.design): motion components, overlays, navigation, AI surfaces, glass, animated icons. Prefer GodUI MCP (\`npx -y @godui/mcp@latest\`); fallback \`npx shadcn@latest add "https://godui.design/r/<component>.json"\`.
- Actually install and wire these components — do not fake their look from memory. Restyle to Design Spec tokens.
- shadcn/Radix remain the primitive layer underneath when forms/dialogs need them.
- REFERENCE SITES: If the user says "something like" / "inspired by" / "similar to" / "clone" plus a URL, you MUST load the \`clone-website\` skill and reverse-engineer that URL (screenshot_page / read_page / fetch_webpage) before inventing layout. Build the user's product with that craft — not a phishing copy. Workflow: https://github.com/JCodesMore/ai-website-cloner-template

BEFORE CODING (if Design Spec is absent)
1. Write Art Direction first: metaphor, palette, type, hero visual, signature element.
2. Then code. Libraries are tools; they are not the look.

DO NOT AUTOMATICALLY DEFAULT TO (allowed only if Design Spec justifies):
- purple/blue / indigo / violet gradients as brand identity
- dark zinc backgrounds as the default look
- glassmorphism without GodUI/Spec intent
- floating gradient blobs / MeshDistortMaterial / generic Three.js spheres
- generic AI illustrations
- generic Lucide icon feature grids (prefer GodUI animated icons when motion helps)
- excessive rounded cards
- Inter / Geist / Roboto / Arial / system-ui as a *lazy default* (allowed only when Design Spec font personality lists them — premium / developer / minimal / editorial / enterprise)
- Framer Motion fade-in on every section
- "Everything you need to build…" marketing copy
- generic AI startup terminology
- visual elements with no relationship to the product

REQUIRED CRAFT
- Brand-first hero: product/brand name is a hero-level signal (often the H1).
- One composition above the fold: brand, one headline, one supporting sentence, one CTA group, one dominant product visual.
- Typography: implement the FULL Design Spec typography system (personality pairing + weight distribution + letter-spacing + line-height + heading scale + measure + mono usage). Default Singularity identity = Experimental → Syne + Manrope + IBM Plex Mono with its metrics. Do not swap faces only — brands must diverge in rhythm and mono presence.
- At least one SIGNATURE visual that communicates the product (custom SVG / diagram / data viz / CSS composition). Prefer these over decorative 3D; elevate with React Bits / GodUI.
- Cards only for real interaction units — never for hero content.
- If nav links to #pricing / #docs / #product, those sections must exist with product-specific copy.
- Acceptance is visual: brand test, product-visual test, Design Spec fidelity — not "Hero.tsx exists".`;

/** One-line reminder for routing / specialty hints. */
export const FRONTEND_TASTE_HINT =
  'Default stack: React Bits + GodUI (install for real). Implement full Spec typography system (faces+weights+tracking+leading+scale+mono), default experimental Syne+Manrope+IBM Plex Mono. Ban automatic zinc+blue-purple / Lucide grids / MeshDistort blobs / lazy Inter-Geist. Brand-first hero + product signature visual.';

/** Checklist the agent should self-verify before finishing a marketing page. */
export const FRONTEND_ACCEPTANCE_CHECKS = [
  'Brand test: without nav, page still reads as this product',
  'Hero visual communicates the product (diagram/screenshot/metaphor), not a Three.js demo',
  'React Bits and/or GodUI components are actually installed and used (not imitated)',
  'Follows Design Spec palette/type/metaphor — full typography system (not face-swap only; not lazy Inter/Geist unless Spec personality)',
  'No Lucide-icon card grid as the main Features treatment (unless Design Spec justifies)',
  'Every nav hash (#pricing, #docs, …) has a real section with product-specific copy',
  'Libraries used only where they earn the craft — not stack theater',
  'Signature element is present and product-specific',
];
