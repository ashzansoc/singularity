# Singularity

AI coding IDE built on a VS Code OSS fork, with a cost-aware model router and AI I/O cache.

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

## Inference (Vercel AI Gateway)

One API key, many models, OpenAI-compatible:

- Base URL: `https://ai-gateway.vercel.sh/v1`
- Key via gitignored [`.env`](.env) (`AI_GATEWAY_API_KEY`) — see [`.env.example`](.env.example)
- BYOK vendor: **Vercel AI Gateway** in the model picker
- Auto mode uses gateway models first (no Microsoft CAPI) when the key is seeded

```bash
cp .env.example .env   # then set AI_GATEWAY_API_KEY
npm start
```

## Useful commands

```bash
npm run build:packages   # cache + router
npm run test:packages
npm run watch            # build packages, then vscode watch
```

Inside the IDE after launch:

- **Singularity AI: Show Status**
- **Singularity AI: Complete Prompt (routed + cached)**
- Status bar: `Singularity AI`
