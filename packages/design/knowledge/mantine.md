# Mantine — Application components

Best used for: dense app UI — forms, notifications, modals, tables, dates, hooks.

## Patterns
- Strong default application chrome when the project already uses Mantine.
- Use Mantine hooks (`useDisclosure`, `useForm`) when present.

## Do
- Stay consistent with existing Mantine theme if detected.
- Prefer Mantine only when the repo already depends on it; otherwise prefer shadcn.

## Don't
- Don't mix Mantine + shadcn primitives in the same view without a migration plan.
