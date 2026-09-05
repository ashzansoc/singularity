# LaunchPad — Frontend Plan

**Goal:** Production-quality LaunchPad marketing/SaaS landing page for developers building AI apps.

**Stack (locked):**
- Next.js 16 + React 19 + Tailwind CSS 4
- shadcn/ui + Radix primitives
- HeroUI/NextUI-style SaaS shell patterns (or shadcn mapping)
- Three.js via `@react-three/fiber` + `@react-three/drei` (real `<Canvas>`, not CSS fake-3D)
- Magic UI / Framer Motion for features section motion
- Waitlist form posts to `/api/waitlist`

**Rules:**
- Stay in this Next.js app — never replace with a single-file `index.html`
- Work one unchecked task at a time; check it off here when done
- Keep `manage_todo_list` in sync with this file
- This `todo.md` is the source of truth for **all** specialties in this project (frontend, backend API, tests) — not only UI

---

## Tasks

- [x] **1. Create Next.js project with Tailwind**
  - Files: scaffold via `create_new_workspace` / Next template
  - Acceptance: `package.json` has next/react/tailwind; `src/app` exists

- [x] **2. Install all UI dependencies**
  - Deps: three, @types/three, @react-three/fiber, @react-three/drei, framer-motion, radix slots/dialog/dropdown, cva, clsx, tailwind-merge, lucide-react
  - Acceptance: listed packages present in `package.json`

- [ ] **3. Set up shadcn/ui primitives** ← *current*
  - Files: `src/lib/utils.ts` (`cn`), `src/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `dialog.tsx` (as needed)
  - Acceptance: primitives importable; use CSS variables / Tailwind tokens

- [ ] **4. Create theme and globals**
  - Files: `src/app/globals.css`, layout fonts/theme tokens (dark premium SaaS)
  - Acceptance: dark background, accent, consistent radius; no Inter-as-only-default if brand font chosen

- [ ] **5. Build Navigation component**
  - Files: `src/components/Navigation.tsx` (or similar)
  - Acceptance: sticky/glass nav, logo, links, CTA; mobile-friendly

- [ ] **6. Build Hero section with Three.js**
  - Files: `src/components/Hero.tsx`, `src/components/hero/HeroScene.tsx` (client, lazy `<Canvas>`)
  - Acceptance: real R3F scene + reduced-motion / 2D fallback; not CSS nodes-only

- [ ] **7. Build Features section with Magic UI**
  - Files: `src/components/Features.tsx`
  - Acceptance: 2–3 intentional motions (marquee/shimmer/bento); not card spam

- [ ] **8. Build Waitlist section with API**
  - Files: `src/components/Waitlist.tsx`, `src/app/api/waitlist/route.ts` (or contract stub)
  - Acceptance: email validate, loading/success/error; POST `/api/waitlist`

- [ ] **9. Build Footer component**
  - Files: `src/components/Footer.tsx`
  - Acceptance: links + minimal branding

- [ ] **10. Assemble main page and polish**
  - Files: `src/app/page.tsx`, layout polish, responsive pass
  - Acceptance: one composition above the fold; sections wired; lint-clean enough to run `next dev`
