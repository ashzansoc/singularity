# Website Cloner — reference-site reverse engineering

Source: https://github.com/JCodesMore/ai-website-cloner-template

Best used for: when the user says **“something like” / “clone” / “inspired by” / “make it like”** and includes a **URL**. Reverse-engineer that site to understand layout, tokens, motion, and content structure — then build the **user’s** product with the same craft (not a phishing copy).

## When to activate (mandatory)

Enable automatically if the prompt matches:

- `(something|site|page|website|landing|app|product)\s+like` + `https?://…`
- `inspired by` / `similar to` / `clone` / `replicate` / `rebuild` / `copy this` + URL
- `/clone-website <url>`

## Workflow (Singularity)

1. **Load skill** — call the `skill` tool with `clone-website` (or read the bundled SKILL.md).
2. **Reconnaissance** — use `screenshot_page`, `read_page`, and/or `fetch_webpage` on the reference URL(s). Capture layout, type, color, spacing, interaction model, and real content structure into `docs/research/`.
3. **Understand** — write a short reference digest (tokens, section map, interaction model). Do **not** ship a 1:1 brand impersonation as the final product unless the user owns the site and asked for a pixel clone.
4. **Build the user’s product** — apply Design Spec + React Bits + GodUI + shadcn. Match the *craft* (hierarchy, rhythm, motion density) of the reference while branding for the user’s product.
5. **QA** — visual check against the reference for structure/fidelity of craft, not stolen logos/copy.

## Legal / safety

- Do not use for phishing, impersonation, or ToS-violating scraping.
- Logos, brand assets, and original copy belong to their owners — extract structure and craft, replace with the user’s brand unless explicitly cloning a site they own.

## Stack notes

The upstream template is Next.js + shadcn + Tailwind. In Singularity, prefer the user’s existing stack when present; otherwise scaffold Next/Vite + shadcn, then layer React Bits + GodUI per Design Intelligence defaults.
