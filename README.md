# Singularity

AI coding IDE built on a VS Code OSS fork, with a cost-aware model router and AI I/O cache.

## Installation

### Option 1 — Build & run from source (recommended for contributors)

**Requirements**

- **macOS** (the IDE is a VS Code fork; Linux/Windows not currently supported)
- **Node.js 24** (the fork pins this in `vscode/.nvmrc` — use [nvm](https://github.com/nvm-sh/nvm): `nvm use`)

```bash
# 1. Clone
git clone https://github.com/ashzansoc/singularity.git
cd singularity

# 2. Install dependencies (npm workspaces + LangExtract sidecar venv via postinstall)
npm install

# 3. Configure inference — the model router needs at least one provider key
cp .env.example .env
#    then edit .env and set OPENROUTER_API_KEY (preferred — all models route through OpenRouter)
#    optional: GITHUB_TOKEN (avoids GitHub 403 rate limits during built-in extension sync)

# 4. Start — builds the 14 packages + singularity-ai extension, then launches the IDE
npm start
```

> `npm start` runs `scripts/launch.sh`: loads `.env` → ensures the LangExtract sidecar → enables the Context Engine & Neural Relay → builds everything → launches the IDE.

### Option 2 — Install the packaged macOS app (end user)

Singularity ships as a DMG with mandatory over-the-air updates.

```bash
curl -fsSL https://singularity-ide.web.app/install.sh | bash
```

Install into `~/Applications` instead of `/Applications`:

```bash
SINGULARITY_INSTALL_DIR="$HOME/Applications" bash <(curl -fsSL https://singularity-ide.web.app/install.sh)
```

The installer fetches the release manifest, downloads the `darwin-arm64`/`darwin-x64` build, and installs `Singularity.app`. If macOS blocks the unsigned app: **System Settings → Privacy & Security → Open Anyway**.

### Inference via Vercel AI Gateway (BYOK)

One API key, many models, OpenAI-compatible:

- Base URL: `https://ai-gateway.vercel.sh/v1`
- Key via gitignored [`.env`](.env) (`AI_GATEWAY_API_KEY`) — see [`.env.example`](.env.example)
- BYOK vendor: **Vercel AI Gateway** in the model picker
- Auto mode uses gateway models first (no Microsoft CAPI) when the key is seeded

```bash
cp .env.example .env   # then set AI_GATEWAY_API_KEY
npm start
```

## Launch

From the repo root:

```bash
npm install          # once — installs all packages/* workspaces + the LangExtract sidecar venv
npm start            # builds packages + singularity-ai, then launches the IDE
```

Equivalent: `npm run launch` → [`scripts/launch.sh`](scripts/launch.sh).

## What starts with the app

| Piece | Role |
|-------|------|
| [`packages/cache`](packages/cache) | Multi-layer AI I/O cache |
| [`packages/router`](packages/router) | Intent → tier → model routing (`@singularity/router`) |
| [`vscode/extensions/singularity-ai`](vscode/extensions/singularity-ai) | Boots the runtime on `onStartupFinished` (status bar + commands) |
| Singularity Auto mode | Routes via Singularity; prefers **Vercel AI Gateway** models when configured |

## Getting started

Inside the IDE after launch:

- Open the **Command Palette** (`Cmd+Shift+P`)
- **Singularity AI: Show Status** — routing / provider status
- **Singularity AI: Complete Prompt (routed + cached)** — the main AI command; routes intent → tier → model, cached via `packages/cache`
- Status bar shows **Singularity AI**

## Useful commands

```bash
npm run build:packages   # cache + router
npm run test:packages
npm run watch            # build packages, then vscode watch
```