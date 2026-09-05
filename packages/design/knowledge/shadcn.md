# shadcn/ui — Component primitives

Best used for: accessible building blocks composed with Radix + Tailwind.

## Patterns
- Copy-paste components under `components/ui/*` (Button, Input, Dialog, Sheet, Table, Tabs).
- Prefer composition: `Button` + `Dialog` + `Form` over custom one-offs.
- Use CSS variables for theme tokens (`--background`, `--foreground`, `--primary`, `--radius`).
- Keep variants via `cva` / `class-variance-authority`.

## Do
- Match existing `components/ui` if present.
- Wire forms with react-hook-form + zod when SaaS forms appear.
- Use `cn()` helper for class merges.

## Don't
- Don't invent parallel primitive libraries when shadcn already exists in the repo.
- Don't hard-code hex colors when theme tokens exist.
