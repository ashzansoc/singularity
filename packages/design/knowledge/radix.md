# Radix — Accessible primitives

Best used for: Dialog, Dropdown, Popover, Tabs, Tooltip, Select, Accordion, FocusScope.

## Patterns
- Unstyled behavior + Tailwind styling.
- Keyboard navigation and aria attributes are non-negotiable.
- Portals for overlays; trap focus inside modals.

## Do
- Prefer Radix (via shadcn) for any interactive overlay.
- Preserve `asChild` composition patterns.

## Don't
- Don't rebuild dropdown/dialog behavior from scratch.
