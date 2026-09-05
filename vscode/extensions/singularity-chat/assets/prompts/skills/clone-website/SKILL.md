---
name: clone-website
description: Reverse-engineer a reference website from a URL, then build the user's product with the same craft. Triggers on "something like <url>", "inspired by <url>", "clone <url>", "make it like <url>", or /clone-website. Uses screenshot_page / read_page / fetch_webpage, writes research specs, then implements with Design Spec + React Bits + GodUI + shadcn.
---

# Clone Website (Singularity)

Based on [ai-website-cloner-template](https://github.com/JCodesMore/ai-website-cloner-template).

When the user says **something like** / **inspired by** / **similar to** / **take reference from** / **clone** / **rebuild** and includes one or more **URLs**, you MUST run this skill before inventing a layout from memory.

## Goal

1. **Understand** the reference site (structure, tokens, motion, interaction model, content rhythm).
2. **Design Spec still owns brand** — Design Director writes `.singularity/design-spec.json` for the *user’s* product; the reference informs craft, not identity.
3. **Build the user’s product** with that craft. Do **not** ship a 1:1 pixel clone / phishing copy unless the user owns the site and explicitly asked for a pixel-perfect rebuild.

## Tools (prefer in order)

1. `screenshot_page` — full-page / viewport captures of the reference
2. `read_page` — DOM / accessibility / text extraction when available
3. `fetch_webpage` — HTML / text fallback
4. File tools — write research under `docs/research/` and implement the product

If browser tools fail, still fetch the URL, note gaps, and continue with best-effort extraction — do not abandon the request.

## Phases

### 0. Parse targets

Extract every `http://` / `https://` URL from the user message. Normalize them. Confirm which URL is the visual reference vs pages to include. If no valid URL, ask once.

### 1. Reconnaissance

For each reference URL:

- Capture desktop + mobile screenshots into `docs/design-references/`
- Extract design tokens (colors, type, spacing, radius, shadows)
- Map sections top-to-bottom (nav, hero, features, pricing, footer, …)
- Identify **interaction model** before building: scroll-driven vs click vs hover vs time
- Note real content structure (headlines, CTAs, media) — replace brand/copy with the user’s product later

Write `docs/research/reference-digest.md` with: URLs, token table, section map, interaction notes, what to emulate vs invent.

### 2. Foundation

- Ensure a buildable app (existing project or scaffold Next/Vite + TypeScript + Tailwind + shadcn)
- Install Singularity defaults: **React Bits + GodUI** on **shadcn/Radix**
- Align CSS variables with Design Spec (or with extracted tokens when Spec is thin)
- Download only assets that are free to use or that the user owns; otherwise recreate with SVG / product visuals

### 3. Specs then build

For each major section, write a short spec under `docs/research/components/` (layout, tokens, states, content slots for the **user’s** product). Then implement section by section. Prefer small, perfect sections over one giant guess.

### 4. Assembly & QA

- Wire routes/sections, real product copy, Design Spec brand test
- Self-check: reference craft captured; user’s brand dominant; React Bits/GodUI actually installed; no stolen logos; no zinc+purple AI slop

## Hard rules

- **BLOCKING:** On like+URL prompts, load this skill (via `skill` tool name `clone-website`) before coding the UI.
- Match craft (hierarchy, spacing rhythm, motion density) — not stolen identity.
- Keep React Bits + GodUI as the motion stack unless the user forbids them.
- Do not expand scope into backend/auth unless asked.

## Not for

Phishing, impersonation, or violating a site’s terms of service.
