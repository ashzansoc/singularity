#!/usr/bin/env bash
# Build Singularity workspace packages + singularity-ai extension + dev sync.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[singularity] Installing workspace packages (if needed)…"
if [[ ! -d node_modules ]] || [[ ! -d packages/cache/node_modules ]] || [[ ! -d packages/router/node_modules ]]; then
  npm install
fi

echo "[singularity] Building packages + singularity-ai extension…"
npm run build

echo "[singularity] Syncing singularity-ai → .build/extensions…"
bash "$ROOT/scripts/sync-extension.sh"
