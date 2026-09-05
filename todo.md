# Singularity — Rebuild macOS DMG

## Checklist
- [x] Analyze repo state, size, secrets, nested git
- [x] Harden .gitignore (vscode/.git, venvs, logs, .tmp)
- [ ] Add .gitattributes (.gitignore/.env boundaries, text=auto)
- [-] git init + first commit (config identity)
- [ ] Verify commit size and no secrets/oversized files
- [ ] Create GitHub repo (public, safe-push)
- [ ] Push main branch to GitHub

## Goal
Produce a fresh, self-contained `Singularity-<version>-darwin-arm64.dmg` (+ OTA `.zip`) for the entire project on this Mac.

## Decision
- Windows `.exe` cannot be cross-built on macOS; user chose the macOS DMG (platform-appropriate single-runnable artifact).
- Use the existing `scripts/build-dmg.sh` pipeline (ad-hoc signed, no notarization).

---

# Singularity — Typography System Expansion

## Goal
Add a mix of new font personalities to the Design Spec typography system, so Singularity's generated frontends can span futuristic / intelligent / technical / modernist / precision / machine / neo-brutalist / AI lab / neo-futurist / console / academic / avant-garde / architectural / industrial / humanist-tech directions.

## Decisions
- Keep the existing 9 personalities intact (tests rely on them: experimental default, developer, editorial, cybernetic, premium).
- Add 14 new personalities to `FONT_PERSONALITIES` in `packages/design/src/fontPersonalities.ts`, following the user's table (family trios + feel).
- Extend `resolveFontPersonality` keyword resolution so prompts can actually reach the new personalities.
- Keep the Agent-mode mirror (`vscode/.../designSpecV2Agent.ts` FONT_TRIOS + FONT_PERSONALITY_CATALOG + resolveFontTrio) in sync.
- Update the lazy-font critic regex guard in `designIntelligence.ts` so new display faces (Sora, Chakra Petch, etc.) don't trip the "lazy Inter/Geist" finding.
- New personalities get sensible metrics (weights, tracking, leading, scale, measure, mono usage) consistent with the existing system's depth.

## New personalities (14)
| id | Display | Body | Mono | Feel |
|---|---|---|---|---|
| futuristic | Sora | Manrope | Geist Mono | AI-native, polished |
| intelligent | DM Sans | Inter | IBM Plex Mono | Clean, sophisticated |
| technical | Chakra Petch | Inter | JetBrains Mono | Engineering / systems |
| modernist | General Sans → Geist | Inter | Geist Mono | Premium SaaS |
| precision | Neue Montreal → Inter | Inter | IBM Plex Mono | Minimal, high-end |
| machine | Space Mono | Manrope | Space Mono | Computational |
| neo-brutalist | Archivo | DM Sans | IBM Plex Mono | Strong, confident |
| ai-lab | Azeret Mono | Inter | Azeret Mono | Experimental / research |
| neo-futurist | Plus Jakarta Sans | Manrope | Geist Mono | Modern AI company |
| console | Berkeley Mono → JetBrains Mono | Inter | JetBrains Mono | Hacker / engineering |
| academic | Source Serif 4 | IBM Plex Sans | IBM Plex Mono | Research / intelligence |
| avant-garde | Clash Display → Space Grotesk | General Sans → Geist | JetBrains Mono | Distinctive / creative |
| architectural | Syne | Manrope | Space Mono | Experimental |
| industrial | DIN Next → Archivo | Inter | Roboto Mono | Infrastructure / systems |
| humanist-tech | Albert Sans | Inter | IBM Plex Mono | Friendly but technical |

Paid faces → open substitutes (consistent with existing Söhne→Inter, General Sans→Geist mapping).
