# React Bits — Animated React components

Source: https://github.com/DavidHDev/react-bits · Docs: https://reactbits.dev

Best used for: text animations, backgrounds, loaders, docks, interactive UI flourishes. **Singularity default motion/visual kit** for React frontends.

## Install (copy-paste, own the source)

Prefer TypeScript + Tailwind (`TS-TW`) unless the project is JS/CSS-first:

```bash
npx shadcn@latest add @react-bits/BlurText-TS-TW
npx shadcn@latest add @react-bits/SplitText-TS-TW
npx shadcn@latest add @react-bits/Aurora-TS-TW
npx shadcn@latest add @react-bits/Dock-TS-TW
```

Pattern: `@react-bits/<ComponentName>-<JS|TS>-<CSS|TW>`. Also supports jsrepo / manual copy from reactbits.dev.

## Categories to pull from

- **Text**: BlurText, SplitText, GradientText, CountUp, scramble / typewriter variants
- **Backgrounds**: Aurora, Galaxy, Particles, GridScan, Hyperspeed (one atmosphere max)
- **Components**: Dock, SpotlightCard, TiltedCard, AnimatedList, Stack
- **Animations**: FadeContent, Magnet, BlobCursor (gate with `prefers-reduced-motion`)

## Do

- Install real components into the project — do not fake “React Bits style” from scratch.
- Compose 2–3 intentional motions; let Design Spec own palette/type/metaphor.
- Check each component’s peer deps after install and add them.
- Prefer product-specific hero content; use React Bits to elevate, not replace, brand hierarchy.

## Don't

- Don’t stack multiple animated backgrounds on one viewport.
- Don’t use purple→indigo glow clichés just because a demo uses them.
- Don’t skip reduced-motion fallbacks.
