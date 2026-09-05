# GodUI — Motion UI for modern React

Source: https://godui.design · MCP: `@godui/mcp` · Registry: shadcn-compatible

Best used for: polished buttons, overlays, navigation, AI surfaces, glass, backgrounds, animated icons. **Singularity default component + motion library** alongside React Bits.

## Install

**Preferred — GodUI MCP** (when the `godui` MCP server is available): browse/install components by name into the project.

MCP config (workspace or user):

```json
{
  "mcpServers": {
    "godui": {
      "command": "npx",
      "args": ["-y", "@godui/mcp@latest"]
    }
  }
}
```

Or CLI installer: `pnpm dlx @godui/cli@latest install cursor` (or the Singularity/VS Code equivalent).

**Fallback — shadcn registry:**

```bash
npx shadcn@latest add "https://godui.design/r/jelly-button.json"
npx shadcn@latest add "https://godui.design/r/magnetic-button.json"
npx shadcn@latest add "https://godui.design/r/morphing-dialog.json"
```

Components land as owned source (React + TypeScript + Tailwind + Motion).

## Pull from these families by default

- **Buttons**: Jelly, Magnetic, Shimmer, Magic, Hold Confirm, Slide Confirm
- **Navigation**: Dock, Magic Tab, Mega Menu, Segmented Control, Resizable Header
- **Overlays**: Morphing Dialog, Drawer, Command Palette, Toast, Animated Tooltip
- **Text**: Aurora Text, Elastic Text, Text Animate, Number Ticker, Scroll Text Reveal
- **AI surfaces**: Conversation Thread, Prompt Composer, Prompt Suggestions, Voice Orb, Agent Timeline
- **Effects / backgrounds**: Border Beam, Spotlight Card, Liquid Glass, Light Rays, Flow Field
- **Animated icons**: use GodUI animated icons instead of generic static Lucide grids when motion helps

## Motion budget

Built for transform/opacity (60fps). Keep 2–3 intentional motions per surface. Respect `prefers-reduced-motion`.

## Do

- Prefer GodUI MCP tools when present; otherwise shadcn registry URLs.
- Use GodUI for interaction polish; React Bits for text/background spectacle; shadcn/Radix for base primitives when needed.
- Match Design Spec tokens (CSS variables) — restyle GodUI source to the Spec, don’t adopt demo themes blindly.

## Don't

- Don’t paste every demo on one page.
- Don’t mix three competing motion libraries for the same control.
- Don’t let library demos override brand hierarchy or product visuals.
