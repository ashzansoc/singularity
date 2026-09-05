# HeroUI / NextUI — Modern SaaS application UI

Best used for: polished app shells, navigation, settings, auth screens.

## Patterns
- Clear app shell: sidebar / top nav + content max-width ~1280px.
- Soft elevation; consistent radius (often 8–14px).
- Use for SaaS product surfaces when the stack already includes HeroUI/NextUI.

## Do
- Prefer HeroUI if `@heroui/*` or `@nextui-org/*` is in package.json.
- Otherwise map the same layout patterns onto shadcn.

## Don't
- Don't introduce HeroUI solely for one button when shadcn is the project standard.
