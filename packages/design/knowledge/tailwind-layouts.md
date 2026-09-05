# Tailwind layout patterns

Best used for: marketing sections, app shells, responsive grids, pricing, feature rows.

## Patterns
- Mobile-first; `max-w-7xl` (~1280px) content width.
- 4px spacing scale (`p-1` … `p-16`).
- One composition in the first viewport: brand, headline, sentence, CTA, dominant visual.
- Section rhythm: headline + one supporting sentence + primary content.

## Do
- Use CSS grid / flex; avoid card wrappers unless they hold interaction.
- Prefer atmospheric backgrounds (gradient / image / subtle pattern) over flat fills.

## Don't
- Don't ship broadsheet newspaper layouts or purple-indigo default themes by habit.
